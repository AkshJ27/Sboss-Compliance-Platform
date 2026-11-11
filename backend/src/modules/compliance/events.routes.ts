import { Router } from 'express';
import { getUser, requireRole } from '../../middleware/auth';
import { dryRunQuerySchema, idParamSchema } from './compliance.schema';
import { optionsQuerySchema, triggerListQuerySchema, triggerSchema } from './events.schema';
import * as events from './events.service';

export const eventsRouter = Router();

// Recording events changes what people owe, so for now only an admin can do it
eventsRouter.use(requireRole('ORG_ADMIN'));

eventsRouter.get('/options', async (req, res) => {
    const { locationId } = optionsQuerySchema.parse(req.query);
    res.json(await events.eventOptions(getUser(req), locationId));
});

eventsRouter.post('/trigger', async (req, res) => {
    const { dryRun } = dryRunQuerySchema.parse(req.query);
    const input = triggerSchema.parse(req.body);
    const result = await events.trigger(getUser(req), input, dryRun);
    res.status(dryRun ? 200 : 201).json(result);
});

eventsRouter.get('/triggers', async (req, res) => {
    res.json(await events.listTriggers(getUser(req), triggerListQuerySchema.parse(req.query)));
});

eventsRouter.post('/triggers/:id/cancel', async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await events.cancelTrigger(getUser(req), id));
});