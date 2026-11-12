import type { Prisma } from '@prisma/client';
import { EMAIL_TYPES } from './notify';

export type BulkNoticeInput = {
    actorId: string;
    actorName: string;
    fromName: string;
    toUserId: string;
    schedules: number;
    items: number;
};
export type BulkNotice = { title: string; body: string };

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One notice for the new person, however much moved. The admin who did it is not told.
export function planBulkNotice(i: BulkNoticeInput): BulkNotice | null {
    if (i.toUserId === i.actorId) return null;
    const parts: string[] = [];
    if (i.items > 0) parts.push(plural(i.items, 'open item'));
    if (i.schedules > 0) parts.push(plural(i.schedules, 'schedule'));
    if (parts.length === 0) return null;
    return {
        title: 'Work was assigned to you',
        body: `${oneLine(i.actorName)} moved ${parts.join(' and ')} from ${oneLine(i.fromName)} to you.`,
    };
}

// Runs inside the same transaction that moves the work
export async function notifyBulkAssigned(tx: Prisma.TransactionClient, i: BulkNoticeInput & { orgId: string }) {
    const n = planBulkNotice(i);
    if (!n) return;

    const user = await tx.user.findFirst({
        where: { id: i.toUserId, orgId: i.orgId, isActive: true },
        select: { id: true, emailAlerts: true },
    });
    if (!user) return;

    await tx.notification.create({
        data: {
            orgId: i.orgId,
            userId: user.id,
            type: 'ASSIGNED',
            title: n.title,
            body: n.body,
            emailStatus: EMAIL_TYPES.has('ASSIGNED') && user.emailAlerts ? ('PENDING' as const) : ('NONE' as const),
        },
    });
}