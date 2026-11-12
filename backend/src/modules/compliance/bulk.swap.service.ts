import type { InstanceStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { toDateOnly } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import { notifyBulkAssigned } from '../notifications/bulk-notify';
import { columnsFor, planInstanceSwap, planScheduleSwap, signatureOf } from './bulk.engine';
import type { Assignment, Role } from './bulk.engine';
import type { SwapInput } from './bulk.schema';

const SWAPPABLE: InstanceStatus[] = ['DUE', 'RETURNED', 'SUBMITTED', 'MANAGER_APPROVED'];
const MAX_SCHEDULES = 20_000;
const MAX_ITEMS = 100_000;
const STALE = 'Some of these records were just changed by someone else. Nothing was changed. Run the preview again.';

type RoleWhere = { ownerId: string } | { managerId: string } | { approverId: string };

function roleWhere(roles: readonly Role[], from: string): RoleWhere[] {
    const out: RoleWhere[] = [];
    if (roles.includes('OWNER')) out.push({ ownerId: from });
    if (roles.includes('MANAGER')) out.push({ managerId: from });
    if (roles.includes('APPROVER')) out.push({ approverId: from });
    return out;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
    const out = new Map<string, T[]>();
    for (const it of items) {
        const k = key(it);
        const list = out.get(k);
        if (list) list.push(it);
        else out.set(k, [it]);
    }
    return out;
}

const rolesChanged = (set: Assignment): string[] => [
    ...(set.ownerId ? ['owner'] : []),
    ...(set.managerId ? ['manager'] : []),
    ...(set.approverId ? ['approver'] : []),
];

export async function swap(actor: AuthUser, input: SwapInput, dryRun: boolean) {
    const { orgId } = actor;

    const [from, to] = await Promise.all([
        prisma.user.findFirst({ where: { id: input.fromUserId, orgId }, select: { id: true, name: true } }),
        prisma.user.findFirst({
            where: { id: input.toUserId, orgId, isActive: true, role: { in: ['ORG_ADMIN', 'MEMBER'] } },
            select: { id: true, name: true },
        }),
    ]);
    if (!from) throw new HttpError(400, 'The person to replace was not found');
    if (!to) throw new HttpError(400, 'The new person must be an active user who is not a viewer');

    const roles = new Set<Role>(input.roles);
    const scope: { orgId: string; entityId?: string; locationId?: string } = { orgId };
    if (input.entityId) scope.entityId = input.entityId;
    if (input.locationId) scope.locationId = input.locationId;
    const either = roleWhere(input.roles, from.id);

    const scheduleRows = await prisma.complianceSchedule.findMany({
        where: { ...scope, OR: either },
        select: { id: true, ownerId: true, managerId: true, approverId: true },
        orderBy: { id: 'asc' },
        take: MAX_SCHEDULES + 1,
    });
    if (scheduleRows.length > MAX_SCHEDULES) {
        throw new HttpError(400, `More than ${MAX_SCHEDULES} schedules match. Narrow it with an entity or a location.`);
    }

    const itemRows = input.includeOpenItems
        ? await prisma.complianceInstance.findMany({
            where: { ...scope, status: { in: SWAPPABLE }, OR: either },
            select: {
                id: true,
                status: true,
                ownerId: true,
                managerId: true,
                approverId: true,
                submittedById: true,
                managerActionById: true,
            },
            orderBy: { id: 'asc' },
            take: MAX_ITEMS + 1,
        })
        : [];
    if (itemRows.length > MAX_ITEMS) {
        throw new HttpError(400, `More than ${MAX_ITEMS} open items match. Narrow it with an entity or a location.`);
    }

    const sPlan = planScheduleSwap(scheduleRows, from.id, to.id, roles);
    const iPlan = planInstanceSwap(itemRows, from.id, to.id, roles);

    // A few of the items that would move, so the admin can see what they are agreeing to
    const sampleIds = iPlan.moves.slice(0, 10).map((m) => m.id);
    const sampleRows = sampleIds.length
        ? await prisma.complianceInstance.findMany({
            where: { id: { in: sampleIds }, orgId },
            select: {
                id: true,
                dueDate: true,
                status: true,
                compliance: { select: { code: true, title: true } },
                location: { select: { name: true } },
            },
        })
        : [];
    const moveById = new Map(iPlan.moves.map((m) => [m.id, m]));

    const summary = {
        dryRun,
        from: from.name,
        to: to.name,
        roles: input.roles,
        schedules: {
            matched: sPlan.moves.length + sPlan.conflicts,
            willMove: sPlan.moves.length,
            conflicts: sPlan.conflicts,
        },
        items: {
            willMove: iPlan.moves.length,
            conflicts: iPlan.conflicts,
            blocked: iPlan.blocked,
            byRole: {
                owner: iPlan.moves.filter((m) => m.set.ownerId).length,
                manager: iPlan.moves.filter((m) => m.set.managerId).length,
                approver: iPlan.moves.filter((m) => m.set.approverId).length,
            },
        },
        sampleItems: sampleRows
            .map((r) => ({
                code: r.compliance.code,
                title: r.compliance.title,
                location: r.location.name,
                dueDate: toDateOnly(r.dueDate),
                status: r.status,
                roles: rolesChanged(moveById.get(r.id)?.set ?? {}),
            }))
            .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.code < b.code ? -1 : 1)),
    };

    if (dryRun || (sPlan.moves.length === 0 && iPlan.moves.length === 0)) {
        return { ...summary, schedulesMoved: 0, itemsMoved: 0 };
    }

    const done = await prisma.$transaction(
        async (tx) => {
            // Each group changes the same columns, so one update moves the whole group.
            // The update only touches rows that still hold the old person. If any row was changed
            // in the meantime the count is short, and everything is undone.
            let schedulesMoved = 0;
            for (const [sig, group] of groupBy(sPlan.moves, (m) => signatureOf(m.set))) {
                for (const part of chunks(group.map((m) => m.id), 5000)) {
                    const r = await tx.complianceSchedule.updateMany({
                        where: { id: { in: part }, orgId, ...columnsFor(sig, from.id) },
                        data: columnsFor(sig, to.id),
                    });
                    if (r.count !== part.length) throw new HttpError(409, STALE);
                    schedulesMoved += r.count;
                }
            }

            let itemsMoved = 0;
            const events: Prisma.InstanceEventCreateManyInput[] = [];
            for (const [key, group] of groupBy(iPlan.moves, (m) => `${signatureOf(m.set)}|${m.status}`)) {
                const [sig, status] = key.split('|') as [string, InstanceStatus];
                for (const part of chunks(group.map((m) => m.id), 5000)) {
                    const r = await tx.complianceInstance.updateMany({
                        where: { id: { in: part }, orgId, status, ...columnsFor(sig, from.id) },
                        data: columnsFor(sig, to.id),
                    });
                    if (r.count !== part.length) throw new HttpError(409, STALE);
                    itemsMoved += r.count;
                }
                for (const m of group) {
                    events.push({
                        orgId,
                        instanceId: m.id,
                        actorId: actor.id,
                        action: 'REASSIGNED',
                        fromStatus: m.status,
                        toStatus: m.status,
                        remarks: input.note || null,
                        data: { bulk: true, roles: rolesChanged(m.set), fromUserId: from.id, toUserId: to.id },
                    });
                }
            }
            for (const part of chunks(events, 1000)) await tx.instanceEvent.createMany({ data: part });

            await recordAudit(tx, actor, 'PEOPLE_SWAPPED', 'User', from.id, {
                fromUserId: from.id,
                toUserId: to.id,
                roles: input.roles,
                schedulesMoved,
                itemsMoved,
                conflicts: sPlan.conflicts + iPlan.conflicts,
                blocked: iPlan.blocked,
                ...(input.note ? { note: input.note } : {}),
            });

            const me = await tx.user.findFirst({ where: { id: actor.id, orgId }, select: { name: true } });
            await notifyBulkAssigned(tx, {
                orgId,
                actorId: actor.id,
                actorName: me?.name ?? 'An administrator',
                fromName: from.name,
                toUserId: to.id,
                schedules: schedulesMoved,
                items: itemsMoved,
            });

            return { schedulesMoved, itemsMoved };
        },
        { timeout: 5 * 60 * 1000, maxWait: 10_000 },
    );

    return { ...summary, dryRun: false, ...done };
}