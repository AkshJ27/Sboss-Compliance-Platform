import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getUser } from '../../middleware/auth';
import { exportQuerySchema } from './reports.schema';
import { exportInstances } from './reports.service';

export const reportsRouter = Router();

// 20 exports per 15 minutes for each person
const exportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? 'anonymous',
    message: { error: 'Too many exports, try again later' },
});

// Everyone logged in can export, limited to the items they are allowed to see
reportsRouter.get('/instances', exportLimiter, async (req, res) => {
    const q = exportQuerySchema.parse(req.query);
    const out = await exportInstances(getUser(req), q);

    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(out.body);
});