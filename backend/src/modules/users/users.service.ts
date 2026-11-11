import { randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma';
import { HttpError, rethrowUnique } from '../../lib/errors';
import { changedFields, recordAudit } from '../../lib/audit';
import { hashPassword } from '../../lib/password';
import type { AuthUser } from '../../middleware/auth';
import { sendLinkAsAdmin } from '../auth/auth-tokens.service';

type RoleName = 'ORG_ADMIN' | 'MEMBER' | 'VIEWER';

const select = {
    id: true,
    name: true,
    email: true,
    role: true,
    isActive: true,
    passwordSetAt: true, // empty until the person has chosen a password
    lockedUntil: true,
    lastLoginAt: true,
    createdAt: true,
} as const;

export const listUsers = (orgId: string) =>
    prisma.user.findMany({ where: { orgId }, select, orderBy: { name: 'asc' } });

export async function createUser(
    actor: AuthUser,
    input: { name: string; email: string; password?: string; role: RoleName },
) {
    const invited = !input.password;
    // An invited person gets a random password nobody knows, until they choose their own
    const passwordHash = await hashPassword(input.password ?? randomBytes(32).toString('base64url'));

    const user = await prisma
        .$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    orgId: actor.orgId,
                    name: input.name,
                    email: input.email,
                    role: input.role,
                    passwordHash,
                    passwordSetAt: invited ? null : new Date(),
                },
                select,
            });
            await recordAudit(tx, actor, 'USER_CREATED', 'User', created.id, {
                email: created.email,
                role: created.role,
                invited,
            });
            return created;
        })
        .catch((e: unknown) => rethrowUnique(e, 'Email already registered'));

    if (!invited) return { ...user, invite: null };
    const emailed = await sendLinkAsAdmin(actor, user.id, 'INVITE');
    return { ...user, invite: { emailed } };
}

export async function updateUser(
    actor: AuthUser,
    id: string,
    input: { name?: string; role?: RoleName; isActive?: boolean },
) {
    return prisma.$transaction(async (tx) => {
        // orgId in the filter means one company can never touch another's users
        const target = await tx.user.findFirst({ where: { id, orgId: actor.orgId } });
        if (!target) throw new HttpError(404, 'User not found');

        // The acting admin can't lock themselves out, so an org always keeps an admin
        if (
            id === actor.id &&
            (input.isActive === false || (input.role && input.role !== 'ORG_ADMIN'))
        ) {
            throw new HttpError(400, 'You cannot deactivate or demote yourself');
        }

        const updated = await tx.user.update({ where: { id }, data: input, select });

        // Deactivation or a role change ends their sessions, so it takes effect quickly
        if (input.isActive === false || (input.role && input.role !== target.role)) {
            await tx.refreshToken.deleteMany({ where: { userId: id } });
        }
        // A deactivated person's pending links stop working
        if (input.isActive === false) {
            await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
        }

        const changes = changedFields(target, updated, ['name', 'role', 'isActive']);
        if (Object.keys(changes as object).length) {
            await recordAudit(tx, actor, 'USER_UPDATED', 'User', id, changes);
        }
        return updated;
    });
}