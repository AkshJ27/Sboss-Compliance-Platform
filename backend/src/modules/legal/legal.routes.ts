import { Router, type Response } from 'express';
import { HttpError } from '../../lib/errors';
import { todayInIndia } from '../../lib/dates';
import { getUser } from '../../middleware/auth';
import { documentFilesUpload } from '../../middleware/document-upload';
import { requirePlatformAdmin } from '../../middleware/platform-admin';
import { xlsxUpload } from '../../middleware/xlsx-upload';
import * as s from './legal.schema';
import * as legal from './legal.service';
import { importLegalUpdates, uploadFormat } from './legal.import.service';
import * as subs from './subscriptions.service';

// Legal updates are shared by every company: anyone signed in reads them, only the platform administrator writes them.
// Each person chooses which Acts they follow on the Configure LU Page.
export const legalRouter = Router();

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sendFile = (res: Response, fileName: string, contentType: string, body: Buffer) => {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(body);
};

// ---- These must stay above "/:id" ----------------------------------------------------------

legalRouter.get('/filters', async (_req, res) => {
    res.json(await legal.filters());
});

legalRouter.get('/rules', async (req, res) => {
    res.json(await legal.rulesForAct(s.rulesQuerySchema.parse(req.query).actId));
});

legalRouter.get('/export', async (req, res) => {
    const out = await legal.exportXlsx(getUser(req), s.listQuerySchema.parse(req.query));
    sendFile(res, out.fileName, XLSX, out.buffer);
});

legalRouter.get('/files/:fileId', async (req, res) => {
    const f = await legal.downloadFile(s.fileIdParamSchema.parse(req.params).fileId);
    sendFile(res, f.fileName, f.contentType, f.data);
});

// Configure LU Page
legalRouter.get('/acts', async (req, res) => {
    res.json(await subs.listActs(getUser(req), s.actsQuerySchema.parse(req.query)));
});

legalRouter.put('/subscriptions', async (req, res) => {
    res.json(await subs.setOne(getUser(req), s.subscriptionSchema.parse(req.body)));
});

legalRouter.post('/subscriptions/bulk', async (req, res) => {
    res.json(await subs.setMany(getUser(req), s.bulkSubscriptionSchema.parse(req.body)));
});

// Uploading a register (platform administrator). Checked first with ?dryRun=true.
legalRouter.get('/upload-format', requirePlatformAdmin, async (_req, res) => {
    sendFile(res, `LegalUpdates_Format-${todayInIndia()}.xlsx`, XLSX, await uploadFormat());
});

legalRouter.post('/upload', requirePlatformAdmin, xlsxUpload, async (req, res) => {
    const { dryRun, notify } = s.importQuerySchema.parse(req.query);
    if (!req.file) throw new HttpError(400, 'Attach the Excel file in the "file" field');
    const out = await importLegalUpdates(getUser(req), req.file.buffer, dryRun, notify);
    res.status(out.ok ? (dryRun ? 200 : 201) : 422).json(out);
});

// ---- The updates -------------------------------------------------------------------------------

legalRouter.get('/', async (req, res) => {
    res.json(await legal.list(getUser(req), s.listQuerySchema.parse(req.query)));
});

legalRouter.post('/', requirePlatformAdmin, async (req, res) => {
    res.status(201).json(await legal.create(getUser(req), s.createSchema.parse(req.body)));
});

legalRouter.get('/:id', async (req, res) => {
    res.json(await legal.get(s.idParamSchema.parse(req.params).id));
});

legalRouter.patch('/:id', requirePlatformAdmin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await legal.update(getUser(req), id, s.updateSchema.parse(req.body)));
});

legalRouter.delete('/:id', requirePlatformAdmin, async (req, res) => {
    await legal.remove(getUser(req), s.idParamSchema.parse(req.params).id);
    res.status(204).end();
});

legalRouter.get('/:id/files.zip', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const { ids } = s.zipQuerySchema.parse(req.query);
    sendFile(res, `legal-update-files-${todayInIndia()}.zip`, 'application/zip', await legal.zipFiles(id, ids));
});

legalRouter.post('/:id/files', requirePlatformAdmin, documentFilesUpload, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const files = (req.files as { originalname: string; buffer: Buffer }[] | undefined) ?? [];
    res.status(201).json(await legal.addFiles(getUser(req), id, files));
});

legalRouter.delete('/:id/files/:fileId', requirePlatformAdmin, async (req, res) => {
    const { id, fileId } = s.fileParamSchema.parse(req.params);
    await legal.removeFile(getUser(req), id, fileId);
    res.status(204).end();
});