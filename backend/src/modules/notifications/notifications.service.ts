import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import type { AuthUser } from '../../middleware/auth';
import type { ListQuery } from './notifications.schema';

const select = {
    id: true,
    type: true,
    title: true,
    body: true,
    instanceId: true,
    taskId: true,
    readAt: true,
    createdAt: true,
} as const;

// Every query is limited to the signed-in person's own notifications
const mine = (actor: AuthUser): Prisma.NotificationWhereInput => ({
    orgId: actor.orgId,
    userId: actor.id,
});

export async function list(actor: AuthUser, q: ListQuery) {
    const where: Prisma.NotificationWhereInput = {
        ...mine(actor),
        ...(q.unread ? { readAt: null } : {}),
        ...(q.type ? { type: q.type } : {}),
    };
    const [total, unreadCount, items] = await prisma.$transaction([
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { ...mine(actor), readAt: null } }),
        prisma.notification.findMany({
            where,
            select,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    return { items, total, unreadCount, page: q.page, limit: q.limit };
}

export async function unreadCount(actor: AuthUser) {
    return { unreadCount: await prisma.notification.count({ where: { ...mine(actor), readAt: null } }) };
}

export async function setRead(actor: AuthUser, ids: string[], read: boolean) {
    const r = await prisma.notification.updateMany({
        where: { ...mine(actor), id: { in: ids }, readAt: read ? null : { not: null } },
        data: { readAt: read ? new Date() : null },
    });
    return { updated: r.count };
}

export async function readAll(actor: AuthUser) {
    const r = await prisma.notification.updateMany({
        where: { ...mine(actor), readAt: null },
        data: { readAt: new Date() },
    });
    return { updated: r.count };
}

export async function getPreferences(actor: AuthUser) {
    const u = await prisma.user.findFirst({
        where: { id: actor.id, orgId: actor.orgId },
        select: { emailAlerts: true },
    });
    if (!u) throw new HttpError(401, 'Not logged in');
    return u;
}

export async function setPreferences(actor: AuthUser, emailAlerts: boolean) {
    await prisma.user.updateMany({ where: { id: actor.id, orgId: actor.orgId }, data: { emailAlerts } });
    return { emailAlerts };
}