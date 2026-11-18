import { prisma } from './prisma';

// The verticals each user is limited to, read on every request. Kept for a short while so a page full of
// requests does not ask the database each time. A change made on the Users page clears it at once.
const TTL = 30_000;
const cache = new Map<string, { ids: string[]; at: number }>();

export async function loadVerticalScope(userId: string): Promise<string[]> {
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < TTL) return hit.ids;
    const rows = await prisma.userVertical.findMany({ where: { userId }, select: { verticalId: true } });
    const ids = rows.map((r) => r.verticalId);
    cache.set(userId, { ids, at: Date.now() });
    return ids;
}

export function clearVerticalScope(userId?: string) {
    if (userId) cache.delete(userId);
    else cache.clear();
}