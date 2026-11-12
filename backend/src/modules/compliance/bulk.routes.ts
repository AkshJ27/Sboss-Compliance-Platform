import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { getUser, requireRole } from '../../middleware/auth';
import { csvUpload } from '../../middleware/csv-upload';
import { replicate } from './bulk.replicate.service';
import { importQuerySchema, replicateSchema, swapSchema } from './bulk.schema';
import { importSchedules } from './bulk.import.service';
import { templateCsv } from './bulk.import.parser';
import { dryRunQuerySchema } from './compliance.schema';
import { swap } from './bulk.swap.service';

export const bulkRouter = Router();

// Bulk changes touch many people's work at once, so only an admin can make them
bulkRouter.use(requireRole('ORG_ADMIN'));

bulkRouter.post('/replicate', async (req, res) => {
    const { dryRun } = dryRunQuerySchema.parse(req.query);
    const input = replicateSchema.parse(req.body);
    res.status(dryRun ? 200 : 201).json(await replicate(getUser(req), input, dryRun));
});

bulkRouter.post('/swap', async (req, res) => {
    const { dryRun } = dryRunQuerySchema.parse(req.query);
    const input = swapSchema.parse(req.body);
    res.json(await swap(getUser(req), input, dryRun));
});

bulkRouter.get('/import/template', (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="schedule-import-template.csv"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(templateCsv());
});

bulkRouter.post('/import', csvUpload, async (req, res) => {
    const { dryRun, startDate } = importQuerySchema.parse(req.query);
    if (!req.file) throw new HttpError(400, 'Attach a CSV file in the "file" field');

    const out = await importSchedules(getUser(req), req.file.buffer, { dryRun, defaultStart: startDate });
    if (!out.ok) {
        res.status(422).json(out);
        return;
    }
    res.status(dryRun ? 200 : 201).json(out);
});