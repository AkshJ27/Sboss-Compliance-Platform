import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Role } from '@prisma/client';
import { env } from '../config/env';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 7;
export const DOWNLOAD_TTL_SECONDS = 60;

const ROLES: string[] = Object.values(Role);

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
    if (typeof p.sub !== 'string' || typeof p.orgId !== 'string' || !ROLES.includes(p.role)) {
        throw new Error('Malformed token');
    }
    return { sub: p.sub, orgId: p.orgId, role: p.role as Role };
}

export const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');

export const hashToken = (token: string) =>
    crypto.createHash('sha256').update(token).digest('hex');

// Download links use their own key, so they can never be used as a login token
const downloadKey = crypto.createHmac('sha256', env.JWT_SECRET).update('document-download-v1').digest();

export function signDownloadToken(documentId: string, orgId: string) {
    return jwt.sign({ doc: documentId, org: orgId }, downloadKey, {
        expiresIn: DOWNLOAD_TTL_SECONDS,
        algorithm: 'HS256',
        audience: 'doc-download',
    });
}

export function verifyDownloadToken(token: string) {
    const p = jwt.verify(token, downloadKey, {
        algorithms: ['HS256'],
        audience: 'doc-download',
    }) as jwt.JwtPayload;
    if (typeof p.doc !== 'string' || typeof p.org !== 'string') throw new Error('Malformed token');
    return { documentId: p.doc, orgId: p.org };
}