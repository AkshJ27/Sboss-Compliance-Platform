import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, rethrowUnique } from '../../lib/errors';
import { recordAudit, changedFields } from '../../lib/audit';
import type { AuthUser } from '../../middleware/auth';

const DUP_MESSAGE = 'An entity with this name or code already exists';

export const list = (orgId: string, includeInactive: boolean) =>
    prisma.entity.findMany({
        where: { orgId, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: { name: 'asc' },
    });

export async function create(actor: AuthUser, input: { name: string; code: string }) {
    try {
        return await prisma.$transaction(async (tx) => {
            const dup = await tx.entity.findFirst({
                where: {
                    orgId: actor.orgId,
                    OR: [
                        { name: { equals: input.name, mode: Prisma.QueryMode.insensitive } },
                        { code: input.code },
                    ],
                },
            });
            if (dup) throw new HttpError(409, DUP_MESSAGE);

            const row = await tx.entity.create({
                data: { orgId: actor.orgId, name: input.name, code: input.code },
            });
            await recordAudit(tx, actor, 'ENTITY_CREATED', 'Entity', row.id, {
                name: row.name,
                code: row.code,
            });
            return row;
        });
    } catch (e) {
        rethrowUnique(e, DUP_MESSAGE);
    }
}

export async function update(
    actor: AuthUser,
    id: string,
    input: { name?: string; code?: string; isActive?: boolean },
) {
    try {
        return await prisma.$transaction(async (tx) => {
            const before = await tx.entity.findFirst({ where: { id, orgId: actor.orgId } });
            if (!before) throw new HttpError(404, 'Entity not found');

            if (input.name || input.code) {
                const clashes: Prisma.EntityWhereInput[] = [];
                if (input.name) {
                    clashes.push({ name: { equals: input.name, mode: Prisma.QueryMode.insensitive } });
                }
                if (input.code) clashes.push({ code: input.code });

                const dup = await tx.entity.findFirst({
                    where: { orgId: actor.orgId, NOT: { id }, OR: clashes },
                });
                if (dup) throw new HttpError(409, DUP_MESSAGE);
            }

            const after = await tx.entity.update({ where: { id }, data: input });
            const changes = changedFields(before, after, ['name', 'code', 'isActive']);
            if (Object.keys(changes as object).length) {
                await recordAudit(tx, actor, 'ENTITY_UPDATED', 'Entity', id, changes);
            }
            return after;
        });
    } catch (e) {
        rethrowUnique(e, DUP_MESSAGE);
    }
}