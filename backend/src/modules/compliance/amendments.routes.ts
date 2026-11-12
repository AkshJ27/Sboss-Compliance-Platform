import { Router } from 'express';
import { getUser, requireRole } from '../../middleware/auth';
import { complianceParamSchema, decisionSchema, historyQuerySchema, listQuerySchema } from './amendments.schema';
import * as amendments from './amendments.service';

export const amendmentsRouter = Router();

// Deciding what a company follows is an admin's job
amendmentsRouter.use(requireRole('ORG_ADMIN'));

// These must stay above "/:complianceId"
amendmentsRouter.get('/summary', async (req, res) => {
    res.json(await amendments.summary(getUser(req)));
});

amendmentsRouter.get('/history', async (req, res) => {
    res.json(await amendments.history(getUser(req), historyQuerySchema.parse(req.query)));
});

amendmentsRouter.post('/acknowledge-all', async (req, res) => {
    res.json(await amendments.acknowledgeAll(getUser(req)));
});

amendmentsRouter.get('/', async (req, res) => {
    res.json(await amendments.list(getUser(req), listQuerySchema.parse(req.query)));
});

amendmentsRouter.get('/:complianceId', async (req, res) => {
    const { complianceId } = complianceParamSchema.parse(req.params);
    res.json(await amendments.preview(getUser(req), complianceId));
});

amendmentsRouter.post('/:complianceId/decision', async (req, res) => {
    const { complianceId } = complianceParamSchema.parse(req.params);
    res.json(await amendments.decide(getUser(req), complianceId, decisionSchema.parse(req.body)));
});