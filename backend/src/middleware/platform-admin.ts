import { RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/errors';
import { getUser } from './auth';

// Checked in the database on every call, so removing the flag takes effect at once
export const requirePlatformAdmin: RequestHandler = async (req, _res, next) => {
    const actor = getUser(req);
    const row = await prisma.user.findFirst({
        where: { id: actor.id, isActive: true },
        select: { isPlatformAdmin: true },
    });
    if (!row?.isPlatformAdmin) throw new HttpError(403, 'Not allowed');
    next();
};