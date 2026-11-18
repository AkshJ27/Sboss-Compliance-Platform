// Works out which verticals each outside user (a vendor) should be limited to: the verticals of the items they work on.
// Plain logic with no database, so it is easy to test.

export type AccessUser = { id: string; name: string; email: string; role: string; isActive: boolean; verticalIds: string[] };
export type AccessSchedule = { ownerId: string; managerId: string; approverId: string | null; verticalId: string | null };

export const domainOf = (email: string) => email.trim().toLowerCase().split('@')[1] ?? '';

export type VendorAccess = { userId: string; name: string; email: string; verticalIds: string[]; changed: boolean };

/**
 * Anyone active and not an admin whose email is outside the company's own domain is treated as a vendor,
 * and limited to the verticals of the active items they own, manage or approve. People with no items yet are listed
 * apart, so an admin can set them by hand.
 */
export function planVendorAccess(users: readonly AccessUser[], schedules: readonly AccessSchedule[], companyDomain: string) {
    const verticalsOf = new Map<string, Set<string>>();
    const add = (userId: string | null, verticalId: string | null) => {
        if (!userId || !verticalId) return;
        if (!verticalsOf.has(userId)) verticalsOf.set(userId, new Set());
        verticalsOf.get(userId)?.add(verticalId);
    };
    for (const s of schedules) {
        add(s.ownerId, s.verticalId);
        add(s.managerId, s.verticalId);
        add(s.approverId, s.verticalId);
    }

    const vendors: VendorAccess[] = [];
    const withoutItems: { name: string; email: string }[] = [];
    for (const u of users) {
        if (!u.isActive || u.role === 'ORG_ADMIN' || domainOf(u.email) === companyDomain.toLowerCase()) continue;
        const ids = [...(verticalsOf.get(u.id) ?? [])].sort();
        if (!ids.length) {
            withoutItems.push({ name: u.name, email: u.email });
            continue;
        }
        const changed = ids.join() !== [...u.verticalIds].sort().join();
        vendors.push({ userId: u.id, name: u.name, email: u.email, verticalIds: ids, changed });
    }
    return { vendors, withoutItems };
}