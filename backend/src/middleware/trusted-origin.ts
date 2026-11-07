import { RequestHandler } from 'express';
import { env } from '../config/env';
import { HttpError } from '../lib/errors';

export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !env.CORS_ORIGIN.includes(origin)) {
        throw new HttpError(403, 'Origin not allowed');
    }
    next();
};