import { Router, Request, Response } from 'express';
import { env, isProd } from '../../config/env';
import { HttpError } from '../../lib/errors';
import { REFRESH_TTL_DAYS } from '../../lib/tokens';
import { requireAuth, getUser } from '../../middleware/auth';
import {
    authLimiter,
    changePasswordLimiter,
    resetRequestLimiter,
    tokenLimiter,
} from '../../middleware/rate-limit';
import { requireTrustedOrigin } from '../../middleware/trusted-origin';
import { loginSchema, registerSchema } from './auth.schema';
import * as auth from './auth.service';
import { changePasswordSchema, checkTokenSchema, forgotSchema, setPasswordSchema } from './password.schema';
import * as pw from './password.service';

const COOKIE_NAME = 'refresh_token';
const COOKIE_BASE = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/api/auth',
};

const TYPE = { reset: 'PASSWORD_RESET', invite: 'INVITE' } as const;

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

function sendSession(
    res: Response,
    s: { accessToken: string; refreshToken: string; user: unknown },
    status = 200,
) {
    // The refresh token goes only in the httpOnly cookie, never in the JSON body
    res.cookie(COOKIE_NAME, s.refreshToken, {
        ...COOKIE_BASE,
        maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
    res.status(status).json({ accessToken: s.accessToken, user: s.user });
}

export const authRouter = Router();

authRouter.post('/register', authLimiter, async (req, res) => {
    if (!env.ALLOW_REGISTRATION) throw new HttpError(403, 'Registration is closed');
    const input = registerSchema.parse(req.body);
    sendSession(res, await auth.registerOrganization(input, meta(req)), 201);
});

authRouter.post('/login', authLimiter, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    sendSession(res, await auth.login(email, password, meta(req)));
});

authRouter.post('/refresh', requireTrustedOrigin, async (req, res) => {
    sendSession(res, await auth.refresh(req.cookies?.[COOKIE_NAME], meta(req)));
});

authRouter.post('/logout', requireTrustedOrigin, async (req, res) => {
    await auth.logout(req.cookies?.[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME, COOKIE_BASE);
    res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
    res.json(await auth.getMe(getUser(req)));
});

// Password recovery and invitations (no login needed)
authRouter.post('/forgot-password', resetRequestLimiter, async (req, res) => {
    const { email } = forgotSchema.parse(req.body);
    // Reply first and work afterwards, so the response time never reveals whether the email exists
    res.status(202).json({ message: 'If an account exists for that email, a reset link has been sent.' });
    void pw.requestPasswordReset(email, req.ip).catch((e) => console.error('[auth] reset request failed', e));
});

authRouter.post('/check-token', tokenLimiter, async (req, res) => {
    const { token, purpose } = checkTokenSchema.parse(req.body);
    res.json(await pw.checkLink(token, TYPE[purpose]));
});

authRouter.post('/reset-password', tokenLimiter, async (req, res) => {
    const { token, password } = setPasswordSchema.parse(req.body);
    await pw.completeLink(token, 'PASSWORD_RESET', password, meta(req));
    res.status(204).end();
});

authRouter.post('/accept-invite', tokenLimiter, async (req, res) => {
    const { token, password } = setPasswordSchema.parse(req.body);
    await pw.completeLink(token, 'INVITE', password, meta(req));
    res.status(204).end();
});

// Signed-in people
authRouter.post('/change-password', requireAuth, changePasswordLimiter, requireTrustedOrigin, async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    sendSession(res, await pw.changePassword(getUser(req), currentPassword, newPassword, meta(req)));
});

authRouter.post('/logout-all', requireAuth, requireTrustedOrigin, async (req, res) => {
    await pw.logoutAll(getUser(req));
    res.clearCookie(COOKIE_NAME, COOKIE_BASE);
    res.status(204).end();
});