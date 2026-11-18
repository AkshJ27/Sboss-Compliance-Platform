import { z } from 'zod';

// The Active / Inactive / All choice on master lists. "includeInactive=true" is still understood as All.
export const STATUS_FILTERS = ['active', 'inactive', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const statusQuery = z.enum(STATUS_FILTERS).optional();

export function activeWhere(q: { status?: StatusFilter; includeInactive?: boolean }): { isActive?: boolean } {
    if (q.status === 'inactive') return { isActive: false };
    if (q.status === 'all' || (q.status === undefined && q.includeInactive)) return {};
    return { isActive: true };
}