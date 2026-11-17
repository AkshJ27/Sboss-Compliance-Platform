import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { todayInIndia } from '../../lib/dates';
import { getUser, requireRole } from '../../middleware/auth';
import { xlsxUpload } from '../../middleware/xlsx-upload';
import { sendLinkAsAdmin } from '../auth/auth-tokens.service';
import { createUserSchema, idParamSchema, importQuerySchema, updateUserSchema } from './users.schema';
import * as users from './users.service';
import { importUsers, userUploadFormat } from './users.import.service';

export const usersRouter = Router();

const admin = requireRole('ORG_ADMIN');

usersRouter.get('/', async (req, res) => {
    res.json(await users.listUsers(getUser(req).orgId));
});

// Uploading a users list (Complinity's export as it is). Checked first with ?dryRun=true.
usersRouter.get('/upload-format', admin, async (_req, res) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Users_Format-${todayInIndia()}.xlsx"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(await userUploadFormat());
});

usersRouter.post('/upload', admin, xlsxUpload, async (req, res) => {
    const { dryRun, invite } = importQuerySchema.parse(req.query);
    if (!req.file) throw new HttpError(400, 'Attach the Excel file in the "file" field');
    const out = await importUsers(getUser(req), req.file.buffer, dryRun, invite);
    res.status(out.ok ? (dryRun ? 200 : 201) : 422).json(out);
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