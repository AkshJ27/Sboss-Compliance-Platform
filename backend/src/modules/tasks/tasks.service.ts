import { Prisma } from '@prisma/client';
import type { TaskAction, TaskStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { changedFields, recordAudit } from '../../lib/audit';
import { parseDateOnly, toDateOnly, todayInIndia } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import { verticalLimit } from '../../lib/vertical-limit';
import { addDays } from '../notifications/digest';
import { canManage, canWork, capabilitiesOf, isOpen, isOverdue, OPEN_STATUSES, statusProblem } from './tasks.engine';
import { planAssigned, planComment, planStatus, sendTaskNotices } from './tasks.notify';
import type { CreateInput, ListQuery, ReassignInput, StatusInput, SummaryQuery, UpdateInput } from './tasks.schema';

type Db = Prisma.TransactionClient;

const OPEN: TaskStatus[] = [...OPEN_STATUSES];
const insensitive = Prisma.QueryMode.insensitive;
const STATUS_TEXT: Record<TaskStatus, string> = {
    OPEN: 'open',
    IN_PROGRESS: 'in progress',
    DONE: 'done',
    CANCELLED: 'cancelled',
};
const MANAGE_ONLY = 'Only the person who created this task, or an admin, can do that';

// Admins see every task. Members see only the tasks they created or were given.
export function visibleTasks(actor: AuthUser): Prisma.TaskWhereInput {
    const base: Prisma.TaskWhereInput = { orgId: actor.orgId };
    if (actor.role === 'ORG_ADMIN') return base;
    return { ...base, OR: [{ assigneeId: actor.id }, { createdById: actor.id }] };
}

type Filters = SummaryQuery & { status?: TaskStatus[] };

function buildWhere(actor: AuthUser, f: Filters): Prisma.TaskWhereInput {
    const today = parseDateOnly(todayInIndia());
    const and: Prisma.TaskWhereInput[] = [visibleTasks(actor)];

    if (f.status) and.push({ status: { in: f.status } });
    if (f.priority) and.push({ priority: { in: f.priority } });
    if (f.assigneeId) and.push({ assigneeId: { in: f.assigneeId } });
    if (f.createdById) and.push({ createdById: { in: f.createdById } });
    if (f.entityId) and.push({ entityId: { in: f.entityId } });
    if (f.dueFrom || f.dueTo) {
        and.push({
            dueDate: {
                ...(f.dueFrom ? { gte: parseDateOnly(f.dueFrom) } : {}),
                ...(f.dueTo ? { lte: parseDateOnly(f.dueTo) } : {}),
            },
        });
    }
    if (f.overdue) and.push({ status: { in: OPEN }, dueDate: { lt: today } });
    if (f.search) and.push({ title: { contains: f.search, mode: insensitive } });
    return { AND: and };
}

const taskSelect = {
    id: true,
    title: true,
    description: true,
    priority: true,
    status: true,
    dueDate: true,
    completedAt: true,
    cancelledAt: true,
    createdAt: true,
    updatedAt: true,
    assigneeId: true,
    createdById: true,
    assignee: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
    entity: { select: { id: true, name: true, code: true } },
} as const;

const eventSelect = {
    id: true,
    action: true,
    fromStatus: true,
    toStatus: true,
    remarks: true,
    data: true,
    createdAt: true,
    actor: { select: { id: true, name: true } },
} as const;

function present<T extends { status: TaskStatus; dueDate: Date | null; assigneeId: string; createdById: string }>(
    row: T,
    actor: AuthUser,
    today: string,
) {
    return {
        ...row,
        overdue: isOverdue(row.status, row.dueDate ? toDateOnly(row.dueDate) : null, today),
        can: capabilitiesOf(actor, row),
    };
}

function orderOf(sortBy: ListQuery['sortBy'], order: ListQuery['order']): Prisma.TaskOrderByWithRelationInput[] {
    if (sortBy === 'created') return [{ createdAt: order }, { id: 'asc' }];
    // High comes first when ascending, because the priorities are defined in that order
    if (sortBy === 'priority') return [{ priority: order }, { dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
    return [{ dueDate: { sort: order, nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }];
}

export async function summary(actor: AuthUser, f: SummaryQuery) {
    const where = buildWhere(actor, f);
    const todayText = todayInIndia();
    const today = parseDateOnly(todayText);
    const soon = parseDateOnly(addDays(todayText, 7));

    const [byStatus, byPriority, overdue, dueSoon] = await Promise.all([
        prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } }),
        prisma.task.groupBy({
            by: ['priority'],
            where: { AND: [where, { status: { in: OPEN } }] },
            _count: { _all: true },
        }),
        prisma.task.count({ where: { AND: [where, { status: { in: OPEN }, dueDate: { lt: today } }] } }),
        prisma.task.count({
            where: { AND: [where, { status: { in: OPEN }, dueDate: { gte: today, lte: soon } }] },
        }),
    ]);

    const status = { OPEN: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 };
    for (const g of byStatus) status[g.status] = g._count._all;
    const priority = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const g of byPriority) priority[g.priority] = g._count._all;

    return {
        asOf: todayText,
        total: status.OPEN + status.IN_PROGRESS + status.DONE + status.CANCELLED,
        counts: {
            open: status.OPEN,
            inProgress: status.IN_PROGRESS,
            done: status.DONE,
            cancelled: status.CANCELLED,
        },
        openByPriority: { high: priority.HIGH, medium: priority.MEDIUM, low: priority.LOW },
        overdue,
        dueSoon,
    };
}

export async function list(actor: AuthUser, q: ListQuery) {
    const where = buildWhere(actor, q);
    const [total, rows] = await prisma.$transaction([
        prisma.task.count({ where }),
        prisma.task.findMany({
            where,
            select: taskSelect,
            orderBy: orderOf(q.sortBy, q.order),
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    const today = todayInIndia();
    return { items: rows.map((r) => present(r, actor, today)), total, page: q.page, limit: q.limit };
}

export async function get(actor: AuthUser, id: string) {
    const row = await prisma.task.findFirst({
        where: { AND: [visibleTasks(actor), { id }] },
        select: {
            ...taskSelect,
            events: { select: eventSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500 },
        },
    });
    if (!row) throw new HttpError(404, 'Task not found');
    return present(row, actor, todayInIndia());
}

// ---- Helpers for changes -----------------------------------------------------------

// A user limited to some verticals (a vendor) can only give tasks to themselves and the people on their verticals' items
async function assertAssignee(db: Db, actor: AuthUser, id: string) {
    const limit = verticalLimit(actor);
    const u = await db.user.findFirst({
        where: {
            id,
            orgId: actor.orgId,
            isActive: true,
            role: { in: ['ORG_ADMIN', 'MEMBER'] },
            ...(limit && id !== actor.id
                ? {
                    OR: [
                        { ownedSchedules: { some: { verticalId: { in: limit } } } },
                        { managedSchedules: { some: { verticalId: { in: limit } } } },
                        { approvedSchedules: { some: { verticalId: { in: limit } } } },
                    ],
                }
                : {}),
        },
        select: { id: true, name: true },
    });
    if (!u) throw new HttpError(400, 'The assignee must be an active user who is not a viewer');
    return u;
}

async function assertEntity(db: Db, orgId: string, id: string) {
    const e = await db.entity.findFirst({ where: { id, orgId, isActive: true }, select: { id: true } });
    if (!e) throw new HttpError(400, 'Entity not found or inactive');
}

const assertNotPast = (due: string) => {
    if (due < todayInIndia()) throw new HttpError(400, 'The due date cannot be in the past');
};

async function actorName(db: Db, actor: AuthUser) {
    const u = await db.user.findFirst({ where: { id: actor.id, orgId: actor.orgId }, select: { name: true } });
    return u?.name ?? 'A colleague';
}

// A member with no part in the task cannot even tell it exists
async function loadForWrite(db: Db, actor: AuthUser, id: string) {
    const t = await db.task.findFirst({
        where: { AND: [visibleTasks(actor), { id }] },
        select: {
            id: true,
            title: true,
            description: true,
            priority: true,
            status: true,
            entityId: true,
            assigneeId: true,
            createdById: true,
            dueDate: true,
        },
    });
    if (!t) throw new HttpError(404, 'Task not found');
    return t;
}

function addEvent(
    tx: Db,
    actor: AuthUser,
    taskId: string,
    e: {
        action: TaskAction;
        fromStatus?: TaskStatus;
        toStatus?: TaskStatus;
        remarks?: string | null;
        data?: Prisma.InputJsonValue;
    },
) {
    return tx.taskEvent.create({
        data: {
            orgId: actor.orgId,
            taskId,
            actorId: actor.id,
            action: e.action,
            fromStatus: e.fromStatus ?? null,
            toStatus: e.toStatus ?? null,
            remarks: e.remarks ?? null,
            data: e.data,
        },
    });
}

const clash = () =>
    new HttpError(409, 'This task was just changed by someone else. Refresh and try again.');

// ---- Changes -----------------------------------------------------------------------

export async function create(actor: AuthUser, input: CreateInput) {
    if (input.dueDate) assertNotPast(input.dueDate);

    const id = await prisma.$transaction(async (tx) => {
        await assertAssignee(tx, actor, input.assigneeId);
        if (input.entityId) await assertEntity(tx, actor.orgId, input.entityId);

        const task = await tx.task.create({
            data: {
                orgId: actor.orgId,
                title: input.title,
                description: input.description || null,
                priority: input.priority,
                entityId: input.entityId ?? null,
                assigneeId: input.assigneeId,
                createdById: actor.id,
                dueDate: input.dueDate ? parseDateOnly(input.dueDate) : null,
            },
            select: { id: true, title: true },
        });

        await addEvent(tx, actor, task.id, {
            action: 'CREATED',
            toStatus: 'OPEN',
            data: { assigneeId: input.assigneeId, priority: input.priority, dueDate: input.dueDate ?? null },
        });
        await recordAudit(tx, actor, 'TASK_CREATED', 'Task', task.id, {
            assigneeId: input.assigneeId,
            priority: input.priority,
        });
        await sendTaskNotices(
            tx,
            actor.orgId,
            task.id,
            planAssigned({
                actorId: actor.id,
                actorName: await actorName(tx, actor),
                taskTitle: task.title,
                assigneeId: input.assigneeId,
                priority: input.priority,
                dueDate: input.dueDate ?? null,
            }),
        );
        return task.id;
    });
    return get(actor, id);
}

export async function update(actor: AuthUser, id: string, input: UpdateInput) {
    await prisma.$transaction(async (tx) => {
        const before = await loadForWrite(tx, actor, id);
        if (!canManage(actor, before)) throw new HttpError(403, MANAGE_ONLY);
        if (!isOpen(before.status)) throw new HttpError(409, 'Only open tasks can be edited');

        const currentDue = before.dueDate ? toDateOnly(before.dueDate) : null;
        if (input.dueDate && input.dueDate !== currentDue) assertNotPast(input.dueDate);
        if (input.entityId) await assertEntity(tx, actor.orgId, input.entityId);

        const after = {
            title: input.title ?? before.title,
            description: input.description === undefined ? before.description : input.description || null,
            priority: input.priority ?? before.priority,
            entityId: input.entityId === undefined ? before.entityId : input.entityId,
            dueDate: input.dueDate === undefined ? before.dueDate : input.dueDate ? parseDateOnly(input.dueDate) : null,
        };
        const changes = changedFields(before, after, ['title', 'description', 'priority', 'entityId', 'dueDate']);
        if (Object.keys(changes as object).length === 0) return;

        // Only if nobody changed the task's status in the meantime
        const r = await tx.task.updateMany({ where: { id, orgId: actor.orgId, status: before.status }, data: after });
        if (r.count !== 1) throw clash();

        await addEvent(tx, actor, id, { action: 'UPDATED', data: changes });
        await recordAudit(tx, actor, 'TASK_UPDATED', 'Task', id, changes);
    });
    return get(actor, id);
}

export async function reassign(actor: AuthUser, id: string, input: ReassignInput) {
    await prisma.$transaction(async (tx) => {
        const before = await loadForWrite(tx, actor, id);
        if (!canManage(actor, before)) throw new HttpError(403, MANAGE_ONLY);
        if (!isOpen(before.status)) throw new HttpError(409, 'Only open tasks can be reassigned');
        if (input.assigneeId === before.assigneeId) {
            throw new HttpError(400, 'This task is already assigned to that person');
        }
        const to = await assertAssignee(tx, actor, input.assigneeId);

        const r = await tx.task.updateMany({
            where: { id, orgId: actor.orgId, status: before.status, assigneeId: before.assigneeId },
            data: { assigneeId: to.id },
        });
        if (r.count !== 1) throw clash();

        await addEvent(tx, actor, id, {
            action: 'REASSIGNED',
            fromStatus: before.status,
            toStatus: before.status,
            remarks: input.remarks || null,
            data: { fromUserId: before.assigneeId, toUserId: to.id },
        });
        await recordAudit(tx, actor, 'TASK_REASSIGNED', 'Task', id, {
            fromUserId: before.assigneeId,
            toUserId: to.id,
        });
        await sendTaskNotices(
            tx,
            actor.orgId,
            id,
            planAssigned({
                actorId: actor.id,
                actorName: await actorName(tx, actor),
                taskTitle: before.title,
                assigneeId: to.id,
                previousAssigneeId: before.assigneeId,
                priority: before.priority,
                dueDate: before.dueDate ? toDateOnly(before.dueDate) : null,
            }),
        );
    });
    return get(actor, id);
}

export async function changeStatus(actor: AuthUser, id: string, input: StatusInput) {
    await prisma.$transaction(async (tx) => {
        const t = await loadForWrite(tx, actor, id);
        const problem = statusProblem(actor, t, input.status, input.remarks);

        if (problem === 'NOT_ALLOWED') {
            throw new HttpError(
                403,
                input.status === 'CANCELLED'
                    ? MANAGE_ONLY
                    : 'Only the assignee, the person who created this task, or an admin can change it',
            );
        }
        if (problem === 'SAME_STATUS') throw new HttpError(409, `This task is already ${STATUS_TEXT[t.status]}`);
        if (problem === 'INVALID_MOVE') {
            throw new HttpError(409, `A ${STATUS_TEXT[t.status]} task cannot be moved to ${STATUS_TEXT[input.status]}`);
        }
        if (problem === 'REMARKS_REQUIRED') {
            throw new HttpError(400, 'Add a short reason (at least 3 characters)');
        }

        const now = new Date();
        const r = await tx.task.updateMany({
            where: { id, orgId: actor.orgId, status: t.status },
            data: {
                status: input.status,
                completedAt: input.status === 'DONE' ? now : null,
                cancelledAt: input.status === 'CANCELLED' ? now : null,
            },
        });
        if (r.count !== 1) throw clash();

        await addEvent(tx, actor, id, {
            action: 'STATUS_CHANGED',
            fromStatus: t.status,
            toStatus: input.status,
            remarks: input.remarks || null,
        });
        await recordAudit(tx, actor, 'TASK_STATUS_CHANGED', 'Task', id, {
            from: t.status,
            to: input.status,
            ...(input.remarks ? { remarks: input.remarks } : {}),
        });
        await sendTaskNotices(
            tx,
            actor.orgId,
            id,
            planStatus({
                actorId: actor.id,
                actorName: await actorName(tx, actor),
                taskTitle: t.title,
                creatorId: t.createdById,
                assigneeId: t.assigneeId,
                from: t.status,
                to: input.status,
                remarks: input.remarks,
            }),
        );
    });
    return get(actor, id);
}

export async function comment(actor: AuthUser, id: string, text: string) {
    await prisma.$transaction(async (tx) => {
        const t = await loadForWrite(tx, actor, id);
        if (!canWork(actor, t)) {
            throw new HttpError(403, 'Only the assignee, the person who created this task, or an admin can comment');
        }
        await addEvent(tx, actor, id, { action: 'COMMENTED', remarks: text });
        await sendTaskNotices(
            tx,
            actor.orgId,
            id,
            planComment({
                actorId: actor.id,
                actorName: await actorName(tx, actor),
                taskTitle: t.title,
                creatorId: t.createdById,
                assigneeId: t.assigneeId,
                text,
            }),
        );
    });
    return get(actor, id);
}