import { Router, type Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../../lib/errors';
import { todayInIndia } from '../../lib/dates';
import { getUser, requireRole } from '../../middleware/auth';
import { xlsxUpload } from '../../middleware/xlsx-upload';
import { idParamSchema, importQuerySchema } from './library.schema';
import { addInternal, importInternal, importUpdates, patchInternal, updateFormat, uploadFormat } from './internal.service';

// A company's own compliances. Only its admins can add or change them.
export const internalRouter = Router();
internalRouter.use(requireRole('ORG_ADMIN'));

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sendXlsx = (res: Response, name: string, body: Buffer) => {
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${todayInIndia()}.xlsx"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(body);
};

// A checked file comes back with 422 and the row-by-row problems, so the screen can list them
const reply = (res: Response, out: { ok: boolean }, created = false) =>
    res.status(out.ok ? (created ? 201 : 200) : 422).json(out);

const text = z.string().max(20000).optional();
const addSchema = z
    .object({
        title: text, description: text, periodicity: text, event: text, onDay: text, startEnd: text,
        yearBasis: text, effectiveDate: text, attachment: text, proof: text, risk: text, entity: text,
        department: text, location: text, owner: text, alertOwner: text, manager: text, alertManager: text,
        approver: text, vertical: text, lawCategory: text, nature: text, penalty: text,
    })
    .strict();
const patchSchema = z
    .object({
        title: text, description: text, attachment: text, proofOfCompliance: text, risk: text,
        applicability: text, penalty: text, alertOwnerDays: text, alertManagerDays: text, isActive: text,
    })
    .strict();

internalRouter.get('/upload-format', async (req, res) => {
    sendXlsx(res, 'internal-compliance-upload-format', await uploadFormat(getUser(req).orgId));
});

internalRouter.get('/update-format', async (req, res) => {
    sendXlsx(res, 'internal-compliance-update-format', await updateFormat(getUser(req).orgId));
});

internalRouter.post('/upload', xlsxUpload, async (req, res) => {
    const { dryRun } = importQuerySchema.parse(req.query);
    if (!req.file) throw new HttpError(400, 'Attach an Excel file in the "file" field');
    reply(res, await importInternal(getUser(req), req.file.buffer, dryRun), !dryRun);
});

internalRouter.post('/update', xlsxUpload, async (req, res) => {
    const { dryRun } = importQuerySchema.parse(req.query);
    if (!req.file) throw new HttpError(400, 'Attach an Excel file in the "file" field');
    reply(res, await importUpdates(getUser(req), req.file.buffer, dryRun));
});

internalRouter.post('/', async (req, res) => {
    reply(res, await addInternal(getUser(req), addSchema.parse(req.body)), true);
});

internalRouter.patch('/:id', async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await patchInternal(getUser(req), id, patchSchema.parse(req.body)));
});