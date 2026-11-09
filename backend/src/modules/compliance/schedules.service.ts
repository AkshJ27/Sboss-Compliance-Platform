import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit, changedFields } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import type { ActivateInput, ScheduleListQuery, ScheduleUpdateInput } from './compliance.schema';

const MAX_ACTIVATE = 5000;
const insensitive = Prisma.QueryMode.insensitive;

// Owner, manager and approver must be active, non-viewer users of the same company
async function assertAssignees(
    db: Prisma.TransactionClient,
    orgId: string,
    ids: (string | null | undefined)[],
) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (wanted.length === 0) return;
    const found = await db.user.count({
        where: { id: { in: wanted }, orgId, isActive: true, role: { in: ['ORG_ADMIN', 'MEMBER'] } },
    });
    if (found !== wanted.length) {
        throw new HttpError(400, 'Owner, manager and approver must be active, non-viewer users of your company');
    }
}

export async function activate(actor: AuthUser, input: ActivateInput, dryRun: boolean) {
    const { orgId } = actor;

    const location = await prisma.location.findFirst({
        where: {
            id: input.locationId,
            entityId: input.entityId,
            orgId,
            isActive: true,
            entity: { isActive: true },
        },
        select: { id: true, name: true, state: true },
    });
    if (!location) throw new HttpError(400, 'Location not found for this entity, or it is inactive');

    if (input.departmentId) {
        const ok = await prisma.department.findFirst({
            where: { id: input.departmentId, orgId, isActive: true },
            select: { id: true },
        });
        if (!ok) throw new HttpError(400, 'Department not found or inactive');
    }
    if (input.verticalId) {
        const ok = await prisma.vertical.findFirst({
            where: { id: input.verticalId, orgId, isActive: true },
            select: { id: true },
        });
        if (!ok) throw new HttpError(400, 'Vertical not found or inactive');
    }
    await assertAssignees(prisma, orgId, [input.ownerId, input.managerId, input.approverId]);

    // Which library items were asked for
    const or: Prisma.ComplianceWhereInput[] = [];
    if (input.actIds.length) or.push({ actId: { in: input.actIds } });
    if (input.complianceIds.length) or.push({ id: { in: input.complianceIds } });

    const found = await prisma.compliance.findMany({
        where: { isActive: true, act: { isActive: true }, OR: or },
        select: {
            id: true,
            code: true,
            title: true,
            risk: true,
            frequency: true,
            act: { select: { id: true, name: true, jurisdiction: true, state: true } },
        },
        take: MAX_ACTIVATE + 1,
    });
    if (found.length > MAX_ACTIVATE) {
        throw new HttpError(400, `Too many compliances (max ${MAX_ACTIVATE} at once). Choose fewer Acts.`);
    }

    const excluded = new Set(input.excludeComplianceIds);
    const candidates = found.filter((c) => !excluded.has(c.id));

    // A state law only applies at locations in that state
    const wrongState = new Map<string, number>();
    const applicable = candidates.filter((c) => {
        if (c.act.jurisdiction === 'STATE' && c.act.state !== location.state) {
            const k = `${c.act.name} (${c.act.state})`;
            wrongState.set(k, (wrongState.get(k) ?? 0) + 1);
            return false;
        }
        return true;
    });

    const existing = await prisma.complianceSchedule.findMany({
        where: { locationId: location.id, complianceId: { in: applicable.map((c) => c.id) } },
        select: { complianceId: true, isActive: true },
    });
    const existingIds = new Set(existing.map((e) => e.complianceId));
    const toCreate = applicable.filter((c) => !existingIds.has(c.id));

    const highRisk = toCreate.filter((c) => c.risk === 'HIGH').length;
    if (highRisk > 0 && !input.approverId) {
        throw new HttpError(400, `${highRisk} high-risk compliance(s) need an approver. Choose an approver.`);
    }

    const foundIds = new Set(found.map((c) => c.id));
    const foundActIds = new Set(found.map((c) => c.act.id));

    const summary = {
        dryRun,
        location: location.name,
        selected: candidates.length,
        toActivate: toCreate.length,
        alreadyActive: existing.filter((e) => e.isActive).length,
        alreadyInactive: existing.filter((e) => !e.isActive).length,
        skippedWrongState: [...wrongState].map(([act, count]) => ({ act, count })),
        unknownComplianceIds: input.complianceIds.filter((id) => !foundIds.has(id)),
        actsWithNoActiveCompliances: input.actIds.filter((id) => !foundActIds.has(id)),
        highRisk,
        sample: toCreate
            .slice(0, 20)
            .map((c) => ({ code: c.code, title: c.title, risk: c.risk, frequency: c.frequency })),
    };

    if (dryRun || toCreate.length === 0) return { ...summary, created: 0 };

    const startDate = parseDateOnly(input.startDate);
    const created = await prisma.$transaction(
        async (tx) => {
            let count = 0;
            for (const part of chunks(toCreate)) {
                const r = await tx.complianceSchedule.createMany({
                    data: part.map((c) => ({
                        orgId,
                        complianceId: c.id,
                        entityId: input.entityId,
                        locationId: location.id,
                        departmentId: input.departmentId ?? null,
                        verticalId: input.verticalId ?? null,
                        ownerId: input.ownerId,
                        managerId: input.managerId,
                        approverId: input.approverId ?? null,
                        startDate,
                    })),
                    skipDuplicates: true,
                });
                count += r.count;
            }
            await recordAudit(tx, actor, 'SCHEDULES_ACTIVATED', 'Location', location.id, {
                entityId: input.entityId,
                created: count,
                ownerId: input.ownerId,
                managerId: input.managerId,
                approverId: input.approverId ?? null,
                startDate: input.startDate,
            });
            return count;
        },
        { timeout: 60_000 },
    );

    return { ...summary, dryRun: false, created };
}

const people = { select: { id: true, name: true } } as const;

export async function listSchedules(orgId: string, q: ScheduleListQuery) {
    const compliance: Prisma.ComplianceWhereInput = {
        ...(q.actId ? { actId: q.actId } : {}),
        ...(q.search
            ? {
                OR: [
                    { title: { contains: q.search, mode: insensitive } },
                    { code: { contains: q.search, mode: insensitive } },
                    { act: { name: { contains: q.search, mode: insensitive } } },
                ],
            }
            : {}),
    };

    const where: Prisma.ComplianceScheduleWhereInput = {
        orgId,
        ...(q.status === 'active' ? { isActive: true } : q.status === 'inactive' ? { isActive: false } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.locationId ? { locationId: q.locationId } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.verticalId ? { verticalId: q.verticalId } : {}),
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.managerId ? { managerId: q.managerId } : {}),
        ...(Object.keys(compliance).length ? { compliance } : {}),
    };

    const [total, items] = await prisma.$transaction([
        prisma.complianceSchedule.count({ where }),
        prisma.complianceSchedule.findMany({
            where,
            include: {
                compliance: {
                    select: {
                        code: true,
                        title: true,
                        risk: true,
                        frequency: true,
                        act: { select: { name: true, state: true, jurisdiction: true } },
                    },
                },
                entity: { select: { id: true, name: true, code: true } },
                location: { select: { id: true, name: true, state: true } },
                department: { select: { id: true, name: true } },
                vertical: { select: { id: true, name: true } },
                owner: people,
                manager: people,
                approver: people,
            },
            orderBy: [{ location: { name: 'asc' } }, { compliance: { title: 'asc' } }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
}

export async function updateSchedule(actor: AuthUser, id: string, input: ScheduleUpdateInput) {
    return prisma.$transaction(async (tx) => {
        const before = await tx.complianceSchedule.findFirst({
            where: { id, orgId: actor.orgId },
            include: {
                compliance: { select: { risk: true, isActive: true } },
                location: { select: { isActive: true, entity: { select: { isActive: true } } } },
            },
        });
        if (!before) throw new HttpError(404, 'Schedule not found');

        const ownerId = input.ownerId ?? before.ownerId;
        const managerId = input.managerId ?? before.managerId;
        const approverId = input.approverId === undefined ? before.approverId : input.approverId;

        if (ownerId === managerId) throw new HttpError(400, 'Owner and manager must be different people');
        if (approverId && (approverId === ownerId || approverId === managerId)) {
            throw new HttpError(400, 'The approver must be a different person from the owner and manager');
        }
        if (before.compliance.risk === 'HIGH' && !approverId) {
            throw new HttpError(400, 'A high-risk compliance needs an approver');
        }
        await assertAssignees(tx, actor.orgId, [input.ownerId, input.managerId, input.approverId]);

        if (
            input.isActive === true &&
            !before.isActive &&
            !(before.compliance.isActive && before.location.isActive && before.location.entity.isActive)
        ) {
            throw new HttpError(400, 'The compliance, location or entity is inactive');
        }

        const after = await tx.complianceSchedule.update({
            where: { id },
            data: { ownerId, managerId, approverId, isActive: input.isActive },
        });

        // Only items nobody has submitted yet are reassigned
        const assignmentChanged =
            ownerId !== before.ownerId ||
            managerId !== before.managerId ||
            approverId !== before.approverId;
        let reassigned = 0;
        if (assignmentChanged && input.applyToOpenInstances) {
            const r = await tx.complianceInstance.updateMany({
                where: { scheduleId: id, status: { in: ['DUE', 'RETURNED'] } },
                data: { ownerId, managerId, approverId },
            });
            reassigned = r.count;
        }

        const changes = changedFields(before, after, ['ownerId', 'managerId', 'approverId', 'isActive']) as Record<
            string,
            unknown
        >;
        if (Object.keys(changes).length) {
            await recordAudit(tx, actor, 'SCHEDULE_UPDATED', 'ComplianceSchedule', id, {
                ...changes,
                reassignedInstances: reassigned,
            } as Prisma.InputJsonValue);
        }
        return { ...after, reassignedInstances: reassigned };
    });
}