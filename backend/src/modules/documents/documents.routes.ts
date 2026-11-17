import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { getUser, requireRole } from '../../middleware/auth';
import { documentUpload } from '../../middleware/document-upload';
import * as s from './documents.schema';
import * as docs from './documents.service';
import { docCategoriesRouter, docRecordsRouter } from './records.routes';

// Behind login. Viewers can read but never change anything.
export const documentsRouter = Router();
const writers = requireRole('ORG_ADMIN', 'MEMBER');

// The document repository and its categories. These must stay above "/:id".
documentsRouter.use('/records', docRecordsRouter);
documentsRouter.use('/categories', docCategoriesRouter);

// These two must stay above "/:id"
documentsRouter.get('/summary', async (req, res) => {
    res.json(await docs.summary(getUser(req)));
});

documentsRouter.get('/missing', async (req, res) => {
    res.json(await docs.missing(getUser(req), s.missingQuerySchema.parse(req.query)));
});

documentsRouter.get('/', async (req, res) => {
    res.json(await docs.list(getUser(req), s.listQuerySchema.parse(req.query)));
});

documentsRouter.post('/', writers, documentUpload, async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach a file in the "file" field');
    // Empty form fields are treated as not sent
    const body = Object.fromEntries(Object.entries(req.body ?? {}).filter(([, v]) => v !== ''));
    const fields = s.uploadFieldsSchema.parse(body);
    res.status(201).json(await docs.upload(getUser(req), req.file, fields));
});

documentsRouter.get('/:id', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await docs.get(getUser(req), id));
});

documentsRouter.patch('/:id', writers, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await docs.update(getUser(req), id, s.updateSchema.parse(req.body)));
});

documentsRouter.delete('/:id', writers, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    await docs.remove(getUser(req), id);
    res.status(204).end();
});

documentsRouter.get('/:id/download-url', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await docs.downloadUrl(getUser(req), id));
});

// No login header here. The 60-second signed link is the credential. Local disk mode only.
export const documentFilesRouter = Router();

documentFilesRouter.get('/:token', async (req, res) => {
    const { token } = s.tokenParamSchema.parse(req.params);
    const { doc, stream } = await docs.openLocalFile(token);

    res.attachment(doc.fileName);
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader('Cache-Control', 'private, no-store');

    stream.on('error', () => {
        if (!res.headersSent) res.status(404).json({ error: 'File not found' });
        else res.destroy();
    });
    stream.pipe(res);
});