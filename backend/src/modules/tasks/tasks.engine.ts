import type { Role, TaskStatus } from '@prisma/client';

// Everything here is plain logic with no database, so it is easy to test.

export const OPEN_STATUSES: readonly TaskStatus[] = ['OPEN', 'IN_PROGRESS'];
export const isOpen = (s: TaskStatus) => OPEN_STATUSES.includes(s);

const NEXT: Record<TaskStatus, readonly TaskStatus[]> = {
    OPEN: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
    IN_PROGRESS: ['OPEN', 'DONE', 'CANCELLED'],
    DONE: ['OPEN'], // a done task can only be reopened
    CANCELLED: [], // cancelled is final
};

export const canTransition = (from: TaskStatus, to: TaskStatus) => NEXT[from].includes(to);

export type Actor = { id: string; role: Role };
export type Parties = { createdById: string; assigneeId: string };

// The creator and admins can edit, reassign and cancel
export function canManage(a: Actor, t: Parties): boolean {
    if (a.role === 'VIEWER') return false;
    return a.role === 'ORG_ADMIN' || a.id === t.createdById;
}

// The assignee can also work on the task: start it, finish it, reopen it and comment
export function canWork(a: Actor, t: Parties): boolean {
    if (a.role === 'VIEWER') return false;
    return canManage(a, t) || a.id === t.assigneeId;
}

export type Capabilities = {
    edit: boolean;
    reassign: boolean;
    comment: boolean;
    start: boolean;
    finish: boolean;
    reopen: boolean;
    cancel: boolean;
};

// What this person can do with this task. The screens show buttons from this, and the server decides again.
export function capabilitiesOf(a: Actor, t: Parties & { status: TaskStatus }): Capabilities {
    const open = isOpen(t.status);
    const manage = canManage(a, t);
    const work = canWork(a, t);
    return {
        edit: manage && open,
        reassign: manage && open,
        comment: work,
        start: work && t.status === 'OPEN',
        finish: work && open,
        reopen: work && t.status === 'DONE',
        cancel: manage && open,
    };
}

export type StatusProblem = 'NOT_ALLOWED' | 'SAME_STATUS' | 'INVALID_MOVE' | 'REMARKS_REQUIRED';

// null means the move is allowed
export function statusProblem(
    a: Actor,
    t: Parties & { status: TaskStatus },
    to: TaskStatus,
    remarks: string | undefined,
): StatusProblem | null {
    if (!canWork(a, t)) return 'NOT_ALLOWED';
    if (to === 'CANCELLED' && !canManage(a, t)) return 'NOT_ALLOWED';
    if (to === t.status) return 'SAME_STATUS';
    if (!canTransition(t.status, to)) return 'INVALID_MOVE';
    const needsReason = to === 'CANCELLED' || (t.status === 'DONE' && to === 'OPEN');
    if (needsReason && (remarks ?? '').trim().length < 3) return 'REMARKS_REQUIRED';
    return null;
}

// Dates are YYYY-MM-DD
export function isOverdue(status: TaskStatus, dueDate: string | null, today: string): boolean {
    return dueDate !== null && isOpen(status) && dueDate < today;
}