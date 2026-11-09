import { Router } from 'express';
import { getUser, requireRole } from '../../middleware/auth';
import { auditQuerySchema } from './audit.schema';
import * as audit from './audit.service';

export const auditRouter = Router();

// The audit log shows everyone's activity, so only an admin can read it
auditRouter.use(requireRole('ORG_ADMIN'));

auditRouter.get('/', async (req, res) => {
    res.json(await audit.list(getUser(req), auditQuerySchema.parse(req.query)));
});

auditRouter.get('/facets', async (req, res) => {
    res.json(await audit.facets(getUser(req)));
});