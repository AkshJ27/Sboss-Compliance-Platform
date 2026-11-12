import { Router } from 'express';
import { getUser, requireRole } from '../../middleware/auth';
import * as s from './tasks.schema';
import * as tasks from './tasks.service';

export const tasksRouter = Router();

// Tasks are people's own work, so viewers have no access to them
tasksRouter.use(requireRole('ORG_ADMIN', 'MEMBER'));

// This must stay above "/:id"
tasksRouter.get('/summary', async (req, res) => {
    res.json(await tasks.summary(getUser(req), s.summaryQuerySchema.parse(req.query)));
});

tasksRouter.get('/', async (req, res) => {
    res.json(await tasks.list(getUser(req), s.listQuerySchema.parse(req.query)));
});

tasksRouter.post('/', async (req, res) => {
    res.status(201).json(await tasks.create(getUser(req), s.createSchema.parse(req.body)));
});

tasksRouter.get('/:id', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await tasks.get(getUser(req), id));
});

tasksRouter.patch('/:id', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await tasks.update(getUser(req), id, s.updateSchema.parse(req.body)));
});

tasksRouter.post('/:id/reassign', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await tasks.reassign(getUser(req), id, s.reassignSchema.parse(req.body)));
});

tasksRouter.post('/:id/status', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await tasks.changeStatus(getUser(req), id, s.statusSchema.parse(req.body)));
});

tasksRouter.post('/:id/comments', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const { body } = s.commentSchema.parse(req.body);
    res.status(201).json(await tasks.comment(getUser(req), id, body));
});