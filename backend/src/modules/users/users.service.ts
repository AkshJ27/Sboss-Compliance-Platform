import { randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma';
import { HttpError, rethrowUnique } from '../../lib/errors';
import { changedFields, recordAudit } from '../../lib/audit';
import { hashPassword } from '../../lib/password';
import { verticalLimit } from '../../lib/vertical-limit';
import type { AuthUser } from '../../middleware/auth';
import { clearVerticalScope } from '../../lib/vertical-scope';
import { domainOf, planVendorAccess } from './vendor-access';
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
    verticalScope: { select: { vertical: { select: { id: true, name: true } } } },
} as const;

type Selected = { verticalScope: { vertical: { id: string; name: string } }[] } & Record<string, unknown>;
// "verticals": the verticals the user is limited to, for the screen
const shape = <T extends Selected>(u: T) => {
    const { verticalScope, ...rest } = u;
    return { ...rest, verticals: verticalScope.map((v) => v.vertical) };
};

// A user limited to some verticals (a vendor) sees only themselves and the people working on their verticals' items
export async function listUsers(actor: AuthUser) {
    const limit = verticalLimit(actor);
    const onMyVerticals = limit
        ? {
            OR: [
                { id: actor.id },
                { ownedSchedules: { some: { verticalId: { in: limit } } } },
                { managedSchedules: { some: { verticalId: { in: limit } } } },
                { approvedSchedules: { some: { verticalId: { in: limit } } } },
            ],
        }
        : {};
    const rows = await prisma.user.findMany({ where: { orgId: actor.orgId, ...onMyVerticals }, select, orderBy: { name: 'asc' } });
    return rows.map(shape);
}

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

    if (!invited) return { ...shape(user), invite: null };
    const emailed = await sendLinkAsAdmin(actor, user.id, 'INVITE');
    return { ...shape(user), invite: { emailed } };
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
        verticalIds?: string[];
    },
) {
    if (input.managerId) await checkManager(actor.orgId, id, input.managerId);
    const { verticalIds, ...fields } = input;
    if (verticalIds?.length) {
        const found = await prisma.vertical.count({ where: { orgId: actor.orgId, id: { in: verticalIds } } });
        if (found !== new Set(verticalIds).size) throw new HttpError(400, 'One of those verticals was not found');
    }
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

        const before = await tx.userVertical.findMany({ where: { userId: id }, select: { verticalId: true } });
        if (verticalIds) {
            await tx.userVertical.deleteMany({ where: { userId: id } });
            if (verticalIds.length) {
                await tx.userVertical.createMany({ data: [...new Set(verticalIds)].map((verticalId) => ({ userId: id, verticalId })) });
            }
        }
        const data = {
            ...fields,
            ...(fields.employeeCode !== undefined ? { employeeCode: fields.employeeCode || null } : {}),
            ...(fields.mobile !== undefined ? { mobile: fields.mobile || null } : {}),
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
        const scopeChanged =
            verticalIds !== undefined &&
            [...new Set(verticalIds)].sort().join() !== before.map((b) => b.verticalId).sort().join();
        if (Object.keys(changes as object).length || scopeChanged) {
            await recordAudit(tx, actor, 'USER_UPDATED', 'User', id, {
                ...(changes as object),
                ...(scopeChanged ? { verticals: { from: before.map((b) => b.verticalId), to: verticalIds } } : {}),
            });
        }
        clearVerticalScope(id);
        return shape(updated);
    });
}

/**
 * Limits every outside user (a vendor: an email outside the admin's own domain) to the verticals of the items they
 * work on. Checked first with dryRun. Each person's verticals can still be changed by hand afterwards.
 */
export async function setVendorAccess(actor: AuthUser, dryRun: boolean) {
    const me = await prisma.user.findFirst({ where: { id: actor.id, orgId: actor.orgId }, select: { email: true } });
    if (!me) throw new HttpError(404, 'User not found');
    const companyDomain = domainOf(me.email);
    const [users, schedules, verticals] = await Promise.all([
        prisma.user.findMany({
            where: { orgId: actor.orgId },
            select: { id: true, name: true, email: true, role: true, isActive: true, verticalScope: { select: { verticalId: true } } },
        }),
        prisma.complianceSchedule.findMany({
            where: { orgId: actor.orgId, isActive: true },
            select: { ownerId: true, managerId: true, approverId: true, verticalId: true },
        }),
        prisma.vertical.findMany({ where: { orgId: actor.orgId }, select: { id: true, name: true } }),
    ]);
    const plan = planVendorAccess(
        users.map((u) => ({ ...u, verticalIds: u.verticalScope.map((v) => v.verticalId) })),
        schedules,
        companyDomain,
    );
    const nameOf = new Map(verticals.map((v) => [v.id, v.name]));
    const result = {
        companyDomain,
        dryRun,
        vendors: plan.vendors.map((v) => ({ name: v.name, email: v.email, verticals: v.verticalIds.map((id) => nameOf.get(id) ?? id), changed: v.changed })),
        withoutItems: plan.withoutItems,
        toChange: plan.vendors.filter((v) => v.changed).length,
    };
    if (dryRun) return result;

    const changed = plan.vendors.filter((v) => v.changed);
    await prisma.$transaction(async (tx) => {
        for (const v of changed) {
            await tx.userVertical.deleteMany({ where: { userId: v.userId } });
            await tx.userVertical.createMany({ data: v.verticalIds.map((verticalId) => ({ userId: v.userId, verticalId })) });
        }
        await recordAudit(tx, actor, 'VENDOR_ACCESS_SET', 'User', actor.orgId, {
            companyDomain,
            users: changed.map((v) => ({ email: v.email, verticals: v.verticalIds.map((id) => nameOf.get(id) ?? id) })),
        });
    });
    clearVerticalScope();
    return result;
}