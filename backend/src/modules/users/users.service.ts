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
    managerId: true,
    manager: { select: { id: true, name: true } },
    defaultApproverId: true,
    defaultApprover: { select: { id: true, name: true } },
    employeeCode: true,
    mobile: true,
    emailAlerts: true,
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

// The manager must be someone else in the company, and the chain of managers must not loop back
async function checkManager(orgId: string, userId: string, managerId: string) {
    if (managerId === userId) throw new HttpError(400, 'A person cannot be their own manager');
    let current: string | null = managerId;
    for (let steps = 0; current && steps < 50; steps++) {
        const m: { id: string; managerId: string | null } | null = await prisma.user.findFirst({
            where: { id: current, orgId },
            select: { id: true, managerId: true },
        });
        if (!m) throw new HttpError(400, steps === 0 ? 'That manager was not found' : 'The manager chain is broken');
        if (m.managerId === userId) throw new HttpError(400, 'That would make a loop: this person already manages that manager');
        current = m.managerId;
    }
}

// The default approver must be another active, non-viewer person in the company
async function checkApprover(orgId: string, userId: string, approverId: string) {
    if (approverId === userId) throw new HttpError(400, 'A person cannot approve their own items');
    const a = await prisma.user.findFirst({ where: { id: approverId, orgId }, select: { isActive: true, role: true } });
    if (!a) throw new HttpError(400, 'That approver was not found');
    if (!a.isActive || a.role === 'VIEWER') throw new HttpError(400, 'The approver must be an active user who is not a viewer');
}

export async function updateUser(
    actor: AuthUser,
    id: string,
    input: {
        name?: string;
        role?: RoleName;
        isActive?: boolean;
        managerId?: string | null;
        defaultApproverId?: string | null;
        employeeCode?: string | null;
        mobile?: string | null;
    },
) {
    if (input.managerId) await checkManager(actor.orgId, id, input.managerId);
    if (input.defaultApproverId) await checkApprover(actor.orgId, id, input.defaultApproverId);
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

        const data = {
            ...input,
            ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode || null } : {}),
            ...(input.mobile !== undefined ? { mobile: input.mobile || null } : {}),
        };
        const updated = await tx.user.update({ where: { id }, data, select });

        // Deactivation or a role change ends their sessions, so it takes effect quickly
        if (input.isActive === false || (input.role && input.role !== target.role)) {
            await tx.refreshToken.deleteMany({ where: { userId: id } });
        }
        // A deactivated person's pending links stop working
        if (input.isActive === false) {
            await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
        }

        const changes = changedFields(target, updated, ['name', 'role', 'isActive', 'managerId', 'defaultApproverId', 'employeeCode', 'mobile']);
        if (Object.keys(changes as object).length) {
            await recordAudit(tx, actor, 'USER_UPDATED', 'User', id, changes);
        }
        return updated;
    });
}