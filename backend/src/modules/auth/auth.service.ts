import { Prisma, User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import {
    signAccessToken,
    newRefreshToken,
    hashToken,
    REFRESH_TTL_DAYS,
} from '../../lib/tokens';
import type { AuthUser } from '../../middleware/auth';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const GENERIC_LOGIN_ERROR = 'Invalid credentials, or account temporarily locked';

type Meta = { ip?: string; userAgent?: string };

export const toPublicUser = (u: User) => ({
    id: u.id,
    orgId: u.orgId,
    name: u.name,
    email: u.email,
    role: u.role,
});

async function issueSession(user: User, meta: Meta) {
    const refreshToken = newRefreshToken();
    await prisma.refreshToken.create({
        data: {
            userId: user.id,
            tokenHash: hashToken(refreshToken),
            expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
            ip: meta.ip,
            userAgent: meta.userAgent?.slice(0, 255),
        },
    });
    return { accessToken: signAccessToken(user), refreshToken, user: toPublicUser(user) };
}

export async function registerOrganization(
    input: { orgName: string; name: string; email: string; password: string },
    meta: Meta,
) {
    if (await prisma.user.findUnique({ where: { email: input.email } })) {
        throw new HttpError(409, 'Email already registered');
    }
    const passwordHash = await hashPassword(input.password);

    let user: User;
    try {
        user = await prisma.$transaction(async (tx) => {
            const org = await tx.organization.create({ data: { name: input.orgName } });
            return tx.user.create({
                data: {
                    orgId: org.id,
                    email: input.email,
                    name: input.name,
                    passwordHash,
                    role: 'ORG_ADMIN',
                },
            });
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new HttpError(409, 'Email already registered');
        }
        throw e;
    }
    return issueSession(user, meta);
}

export async function login(email: string, password: string, meta: Meta) {
    const user = await prisma.user.findUnique({ where: { email } });
    const locked = !!user?.lockedUntil && user.lockedUntil > new Date();

    // Always run one hash comparison, so timing is the same in every case
    const passwordOk = await verifyPassword(password, user?.passwordHash);

    if (!user || locked || !passwordOk || !user.isActive) {
        if (user && !locked && !passwordOk) {
            const failed = user.failedLoginCount + 1;
            await prisma.user.update({
                where: { id: user.id },
                data:
                    failed >= MAX_FAILED_LOGINS
                        ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) }
                        : { failedLoginCount: failed },
            });
        }
        throw new HttpError(401, GENERIC_LOGIN_ERROR);
    }

    const updated = await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    return issueSession(updated, meta);
}

export async function refresh(rawToken: string | undefined, meta: Meta) {
    if (!rawToken) throw new HttpError(401, 'Not logged in');

    const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        include: { user: true },
    });
    if (!stored) throw new HttpError(401, 'Session expired');

    // A token that was already used has come back: assume theft and end all sessions
    if (stored.revokedAt) {
        await prisma.refreshToken.updateMany({
            where: { userId: stored.userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        throw new HttpError(401, 'Session expired');
    }

    if (stored.expiresAt < new Date() || !stored.user.isActive) {
        throw new HttpError(401, 'Session expired');
    }

    // Rotate: only one request can win this update
    const revoked = await prisma.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw new HttpError(401, 'Session expired');

    return issueSession(stored.user, meta);
}

export async function logout(rawToken: string | undefined) {
    if (!rawToken) return;
    await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
    });
}

export async function getMe(actor: AuthUser) {
    const user = await prisma.user.findFirst({
        where: { id: actor.id, orgId: actor.orgId, isActive: true },
        include: { org: { select: { id: true, name: true } } },
    });
    if (!user) throw new HttpError(401, 'Not logged in');
    return { ...toPublicUser(user), isPlatformAdmin: user.isPlatformAdmin, organization: user.org };
}