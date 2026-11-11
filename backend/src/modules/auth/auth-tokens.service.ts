import { randomUUID } from 'crypto';
import type { AuthTokenType, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { sendEmail } from '../../lib/email';
import { hashToken, newRefreshToken } from '../../lib/tokens';
import type { AuthUser } from '../../middleware/auth';
import { buildLink, inviteEmail, resetEmail } from './links';

type Db = Prisma.TransactionClient;

const TTL_MS: Record<AuthTokenType, number> = {
    INVITE: 72 * 60 * 60 * 1000,
    PASSWORD_RESET: 60 * 60 * 1000,
};
const RESEND_AFTER_MS = 60_000;

export const INVALID_LINK = 'This link is invalid or has expired';

// Creates a one-time token and returns the readable value. Only its hash is stored.
// With retireOlder, earlier unused links of the same kind stop working.
export async function issueToken(
    db: Db,
    userId: string,
    type: AuthTokenType,
    createdById: string | null,
    retireOlder = true,
): Promise<string> {
    if (retireOlder) {
        await db.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
    }
    const raw = newRefreshToken();
    await db.authToken.create({
        data: {
            userId,
            type,
            tokenHash: hashToken(raw),
            expiresAt: new Date(Date.now() + TTL_MS[type]),
            createdById,
        },
    });
    return raw;
}

export async function sentRecently(db: Db, userId: string, type: AuthTokenType): Promise<boolean> {
    const n = await db.authToken.count({
        where: { userId, type, createdAt: { gt: new Date(Date.now() - RESEND_AFTER_MS) } },
    });
    return n > 0;
}

// Never throws: the caller learns only whether the email went out
export async function deliver(to: string, mail: { subject: string; text: string }): Promise<boolean> {
    try {
        return (await sendEmail({ id: randomUUID(), to, ...mail })) === 'sent';
    } catch (e) {
        console.error('[email] could not send', e);
        return false;
    }
}

// An admin sends an invitation or a reset link to someone in their own company.
// The link is only ever emailed. It is never returned to the admin.
export async function sendLinkAsAdmin(actor: AuthUser, userId: string, type: AuthTokenType): Promise<boolean> {
    const user = await prisma.user.findFirst({
        where: { id: userId, orgId: actor.orgId },
        include: { org: { select: { name: true } } },
    });
    if (!user) throw new HttpError(404, 'User not found');
    if (!user.isActive) throw new HttpError(400, 'This user is deactivated');
    if (type === 'INVITE' && user.passwordSetAt) {
        throw new HttpError(400, 'This person has already set a password. Send a reset link instead.');
    }
    if (await sentRecently(prisma, user.id, type)) {
        throw new HttpError(429, 'An email was just sent. Wait a minute before sending another.');
    }

    const raw = await prisma.$transaction(async (tx) => {
        const token = await issueToken(tx, user.id, type, actor.id);
        await recordAudit(
            tx,
            actor,
            type === 'INVITE' ? 'INVITE_ISSUED' : 'PASSWORD_RESET_ISSUED',
            'User',
            user.id,
            { by: 'admin' },
        );
        return token;
    });

    const link = buildLink(env.APP_URL, type === 'INVITE' ? '/accept-invite' : '/reset-password', raw);
    const sender = await prisma.user.findFirst({
        where: { id: actor.id, orgId: actor.orgId },
        select: { name: true },
    });
    const mail =
        type === 'INVITE'
            ? inviteEmail({ name: user.name, inviter: sender?.name ?? 'An administrator', org: user.org.name, link })
            : resetEmail({ name: user.name, link });
    return deliver(user.email, mail);
}