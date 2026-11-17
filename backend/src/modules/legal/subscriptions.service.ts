import { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { HttpError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import type { ActsQuery, BulkSubscriptionInput, SubscriptionInput } from './legal.schema';

// Configure LU Page: which Acts each person follows. Anyone can change their own choices.
// Company admins can change anyone's in their company.

const insensitive = Prisma.QueryMode.insensitive;

async function targetUser(actor: AuthUser, userId: string | undefined) {
    if (!userId || userId === actor.id) return actor.id;
    if (actor.role !== 'ORG_ADMIN') throw new HttpError(403, "Only an admin can change someone else's legal update choices");
    const u = await prisma.user.findFirst({ where: { id: userId, orgId: actor.orgId }, select: { id: true } });
    if (!u) throw new HttpError(404, 'User not found');
    return u.id;
}

function actsWhere(q: { region?: string; lawCategoryId?: string; search?: string }): Prisma.ActWhereInput {
    return {
        orgId: null,
        isActive: true,
        ...(q.region === 'CENTRAL' ? { jurisdiction: 'CENTRAL' as const } : q.region ? { state: q.region } : {}),
        ...(q.lawCategoryId ? { lawCategoryId: q.lawCategoryId } : {}),
        ...(q.search ? { name: { contains: q.search, mode: insensitive } } : {}),
    };
}

export async function listActs(actor: AuthUser, q: ActsQuery) {
    const userId = await targetUser(actor, q.userId);
    const where: Prisma.ActWhereInput = {
        ...actsWhere(q),
        ...(q.mapped === 'yes' ? { subscriptions: { some: { userId } } } : q.mapped === 'no' ? { subscriptions: { none: { userId } } } : {}),
    };
    const [total, mappedCount, rows] = await prisma.$transaction([
        prisma.act.count({ where }),
        prisma.actSubscription.count({ where: { userId } }),
        prisma.act.findMany({
            where,
            select: {
                id: true,
                name: true,
                jurisdiction: true,
                state: true,
                lawCategory: { select: { id: true, name: true } },
                subscriptions: { where: { userId }, select: { emailAlerts: true } },
                _count: { select: { legalUpdates: true } },
            },
            orderBy: { name: 'asc' },
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    const items = rows.map(({ subscriptions, _count, ...a }) => ({
        ...a,
        display: subscriptions.length > 0,
        emailAlerts: subscriptions[0]?.emailAlerts ?? false,
        updates: _count.legalUpdates,
    }));
    return { items, total, mappedCount, userId, page: q.page, limit: q.limit };
}

// One Act. Email alerts only make sense for a followed Act, so they switch on following too.
export async function setOne(actor: AuthUser, input: SubscriptionInput) {
    const userId = await targetUser(actor, input.userId);
    if (!(await prisma.act.count({ where: { id: input.actId, orgId: null } }))) throw new HttpError(404, 'Act not found');
    const follow = input.display || input.emailAlerts;
    await prisma.$transaction(async (tx) => {
        if (follow) {
            await tx.actSubscription.upsert({
                where: { userId_actId: { userId, actId: input.actId } },
                create: { orgId: actor.orgId, userId, actId: input.actId, emailAlerts: input.emailAlerts },
                update: { emailAlerts: input.emailAlerts },
            });
        } else {
            await tx.actSubscription.deleteMany({ where: { userId, actId: input.actId } });
        }
        if (userId !== actor.id) {
            await recordAudit(tx, actor, 'LEGAL_UPDATE_MAPPING_CHANGED', 'User', userId, { actId: input.actId, display: follow, emailAlerts: input.emailAlerts });
        }
    });
    return { display: follow, emailAlerts: follow && input.emailAlerts };
}

const MAX_BULK = 5000;

export async function setMany(actor: AuthUser, input: BulkSubscriptionInput) {
    const userId = await targetUser(actor, input.userId);
    const acts = await prisma.act.findMany({
        where: input.actIds ? { id: { in: input.actIds }, orgId: null } : actsWhere(input.allMatching ?? {}),
        select: { id: true },
        take: MAX_BULK + 1,
    });
    if (acts.length > MAX_BULK) throw new HttpError(400, `More than ${MAX_BULK} Acts match. Narrow the filters first.`);
    const ids = acts.map((a) => a.id);

    await prisma.$transaction(async (tx) => {
        for (const part of chunks(ids, 1000)) {
            if (!input.display) {
                await tx.actSubscription.deleteMany({ where: { userId, actId: { in: part } } });
                continue;
            }
            await tx.actSubscription.createMany({
                data: part.map((actId) => ({ orgId: actor.orgId, userId, actId, emailAlerts: input.emailAlerts ?? false })),
                skipDuplicates: true,
            });
            if (input.emailAlerts !== undefined) {
                await tx.actSubscription.updateMany({ where: { userId, actId: { in: part } }, data: { emailAlerts: input.emailAlerts } });
            }
        }
        await recordAudit(tx, actor, 'LEGAL_UPDATE_MAPPING_BULK', 'User', userId, {
            acts: ids.length,
            display: input.display,
            emailAlerts: input.emailAlerts ?? null,
        });
    });
    return { acts: ids.length };
}