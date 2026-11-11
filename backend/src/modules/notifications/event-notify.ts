import type { Prisma } from '@prisma/client';
import { EMAIL_TYPES } from './notify';

export type EventNoticeInput = {
    actorId: string;
    actorName: string;
    event: string;
    location: string;
    eventDate: string; // YYYY-MM-DD
    items: { ownerId: string; dueDate: string }[];
};
export type EventNotice = { userId: string; title: string; body: string };

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

// One notice per owner, however many items they got. The person who recorded the event is not told.
export function planEventNotifications(i: EventNoticeInput): EventNotice[] {
    const byOwner = new Map<string, { count: number; firstDue: string }>();
    for (const it of i.items) {
        if (it.ownerId === i.actorId) continue;
        const g = byOwner.get(it.ownerId);
        if (!g) {
            byOwner.set(it.ownerId, { count: 1, firstDue: it.dueDate });
        } else {
            g.count++;
            if (it.dueDate < g.firstDue) g.firstDue = it.dueDate;
        }
    }

    const event = oneLine(i.event);
    const place = oneLine(i.location);
    const who = oneLine(i.actorName);
    return [...byOwner].map(([userId, g]) => ({
        userId,
        title: `New compliance items: ${event}`,
        body:
            `${who} recorded "${event}" at ${place} on ${i.eventDate}. ` +
            (g.count === 1
                ? `1 item was created for you, due ${g.firstDue}.`
                : `${g.count} items were created for you. The first is due ${g.firstDue}.`),
    }));
}

// Runs inside the same transaction that creates the items
export async function notifyEventTriggered(
    tx: Prisma.TransactionClient,
    i: EventNoticeInput & { orgId: string },
) {
    const planned = planEventNotifications(i);
    if (planned.length === 0) return;

    const users = await tx.user.findMany({
        where: { id: { in: planned.map((p) => p.userId) }, orgId: i.orgId, isActive: true },
        select: { id: true, emailAlerts: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const data = planned.flatMap((p) => {
        const user = byId.get(p.userId);
        if (!user) return [];
        return [
            {
                orgId: i.orgId,
                userId: p.userId,
                type: 'EVENT_TRIGGERED' as const,
                title: p.title,
                body: p.body,
                emailStatus:
                    EMAIL_TYPES.has('EVENT_TRIGGERED') && user.emailAlerts ? ('PENDING' as const) : ('NONE' as const),
            },
        ];
    });
    if (data.length) await tx.notification.createMany({ data });
}