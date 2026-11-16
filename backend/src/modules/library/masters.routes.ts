import { Router } from 'express';
import { getUser } from '../../middleware/auth';
import { requirePlatformAdmin } from '../../middleware/platform-admin';
import * as s from './masters.schema';
import * as m from './masters.service';

// The shared masters: anyone signed in can read them, only the platform administrator can change them
export const mastersRouter = Router();

mastersRouter.get('/rules', async (req, res) => {
    res.json(await m.listAllRules(getUser(req), s.ruleListQuerySchema.parse(req.query)));
});

mastersRouter.post('/rules', requirePlatformAdmin, async (req, res) => {
    res.status(201).json(await m.createRule(getUser(req), s.ruleCreateSchema.parse(req.body)));
});

mastersRouter.patch('/rules/:id', requirePlatformAdmin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await m.updateRule(getUser(req), id, s.ruleUpdateSchema.parse(req.body)));
});

mastersRouter.post('/acts', requirePlatformAdmin, async (req, res) => {
    res.status(201).json(await m.createAct(getUser(req), s.actCreateSchema.parse(req.body)));
});

mastersRouter.patch('/acts/:id', requirePlatformAdmin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await m.updateAct(getUser(req), id, s.actUpdateSchema.parse(req.body)));
});

mastersRouter.get('/:kind', async (req, res) => {
    const { kind } = s.kindParamSchema.parse(req.params);
    res.json(await m.listLookup(kind));
});

mastersRouter.post('/:kind', requirePlatformAdmin, async (req, res) => {
    const { kind } = s.kindParamSchema.parse(req.params);
    const { name } = s.lookupBodySchema.parse(req.body);
    res.status(201).json(await m.createLookup(getUser(req), kind, name));
});

mastersRouter.patch('/:kind/:id', requirePlatformAdmin, async (req, res) => {
    const { kind, id } = s.kindIdParamSchema.parse(req.params);
    const { name } = s.lookupBodySchema.parse(req.body);
    res.json(await m.renameLookup(getUser(req), kind, id, name));
});

mastersRouter.delete('/:kind/:id', requirePlatformAdmin, async (req, res) => {
    const { kind, id } = s.kindIdParamSchema.parse(req.params);
    await m.deleteLookup(getUser(req), kind, id);
    res.status(204).end();
});