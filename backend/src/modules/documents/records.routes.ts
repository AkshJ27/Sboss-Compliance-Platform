import { Router } from 'express';
import { getUser, requireRole } from '../../middleware/auth';
import { documentFilesUpload } from '../../middleware/document-upload';
import * as cats from './categories.service';
import * as s from './records.schema';
import * as records from './records.service';

const admin = requireRole('ORG_ADMIN');
const writers = requireRole('ORG_ADMIN', 'MEMBER');

// ---- Document Masters: category, sub category, sub sub category ---------------------
// Everyone reads them (for the filters and the form). Only company admins change them.
export const docCategoriesRouter = Router();

docCategoriesRouter.get('/', async (req, res) => {
    res.json(await cats.list(getUser(req), s.categoryListQuerySchema.parse(req.query)));
});

docCategoriesRouter.post('/', admin, async (req, res) => {
    res.status(201).json(await cats.create(getUser(req), s.categoryCreateSchema.parse(req.body)));
});

docCategoriesRouter.patch('/:id', admin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await cats.update(getUser(req), id, s.categoryUpdateSchema.parse(req.body)));
});

docCategoriesRouter.delete('/:id', admin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    await cats.remove(getUser(req), id);
    res.status(204).end();
});

// ---- The document repository ---------------------------------------------------------
export const docRecordsRouter = Router();

// These must stay above "/:id"
docRecordsRouter.get('/summary', async (req, res) => {
    res.json(await records.summary(getUser(req)));
});

docRecordsRouter.get('/export', async (req, res) => {
    const out = await records.exportXlsx(getUser(req), s.recordListQuerySchema.parse(req.query));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(out.buffer);
});

docRecordsRouter.post('/owner-swap', admin, async (req, res) => {
    res.json(await records.ownerSwap(getUser(req), s.ownerSwapSchema.parse(req.body)));
});

docRecordsRouter.get('/', async (req, res) => {
    res.json(await records.list(getUser(req), s.recordListQuerySchema.parse(req.query)));
});

docRecordsRouter.post('/', writers, async (req, res) => {
    res.status(201).json(await records.create(getUser(req), s.recordCreateSchema.parse(req.body)));
});

docRecordsRouter.get('/:id', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await records.get(getUser(req), id));
});

docRecordsRouter.patch('/:id', writers, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await records.update(getUser(req), id, s.recordUpdateSchema.parse(req.body)));
});

docRecordsRouter.delete('/:id', writers, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    await records.remove(getUser(req), id);
    res.status(204).end();
});

// Files go in the "files" field, several at a time
docRecordsRouter.post('/:id/files', writers, documentFilesUpload, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const files = (req.files as { originalname: string; buffer: Buffer }[] | undefined) ?? [];
    res.status(201).json(await records.addFiles(getUser(req), id, files));
});

docRecordsRouter.delete('/:id/files/:fileId', writers, async (req, res) => {
    const { id, fileId } = s.fileParamSchema.parse(req.params);
    await records.removeFile(getUser(req), id, fileId);
    res.status(204).end();
});