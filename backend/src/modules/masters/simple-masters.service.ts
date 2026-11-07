import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, rethrowUnique } from '../../lib/errors';
import { recordAudit, changedFields } from '../../lib/audit';
import type { AuthUser } from '../../middleware/auth';

export type SimpleKind = 'vertical' | 'department' | 'locationType';

type Row = { id: string; orgId: string; name: string; isActive: boolean };
type Client = PrismaClient | Prisma.TransactionClient;

interface SimpleDelegate {
    findMany(args: object): Promise<Row[]>;
    findFirst(args: object): Promise<Row | null>;
    create(args: object): Promise<Row>;
    update(args: object): Promise<Row>;
}

const META: Record<SimpleKind, { label: string; code: string }> = {
    vertical: { label: 'Vertical', code: 'VERTICAL' },
    department: { label: 'Department', code: 'DEPARTMENT' },
    locationType: { label: 'Location type', code: 'LOCATION_TYPE' },
};

const delegate = (c: Client, kind: SimpleKind) => c[kind] as unknown as SimpleDelegate;

export const list = (orgId: string, kind: SimpleKind, includeInactive: boolean) =>
    delegate(prisma, kind).findMany({
        where: { orgId, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: { name: 'asc' },
    });

export async function create(actor: AuthUser, kind: SimpleKind, input: { name: string }) {
    const { label, code } = META[kind];
    try {
        return await prisma.$transaction(async (tx) => {
            const d = delegate(tx, kind);
            const dup = await d.findFirst({
                where: {
                    orgId: actor.orgId,
                    name: { equals: input.name, mode: Prisma.QueryMode.insensitive },
                },
            });
            if (dup) throw new HttpError(409, `${label} already exists`);

            const row = await d.create({ data: { orgId: actor.orgId, name: input.name } });
            await recordAudit(tx, actor, `${code}_CREATED`, label, row.id, { name: row.name });
            return row;
        });
    } catch (e) {
        rethrowUnique(e, `${label} already exists`);
    }
}

export async function update(
    actor: AuthUser,
    kind: SimpleKind,
    id: string,
    input: { name?: string; isActive?: boolean },
) {
    const { label, code } = META[kind];
    try {
        return await prisma.$transaction(async (tx) => {
            const d = delegate(tx, kind);
            const before = await d.findFirst({ where: { id, orgId: actor.orgId } });
            if (!before) throw new HttpError(404, `${label} not found`);

            if (input.name) {
                const dup = await d.findFirst({
                    where: {
                        orgId: actor.orgId,
                        NOT: { id },
                        name: { equals: input.name, mode: Prisma.QueryMode.insensitive },
                    },
                });
                if (dup) throw new HttpError(409, `${label} already exists`);
            }

            const after = await d.update({ where: { id }, data: input });
            const changes = changedFields(before, after, ['name', 'isActive']);
            if (Object.keys(changes as object).length) {
                await recordAudit(tx, actor, `${code}_UPDATED`, label, id, changes);
            }
            return after;
        });
    } catch (e) {
        rethrowUnique(e, `${label} already exists`);
    }
}