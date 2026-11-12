import type { TaskPriority } from './types';

export type Scope = 'mine' | 'created' | 'all';
export type StatusTab = 'ACTIVE' | 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | 'ALL';

// What a click on a card or a chart slice asks the page to show
export type CardPick = {
    status?: StatusTab;
    overdue?: boolean;
    due?: { from: string; to: string };
    priority?: TaskPriority;
};

export const STATUS_TABS: { value: StatusTab; label: string }[] = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'OPEN', label: 'Open' },
    { value: 'IN_PROGRESS', label: 'In progress' },
    { value: 'DONE', label: 'Done' },
    { value: 'CANCELLED', label: 'Cancelled' },
    { value: 'ALL', label: 'All' },
];

// What each tab asks the server for. Active means open or in progress.
export const STATUS_PARAM: Record<StatusTab, string | null> = {
    ACTIVE: 'OPEN,IN_PROGRESS',
    OPEN: 'OPEN',
    IN_PROGRESS: 'IN_PROGRESS',
    DONE: 'DONE',
    CANCELLED: 'CANCELLED',
    ALL: null,
};

export const isStatusTab = (v: string | null): v is StatusTab => STATUS_TABS.some((t) => t.value === v);

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;