import { chunks } from '../../lib/chunks';
import { parseDateOnly, toDateOnly } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { EMAIL_TYPES } from '../notifications/notify';
import { planExpiryNotices } from './expiry';

const DAY = 86_400_000;
const MAX_ALERT_DAYS = 999;
const MAX_RECORDS = 100_000;

// Runs once a day from the scheduler. Safe to run twice: each reminder has a unique key per person.
export async function runDocumentExpiry(today: string) {
    const start = parseDateOnly(today);
    const rows = await prisma.documentRecord.findMany({
        where: {
            deletedAt: null,
            alertDays: { not: null },
            expiryDate: { gte: new Date(start.getTime() - 7 * DAY), lte: new Date(start.getTime() + MAX_ALERT_DAYS * DAY) },
        },
        select: {
            id: true,
            orgId: true,
            name: true,
            expiryDate: true,
            alertDays: true,
            ownerId: true,
            managerId: true,
            location: { select: { name: true } },
            category: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
        take: MAX_RECORDS + 1,
    });
    if (rows.length > MAX_RECORDS) throw new Error(`Too many documents for one expiry run (more than ${MAX_RECORDS})`);

    const notices = planExpiryNotices(
        rows.map((r) => ({
            id: r.id,
            orgId: r.orgId,
            name: r.name,
            expiryDate: toDateOnly(r.expiryDate as Date),
            alertDays: r.alertDays as number,
            location: r.location.name,
            category: r.category.name,
            ownerId: r.ownerId,
            managerId: r.managerId,
        })),
        today,
    );

    // Only people who can still sign in get reminders
    const userIds = [...new Set(notices.map((n) => n.userId))];
    const users = new Map<string, { emailAlerts: boolean }>();
    for (const part of chunks(userIds, 5000)) {
        const found = await prisma.user.findMany({
            where: { id: { in: part }, isActive: true },
            select: { id: true, emailAlerts: true },
        });
        for (const u of found) users.set(u.id, { emailAlerts: u.emailAlerts });
    }

    const data = notices
        .filter((n) => users.has(n.userId))
        .map((n) => ({
            orgId: n.orgId,
            userId: n.userId,
            type: 'DOCUMENT_EXPIRING' as const,
            title: n.title.slice(0, 250),
            body: n.body,
            dedupeKey: n.dedupeKey,
            emailStatus:
                EMAIL_TYPES.has('DOCUMENT_EXPIRING') && users.get(n.userId)?.emailAlerts ? ('PENDING' as const) : ('NONE' as const),
        }));

    let created = 0;
    for (const part of chunks(data, 500)) {
        const r = await prisma.notification.createMany({ data: part, skipDuplicates: true });
        created += r.count;
    }
    return { documentsChecked: rows.length, reminders: created };
}