import { chunks } from '../../lib/chunks';
import { todayInIndia } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { EMAIL_TYPES } from './notify';

const TITLE = 'The law library was updated';
const BODY =
    'Some of the laws you follow changed. Open Setup, Law changes to see what changed and decide what applies to your records.';

// Tells the admins of every company that follows one of these compliances at an older version.
// At most one notice per admin per day: the page and the menu badge always show the live count.
export async function notifyLawChange(complianceIds: string[]): Promise<number> {
    const ids = [...new Set(complianceIds)];
    if (ids.length === 0) return 0;

    const orgIds = new Set<string>();
    for (const part of chunks(ids, 5000)) {
        const [pins, current] = await Promise.all([
            prisma.complianceSchedule.groupBy({
                by: ['orgId', 'complianceId', 'libraryVersion'],
                where: { isActive: true, complianceId: { in: part } },
                _count: { _all: true },
            }),
            prisma.compliance.findMany({ where: { id: { in: part } }, select: { id: true, version: true } }),
        ]);
        const version = new Map(current.map((c) => [c.id, c.version]));
        for (const g of pins) {
            const v = version.get(g.complianceId);
            if (v !== undefined && g.libraryVersion < v) orgIds.add(g.orgId);
        }
    }
    if (orgIds.size === 0) return 0;

    const admins: { id: string; orgId: string; emailAlerts: boolean }[] = [];
    for (const part of chunks([...orgIds], 5000)) {
        admins.push(
            ...(await prisma.user.findMany({
                where: { orgId: { in: part }, role: 'ORG_ADMIN', isActive: true },
                select: { id: true, orgId: true, emailAlerts: true },
            })),
        );
    }

    const dedupeKey = `law-change:${todayInIndia()}`;
    let created = 0;
    for (const part of chunks(admins, 500)) {
        const r = await prisma.notification.createMany({
            data: part.map((u) => ({
                orgId: u.orgId,
                userId: u.id,
                type: 'LAW_CHANGE' as const,
                title: TITLE,
                body: BODY,
                dedupeKey,
                emailStatus:
                    EMAIL_TYPES.has('LAW_CHANGE') && u.emailAlerts ? ('PENDING' as const) : ('NONE' as const),
            })),
            skipDuplicates: true,
        });
        created += r.count;
    }
    return created;
}