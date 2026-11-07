import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Role } from '@prisma/client';
import { env } from '../config/env';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 7;

export type AccessPayload = { sub: string; orgId: string; role: Role };

export function signAccessToken(user: { id: string; orgId: string; role: Role }) {
    return jwt.sign({ orgId: user.orgId, role: user.role }, env.JWT_SECRET, {
        subject: user.id,
        expiresIn: ACCESS_TTL_SECONDS,
        algorithm: 'HS256',
    });
}

export function verifyAccessToken(token: string): AccessPayload {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    return { sub: p.sub as string, orgId: p.orgId, role: p.role };
}

export const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');

export const hashToken = (token: string) =>
    crypto.createHash('sha256').update(token).digest('hex');