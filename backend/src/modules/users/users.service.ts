import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import type { AuthUser } from '../../middleware/auth';

const select = {
    id: true,
    name: true,
    email: true,
    role: true,
    isActive: true,
    lastLoginAt: true,
    createdAt: true,
} as const;

export const listUsers = (orgId: string) =>
    prisma.user.findMany({ where: { orgId }, select, orderBy: { name: 'asc' } });

export async function createUser(
    orgId: string,
    input: { name: string; email: string; password: string; role: 'ORG_ADMIN' | 'MEMBER' | 'VIEWER' },
) {
    try {
        return await prisma.user.create({
            data: {
                orgId,
                name: input.name,
                email: input.email,
                role: input.role,
                passwordHash: await hashPassword(input.password),
            },
            select,
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new HttpError(409, 'Email already registered');
        }
        throw e;
    }
}

export async function updateUser(
    actor: AuthUser,
    id: string,
    input: { name?: string; role?: 'ORG_ADMIN' | 'MEMBER' | 'VIEWER'; isActive?: boolean },
) {
    // orgId in the filter means one company can never touch another's users
    const target = await prisma.user.findFirst({ where: { id, orgId: actor.orgId } });
    if (!target) throw new HttpError(404, 'User not found');

    // The acting admin can't lock themselves out, so an org always keeps an admin
    if (
        id === actor.id &&
        (input.isActive === false || (input.role && input.role !== 'ORG_ADMIN'))
    ) {
        throw new HttpError(400, 'You cannot deactivate or demote yourself');
    }

    const updated = await prisma.user.update({ where: { id }, data: input, select });

    // Deactivation or a role change ends their sessions, so it takes effect quickly
    if (input.isActive === false || (input.role && input.role !== target.role)) {
        await prisma.refreshToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }
    return updated;
}