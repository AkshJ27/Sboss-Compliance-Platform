import type { AuthUser } from '../middleware/auth';

// The verticals to limit this user to (a vendor's own), or null for no limit. Admins are never limited.
export const verticalLimit = (u: AuthUser): string[] | null =>
    u.role !== 'ORG_ADMIN' && u.verticalIds && u.verticalIds.length ? u.verticalIds : null;