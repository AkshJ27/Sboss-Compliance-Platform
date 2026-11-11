import type { AuthTokenType, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { hashPassword, verifyPassword } from '../../lib/password';
import { hashToken } from '../../lib/tokens';
import type { AuthUser } from '../../middleware/auth';
import { INVALID_LINK, deliver, issueToken, sentRecently } from './auth-tokens.service';
import * as auth from './auth.service';
import { buildLink, resetEmail } from './links';

type Db = Prisma.TransactionClient;

async function findUsable(db: Db, raw: string, type: AuthTokenType) {
    const row = await db.authToken.findUnique({
        where: { tokenHash: hashToken(raw) },
        include: {
            user: {
                select: {
                    id: true, orgId: true, email: true, name: true, role: true, isActive: true, passwordSetAt: true,
                },
            },
        },
    });
    if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date() || !row.user.isActive) {
        throw new HttpError(400, INVALID_LINK);
    }
    if (type === 'INVITE' && row.user.passwordSetAt) {
        throw new HttpError(400, 'This invitation was already used. Sign in, or choose "Forgot your password?".');
    }
    return row;
}

// Runs in the background after the reply, so the response never reveals whether the email exists
export async function requestPasswordReset(email: string, ip?: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return;
    if (await sentRecently(prisma, user.id, 'PASSWORD_RESET')) return;

    // Earlier links stay valid, so a stranger cannot cancel your genuine link by asking again
    const raw = await prisma.$transaction(async (tx) => {
        const token = await issueToken(tx, user.id, 'PASSWORD_RESET', null, false);
        await recordAudit(
            tx,
            { id: user.id, orgId: user.orgId, role: user.role },
            'PASSWORD_RESET_REQUESTED',
            'User',
            user.id,
            { ip: ip ?? null },
        );
        return token;
    });
    await deliver(
        user.email,
        resetEmail({ name: user.name, link: buildLink(env.APP_URL, '/reset-password', raw) }),
    );
}

export async function checkLink(raw: string, type: AuthTokenType) {
    const row = await findUsable(prisma, raw, type);
    return { email: row.user.email, name: row.user.name };
}

// Sets the password from an invitation or a reset link. The link works once.
export async function completeLink(raw: string, type: AuthTokenType, password: string, meta: auth.Meta) {
    await findUsable(prisma, raw, type); // reject bad links before spending time hashing
    const passwordHash = await hashPassword(password);

    await prisma.$transaction(async (tx) => {
        const row = await findUsable(tx, raw, type);

        const claimed = await tx.authToken.updateMany({
            where: { id: row.id, usedAt: null },
            data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) throw new HttpError(400, INVALID_LINK);

        await tx.user.update({
            where: { id: row.userId },
            data: { passwordHash, passwordSetAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        });
        // Any other outstanding link, and every session, stops working
        await tx.authToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });
        await tx.refreshToken.deleteMany({ where: { userId: row.userId } });
        await recordAudit(
            tx,
            { id: row.user.id, orgId: row.user.orgId, role: row.user.role },
            type === 'INVITE' ? 'INVITE_ACCEPTED' : 'PASSWORD_RESET_COMPLETED',
            'User',
            row.userId,
            { ip: meta.ip ?? null },
        );
    });
}

export async function changePassword(actor: AuthUser, current: string, next: string, meta: auth.Meta) {
    const user = await prisma.user.findFirst({
        where: { id: actor.id, orgId: actor.orgId, isActive: true },
    });
    if (!user) throw new HttpError(401, 'Not logged in');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new HttpError(400, 'Too many attempts. Try again later.');
    }

    // 400 and not 401: the screens treat a 401 as an expired session
    if (!(await verifyPassword(current, user.passwordHash))) {
        const locked = await auth.recordFailedAttempt(user.id);
        await auth.auditUser(user, locked ? 'ACCOUNT_LOCKED' : 'PASSWORD_CHANGE_FAILED', meta);
        throw new HttpError(400, 'Your current password is not correct');
    }
    if (await verifyPassword(next, user.passwordHash)) {
        throw new HttpError(400, 'Choose a password that is different from your current one');
    }

    const passwordHash = await hashPassword(next);
    const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
            where: { id: user.id },
            data: { passwordHash, passwordSetAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        });
        await tx.refreshToken.deleteMany({ where: { userId: user.id } });
        await tx.authToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
        await recordAudit(tx, actor, 'PASSWORD_CHANGED', 'User', user.id, { ip: meta.ip ?? null });
        return u;
    });

    // Every other device is signed out. This one gets a fresh session.
    return auth.issueSession(updated, meta);
}

export async function logoutAll(actor: AuthUser) {
    await prisma.$transaction(async (tx) => {
        await tx.refreshToken.deleteMany({ where: { userId: actor.id } });
        await recordAudit(tx, actor, 'SESSIONS_REVOKED', 'User', actor.id, {});
    });
}