import { Router } from 'express';
import { getUser, requireRole } from '../../middleware/auth';
import * as s from './workflow.schema';
import * as wf from './workflow.service';

export const workflowRouter = Router();

// Viewers can read items but never act on them
const actors = requireRole('ORG_ADMIN', 'MEMBER');

workflowRouter.put('/:id/draft', actors, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await wf.saveDraft(getUser(req), id, s.draftSchema.parse(req.body)));
});

workflowRouter.post('/:id/submit', actors, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await wf.submit(getUser(req), id, s.submitSchema.parse(req.body)));
});

workflowRouter.post('/:id/approve', actors, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const { remarks } = s.approveSchema.parse(req.body ?? {});
    res.json(await wf.approve(getUser(req), id, remarks));
});

workflowRouter.post('/:id/return', actors, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const { remarks } = s.returnSchema.parse(req.body ?? {});
    res.json(await wf.returnItem(getUser(req), id, remarks));
});

workflowRouter.patch('/:id/assignees', requireRole('ORG_ADMIN'), async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await wf.reassign(getUser(req), id, s.assigneesSchema.parse(req.body)));
});

workflowRouter.get('/:id/history', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await wf.history(getUser(req), id));
});