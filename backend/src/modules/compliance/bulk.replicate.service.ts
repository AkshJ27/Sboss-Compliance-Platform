import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import { effectivePeople, peopleProblem, planReplicate } from './bulk.engine';
import type { PeopleProblem } from './bulk.engine';
import type { ReplicateInput } from './bulk.schema';

const MAX_SOURCE = 5000;
const MAX_CREATE = 20_000;

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Names of the people who can no longer be given work (deactivated, viewers, or gone)
async function unusablePeople(db: Prisma.TransactionClient, orgId: string, ids: string[]): Promise<string[]> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return [];
    const found = await db.user.findMany({
        where: { id: { in: wanted }, orgId },
        select: { id: true, name: true, isActive: true, role: true },
    });
    const byId = new Map(found.map((u) => [u.id, u]));
    const bad = new Set<string>();
    for (const id of wanted) {
        const u = byId.get(id);
        if (!u) bad.add('an unknown user');
        else if (!u.isActive || u.role === 'VIEWER') bad.add(u.name);
    }
    return [...bad].sort(byCodeUnits);
}

export async function replicate(actor: AuthUser, input: ReplicateInput, dryRun: boolean) {
    const { orgId } = actor;

    const source = await prisma.location.findFirst({
        where: { id: input.sourceLocationId, orgId },
        select: { id: true, name: true },
    });
    if (!source) throw new HttpError(400, 'The source location was not found');

    const targetRows = await prisma.location.findMany({
        where: { id: { in: input.targetLocationIds }, orgId, isActive: true, entity: { isActive: true } },
        select: { id: true, name: true, state: true, entityId: true, entity: { select: { code: true } } },
    });
    if (targetRows.length !== input.targetLocationIds.length) {
        throw new HttpError(400, 'Some target locations were not found, or they (or their entity) are inactive');
    }
    const targets = [...targetRows].sort((a, b) => byCodeUnits(a.name, b.name) || byCodeUnits(a.id, b.id));

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

    // The source's active schedules, whose laws and Acts are still active
    const rows = await prisma.complianceSchedule.findMany({
        where: {
            orgId,
            locationId: source.id,
            isActive: true,
            compliance: {
                isActive: true,
                act: { isActive: true },
                ...(input.actIds?.length ? { actId: { in: input.actIds } } : {}),
            },
        },
        select: {
            complianceId: true,
            ownerId: true,
            managerId: true,
            approverId: true,
            departmentId: true,
            verticalId: true,
            libraryVersion: true,
            compliance: {
                select: {
                    code: true,
                    title: true,
                    risk: true,
                    version: true,
                    frequency: true,
                    periodBasis: true,
                    dueDay: true,
                    dueMonthOffset: true,
                    event: true,
                    dueDaysAfterEvent: true,
                    act: { select: { name: true, state: true, jurisdiction: true } },
                },
            },
        },
        orderBy: { id: 'asc' },
        take: MAX_SOURCE + 1,
    });
    if (rows.length > MAX_SOURCE) {
        throw new HttpError(400, `The source has more than ${MAX_SOURCE} schedules. Copy fewer Acts at a time.`);
    }
    if (rows.length === 0) throw new HttpError(400, 'The source location has no active schedules to copy');

    const sources = rows.map((r) => ({
        complianceId: r.complianceId,
        risk: r.compliance.risk,
        jurisdiction: r.compliance.act.jurisdiction,
        actName: r.compliance.act.name,
        actState: r.compliance.act.state,
        schedule: r,
    }));

    // What each target already has
    const found = await prisma.complianceSchedule.findMany({
        where: {
            orgId,
            locationId: { in: targets.map((t) => t.id) },
            complianceId: { in: sources.map((s) => s.complianceId) },
        },
        select: { locationId: true, complianceId: true, isActive: true },
    });
    const existingBy = new Map<string, Map<string, boolean>>();
    for (const e of found) {
        let m = existingBy.get(e.locationId);
        if (!m) {
            m = new Map();
            existingBy.set(e.locationId, m);
        }
        m.set(e.complianceId, e.isActive);
    }

    const plans = targets.map((target) => ({
        target,
        plan: planReplicate(sources, target.state, existingBy.get(target.id) ?? new Map<string, boolean>()),
    }));
    const total = plans.reduce((n, p) => n + p.plan.toCreate.length, 0);
    if (total > MAX_CREATE) {
        throw new HttpError(400, `This would create ${total} schedules, more than ${MAX_CREATE}. Choose fewer targets or Acts.`);
    }

    // The same compliance copied to several targets is checked once
    const union = new Map<string, (typeof sources)[number]>();
    for (const p of plans) for (const s of p.plan.toCreate) union.set(s.complianceId, s);

    const override = { ownerId: input.ownerId, managerId: input.managerId, approverId: input.approverId };

    if (total > 0) {
        const peopleIds: string[] = [];
        const problems: Record<PeopleProblem, number> = {
            SAME_OWNER_MANAGER: 0,
            APPROVER_NOT_DISTINCT: 0,
        };
        for (const s of union.values()) {
            const p = effectivePeople(s.schedule, override);
            peopleIds.push(p.ownerId, p.managerId);
            if (p.approverId) peopleIds.push(p.approverId);
            const problem = peopleProblem(p);
            if (problem) problems[problem]++;
        }

        const unusable = await unusablePeople(prisma, orgId, peopleIds);
        if (unusable.length > 0) {
            throw new HttpError(
                400,
                `These people can no longer be assigned: ${unusable.join(', ')}. Choose someone else in the owner, manager and approver fields.`,
            );
        }
        if (problems.SAME_OWNER_MANAGER > 0) {
            throw new HttpError(
                400,
                `${problems.SAME_OWNER_MANAGER} compliance(s) would have the same person as owner and manager. Choose different people.`,
            );
        }
        if (problems.APPROVER_NOT_DISTINCT > 0) {
            throw new HttpError(
                400,
                `${problems.APPROVER_NOT_DISTINCT} compliance(s) would have an approver who is also the owner or manager. Choose different people.`,
            );
        }

    }

    const unionList = [...union.values()].sort((a, b) =>
        byCodeUnits(a.schedule.compliance.code, b.schedule.compliance.code),
    );
    const summary = {
        dryRun,
        source: source.name,
        toCreate: total,
        alreadyActive: plans.reduce((n, p) => n + p.plan.alreadyActive, 0),
        alreadyInactive: plans.reduce((n, p) => n + p.plan.alreadyInactive, 0),
        highRisk: unionList.filter((s) => s.risk === 'HIGH').length,
        // The copies follow the library's current rule, so these were behind the law at the source
        sourceBehindLibrary: unionList.filter((s) => s.schedule.libraryVersion < s.schedule.compliance.version).length,
        sample: unionList.slice(0, 20).map((s) => ({
            code: s.schedule.compliance.code,
            title: s.schedule.compliance.title,
            risk: s.risk,
            frequency: s.schedule.compliance.frequency,
        })),
        targets: plans.map(({ target, plan }) => ({
            location: `${target.entity.code} / ${target.name}`,
            state: target.state,
            toCreate: plan.toCreate.length,
            alreadyActive: plan.alreadyActive,
            alreadyInactive: plan.alreadyInactive,
            skippedWrongState: plan.skippedWrongState,
        })),
    };

    if (dryRun || total === 0) return { ...summary, created: 0 };

    const startDate = parseDateOnly(input.startDate);
    const created = await prisma.$transaction(
        async (tx) => {
            let count = 0;
            for (const { target, plan } of plans) {
                if (plan.toCreate.length === 0) continue;
                let made = 0;
                for (const part of chunks(plan.toCreate, 1000)) {
                    const r = await tx.complianceSchedule.createMany({
                        data: part.map((s) => {
                            const p = effectivePeople(s.schedule, override);
                            const c = s.schedule.compliance;
                            return {
                                orgId,
                                complianceId: s.complianceId,
                                entityId: target.entityId,
                                locationId: target.id,
                                departmentId: input.departmentId ?? s.schedule.departmentId,
                                verticalId: input.verticalId ?? s.schedule.verticalId,
                                ownerId: p.ownerId,
                                managerId: p.managerId,
                                approverId: p.approverId,
                                startDate,
                                // The copy follows the library as it is today
                                libraryVersion: c.version,
                                frequency: c.frequency,
                                periodBasis: c.periodBasis,
                                dueDay: c.dueDay,
                                dueMonthOffset: c.dueMonthOffset,
                                event: c.event,
                                dueDaysAfterEvent: c.dueDaysAfterEvent,
                            };
                        }),
                        skipDuplicates: true,
                    });
                    made += r.count;
                }
                await recordAudit(tx, actor, 'SCHEDULES_REPLICATED', 'Location', target.id, {
                    sourceLocationId: source.id,
                    source: source.name,
                    created: made,
                    startDate: input.startDate,
                });
                count += made;
            }
            return count;
        },
        { timeout: 5 * 60 * 1000, maxWait: 10_000 },
    );

    return { ...summary, dryRun: false, created };
}