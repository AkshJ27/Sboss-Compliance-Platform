import { Request, RequestHandler } from 'express';
import { Role } from '@prisma/client';
import { HttpError } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';

export type AuthUser = { id: string; orgId: string; role: Role };

declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Not logged in');

    try {
        const p = verifyAccessToken(header.slice(7));
        req.user = { id: p.sub, orgId: p.orgId, role: p.role };
    } catch {
        throw new HttpError(401, 'Session expired');
    }
    next();
};

export const requireRole =
    (...roles: Role[]): RequestHandler =>
        (req, _res, next) => {
            if (!req.user) throw new HttpError(401, 'Not logged in');
            if (!roles.includes(req.user.role)) throw new HttpError(403, 'Not allowed');
            next();
        };

// Use this in every route. orgId always comes from the verified token,
// never from the request body or URL.
export function getUser(req: Request): AuthUser {
    if (!req.user) throw new HttpError(401, 'Not logged in');
    return req.user;
}