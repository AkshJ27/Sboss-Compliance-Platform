import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import type { AuditQuery } from './audit.schema';

const DAY = 86_400_000;

// Dates mean days in India time
const startOfDay = (d: string) => new Date(`${d}T00:00:00+05:30`);

export async function list(actor: AuthUser, q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
        orgId: actor.orgId,
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.action ? { action: q.action } : {}),
        ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.from || q.to
            ? {
                createdAt: {
                    ...(q.from ? { gte: startOfDay(q.from) } : {}),
                    ...(q.to ? { lt: new Date(startOfDay(q.to).getTime() + DAY) } : {}),
                },
            }
            : {}),
    };

    const [total, rows] = await prisma.$transaction([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
    const people = userIds.length
        ? await prisma.user.findMany({
            where: { id: { in: userIds }, orgId: actor.orgId },
            select: { id: true, name: true },
        })
        : [];
    const nameById = new Map(people.map((p) => [p.id, p.name]));

    const items = rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        meta: r.meta,
        user: r.userId ? { id: r.userId, name: nameById.get(r.userId) ?? null } : null,
    }));
    return { items, total, page: q.page, limit: q.limit };
}

// The values that exist, for filter dropdowns
export async function facets(actor: AuthUser) {
    const [actions, entityTypes] = await Promise.all([
        prisma.auditLog.findMany({
            where: { orgId: actor.orgId },
            distinct: ['action'],
            select: { action: true },
            orderBy: { action: 'asc' },
        }),
        prisma.auditLog.findMany({
            where: { orgId: actor.orgId },
            distinct: ['entityType'],
            select: { entityType: true },
            orderBy: { entityType: 'asc' },
        }),
    ]);
    return {
        actions: actions.map((a) => a.action),
        entityTypes: entityTypes.map((e) => e.entityType),
    };
}