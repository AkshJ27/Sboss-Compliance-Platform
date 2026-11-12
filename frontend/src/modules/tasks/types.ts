export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type Person = { id: string; name: string };

export type Capabilities = {
    edit: boolean;
    reassign: boolean;
    comment: boolean;
    start: boolean;
    finish: boolean;
    reopen: boolean;
    cancel: boolean;
};

export type TaskRow = {
    id: string;
    title: string;
    description: string | null;
    priority: TaskPriority;
    status: TaskStatus;
    dueDate: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
    createdAt: string;
    updatedAt: string;
    assigneeId: string;
    createdById: string;
    assignee: Person;
    createdBy: Person;
    entity: { id: string; name: string; code: string } | null;
    overdue: boolean;
    can: Capabilities;
};

export type TaskAction = 'CREATED' | 'UPDATED' | 'REASSIGNED' | 'STATUS_CHANGED' | 'COMMENTED';

export type TaskEventRow = {
    id: string;
    action: TaskAction;
    fromStatus: TaskStatus | null;
    toStatus: TaskStatus | null;
    remarks: string | null;
    data: unknown;
    createdAt: string;
    actor: Person;
};

export type TaskDetail = TaskRow & { events: TaskEventRow[] };
export type TaskPage = { items: TaskRow[]; total: number; page: number; limit: number };

export type TaskSummary = {
    asOf: string;
    total: number;
    counts: { open: number; inProgress: number; done: number; cancelled: number };
    openByPriority: { high: number; medium: number; low: number };
    overdue: number;
    dueSoon: number;
};