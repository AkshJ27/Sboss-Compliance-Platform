import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, rethrowUnique } from '../../lib/errors';
import { recordAudit, changedFields } from '../../lib/audit';
import type { AuthUser } from '../../middleware/auth';

const DUP_MESSAGE = 'A location with this name already exists for this entity';

const include = {
    entity: { select: { id: true, name: true, code: true } },
    locationType: { select: { id: true, name: true } },
} as const;

type ListQuery = {
    entityId?: string;
    locationTypeId?: string;
    state?: string;
    search?: string;
    includeInactive: boolean;
    page: number;
    limit: number;
};

// limit: the verticals a vendor user is limited to. They see only the locations with work for those verticals.
export async function list(orgId: string, q: ListQuery, limit: string[] | null = null) {
    const where: Prisma.LocationWhereInput = {
        orgId,
        ...(limit ? { schedules: { some: { verticalId: { in: limit } } } } : {}),
        ...(q.includeInactive ? {} : { isActive: true }),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.locationTypeId ? { locationTypeId: q.locationTypeId } : {}),
        ...(q.state ? { state: q.state } : {}),
        ...(q.search
            ? {
                OR: [
                    { name: { contains: q.search, mode: Prisma.QueryMode.insensitive } },
                    { city: { contains: q.search, mode: Prisma.QueryMode.insensitive } },
                ],
            }
            : {}),
    };

    const [total, items] = await prisma.$transaction([
        prisma.location.count({ where }),
        prisma.location.findMany({
            where,
            include,
            orderBy: [{ entity: { name: 'asc' } }, { name: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);

    return { items, total, page: q.page, limit: q.limit };
}

// A location type must belong to the same company and be active
async function assertLocationType(tx: Prisma.TransactionClient, orgId: string, id: string) {
    const found = await tx.locationType.findFirst({ where: { id, orgId, isActive: true } });
    if (!found) throw new HttpError(400, 'Location type not found or inactive');
}

export async function create(
    actor: AuthUser,
    input: {
        entityId: string;
        locationTypeId?: string;
        name: string;
        state: string;
        city?: string;
        address?: string;
    },
) {
    try {
        return await prisma.$transaction(async (tx) => {
            const entity = await tx.entity.findFirst({
                where: { id: input.entityId, orgId: actor.orgId, isActive: true },
            });
            if (!entity) throw new HttpError(400, 'Entity not found or inactive');

            if (input.locationTypeId) await assertLocationType(tx, actor.orgId, input.locationTypeId);

            const dup = await tx.location.findFirst({
                where: {
                    entityId: entity.id,
                    name: { equals: input.name, mode: Prisma.QueryMode.insensitive },
                },
            });
            if (dup) throw new HttpError(409, DUP_MESSAGE);

            const row = await tx.location.create({
                data: { orgId: actor.orgId, ...input },
                include,
            });
            await recordAudit(tx, actor, 'LOCATION_CREATED', 'Location', row.id, {
                name: row.name,
                entity: entity.code,
                state: row.state,
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
    input: {
        name?: string;
        locationTypeId?: string | null;
        state?: string;
        city?: string | null;
        address?: string | null;
        isActive?: boolean;
    },
) {
    try {
        return await prisma.$transaction(async (tx) => {
            const before = await tx.location.findFirst({
                where: { id, orgId: actor.orgId },
                include: { entity: { select: { isActive: true } } },
            });
            if (!before) throw new HttpError(404, 'Location not found');

            if (input.isActive === true && !before.entity.isActive) {
                throw new HttpError(400, 'Activate the entity first');
            }
            if (input.locationTypeId) await assertLocationType(tx, actor.orgId, input.locationTypeId);

            if (input.name) {
                const dup = await tx.location.findFirst({
                    where: {
                        entityId: before.entityId,
                        NOT: { id },
                        name: { equals: input.name, mode: Prisma.QueryMode.insensitive },
                    },
                });
                if (dup) throw new HttpError(409, DUP_MESSAGE);
            }

            const after = await tx.location.update({ where: { id }, data: input, include });

            // A location that moves to another state no longer follows the old state's laws: those assignments stop.
            // The new state's laws are then added from Schedules > Activate.
            let stoppedSchedules = 0;
            if (input.state && input.state !== before.state) {
                const r = await tx.complianceSchedule.updateMany({
                    where: {
                        orgId: actor.orgId,
                        locationId: id,
                        isActive: true,
                        compliance: { act: { jurisdiction: 'STATE', NOT: { state: input.state } } },
                    },
                    data: { isActive: false },
                });
                stoppedSchedules = r.count;
            }
            const changes = changedFields(before, after, [
                'name',
                'state',
                'city',
                'address',
                'locationTypeId',
                'isActive',
            ]);
            if (Object.keys(changes as object).length) {
                await recordAudit(tx, actor, 'LOCATION_UPDATED', 'Location', id, { ...(changes as object), stoppedSchedules });
            }
            return { ...after, stoppedSchedules };
        });
    } catch (e) {
        rethrowUnique(e, DUP_MESSAGE);
    }
}