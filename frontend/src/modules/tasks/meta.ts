import type { TaskPriority, TaskStatus } from './types';

export const PRIORITIES: TaskPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

export const PRIORITY_LABEL: Record<TaskPriority, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const PRIORITY_COLOR: Record<TaskPriority, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' };
export const PRIORITY_HEX: Record<TaskPriority, string> = { HIGH: '#e5383b', MEDIUM: '#f59e0b', LOW: '#22c55e' };

export const STATUS_LABEL: Record<TaskStatus, string> = {
    OPEN: 'Open',
    IN_PROGRESS: 'In progress',
    DONE: 'Done',
    CANCELLED: 'Cancelled',
};
export const STATUS_COLOR: Record<TaskStatus, string> = {
    OPEN: 'blue',
    IN_PROGRESS: 'gold',
    DONE: 'green',
    CANCELLED: 'default',
};