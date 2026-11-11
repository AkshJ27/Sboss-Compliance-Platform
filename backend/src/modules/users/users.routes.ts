import { Router } from 'express';
import { getUser, requireRole } from '../../middleware/auth';
import { sendLinkAsAdmin } from '../auth/auth-tokens.service';
import { createUserSchema, idParamSchema, updateUserSchema } from './users.schema';
import * as users from './users.service';

export const usersRouter = Router();

const admin = requireRole('ORG_ADMIN');

usersRouter.get('/', async (req, res) => {
    res.json(await users.listUsers(getUser(req).orgId));
});

usersRouter.post('/', admin, async (req, res) => {
    const input = createUserSchema.parse(req.body);
    res.status(201).json(await users.createUser(getUser(req), input));
});

usersRouter.patch('/:id', admin, async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = updateUserSchema.parse(req.body);
    res.json(await users.updateUser(getUser(req), id, input));
});

usersRouter.post('/:id/invite', admin, async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ emailed: await sendLinkAsAdmin(getUser(req), id, 'INVITE') });
});

usersRouter.post('/:id/reset-link', admin, async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ emailed: await sendLinkAsAdmin(getUser(req), id, 'PASSWORD_RESET') });
});