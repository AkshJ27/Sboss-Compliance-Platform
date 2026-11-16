import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getUser } from '../../middleware/auth';
import { exportQuerySchema, summaryQuerySchema } from './reports.schema';
import { exportInstances } from './reports.service';
import { exportSummary, summaryReport } from './summary.service';

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

const sendFile = (res: Response, out: { body: Buffer; fileName: string; contentType: string }) => {
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(out.body);
};

// Everyone logged in can export, limited to the items they are allowed to see
reportsRouter.get('/instances', exportLimiter, async (req, res) => {
    sendFile(res, await exportInstances(getUser(req), exportQuerySchema.parse(req.query)));
});

// Counts by status for each entity, location, owner and so on, within the items the user can see
reportsRouter.get('/summary', async (req, res) => {
    res.json(await summaryReport(getUser(req), summaryQuerySchema.parse(req.query)));
});

reportsRouter.get('/summary/export', exportLimiter, async (req, res) => {
    sendFile(res, await exportSummary(getUser(req), summaryQuerySchema.parse(req.query)));
});