import type { Prisma } from '@prisma/client';
import { EMAIL_TYPES } from './notify';

export type DueDateNoticeInput = {
    actorId: string;
    actorName: string;
    code: string;
    title: string;
    moves: { ownerId: string; dueDate: string }[]; // dueDate is the new date, YYYY-MM-DD
};
export type DueDateNotice = { userId: string; title: string; body: string };

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

// One notice per owner, however many of their items moved. The admin who applied the change is not told.
export function planDueDateNotices(i: DueDateNoticeInput): DueDateNotice[] {
    const byOwner = new Map<string, { count: number; first: string }>();
    for (const m of i.moves) {
        if (m.ownerId === i.actorId) continue;
        const g = byOwner.get(m.ownerId);
        if (!g) {
            byOwner.set(m.ownerId, { count: 1, first: m.dueDate });
        } else {
            g.count++;
            if (m.dueDate < g.first) g.first = m.dueDate;
        }
    }

    const code = oneLine(i.code);
    const title = oneLine(i.title);
    const who = oneLine(i.actorName);
    return [...byOwner].map(([userId, g]) => ({
        userId,
        title: `Due dates changed: ${code}`,
        body:
            `${who} applied a change in the law to ${code}: ${title}. ` +
            (g.count === 1
                ? `1 of your items now falls due on ${g.first}.`
                : `${g.count} of your items now fall due on different dates. The earliest is ${g.first}.`),
    }));
}

// Runs inside the same transaction that moves the items
export async function notifyDueDatesMoved(
    tx: Prisma.TransactionClient,
    i: DueDateNoticeInput & { orgId: string },
) {
    const planned = planDueDateNotices(i);
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
                type: 'LAW_CHANGE' as const,
                title: p.title,
                body: p.body,
                emailStatus:
                    EMAIL_TYPES.has('LAW_CHANGE') && user.emailAlerts ? ('PENDING' as const) : ('NONE' as const),
            },
        ];
    });
    if (data.length) await tx.notification.createMany({ data });
}