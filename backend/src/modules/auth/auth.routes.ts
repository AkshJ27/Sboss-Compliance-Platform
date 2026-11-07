import { Router, Request, Response } from 'express';
import { isProd } from '../../config/env';
import { REFRESH_TTL_DAYS } from '../../lib/tokens';
import { requireAuth, getUser } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rate-limit';
import { requireTrustedOrigin } from '../../middleware/trusted-origin';
import { loginSchema, registerSchema } from './auth.schema';
import * as auth from './auth.service';

const COOKIE_NAME = 'refresh_token';
const COOKIE_BASE = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/api/auth',
};

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