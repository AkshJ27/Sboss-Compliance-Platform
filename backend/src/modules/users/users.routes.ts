import { Router } from 'express';
import { getUser, requireRole } from '../../middleware/auth';
import { createUserSchema, idParamSchema, updateUserSchema } from './users.schema';
import * as users from './users.service';

export const usersRouter = Router();

usersRouter.get('/', async (req, res) => {
    res.json(await users.listUsers(getUser(req).orgId));
});

usersRouter.post('/', requireRole('ORG_ADMIN'), async (req, res) => {
    const input = createUserSchema.parse(req.body);
    res.status(201).json(await users.createUser(getUser(req).orgId, input));
});

usersRouter.patch('/:id', requireRole('ORG_ADMIN'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = updateUserSchema.parse(req.body);
    res.json(await users.updateUser(getUser(req), id, input));
});