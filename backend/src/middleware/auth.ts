import { Request, RequestHandler } from 'express';
import { Role } from '@prisma/client';
import { HttpError } from '../lib/errors';
import { verifyAccessToken } from '../lib/tokens';
import { loadVerticalScope } from '../lib/vertical-scope';

// verticalIds: the verticals this user is limited to, such as a vendor's own. Empty or missing: no limit.
export type AuthUser = { id: string; orgId: string; role: Role; verticalIds?: string[] };

declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Not logged in');

    let p: ReturnType<typeof verifyAccessToken>;
    try {
        p = verifyAccessToken(header.slice(7));
    } catch {
        throw new HttpError(401, 'Session expired');
    }
    // Admins are never limited to verticals
    const verticalIds = p.role === 'ORG_ADMIN' ? [] : await loadVerticalScope(p.sub);
    req.user = { id: p.sub, orgId: p.orgId, role: p.role, verticalIds };
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