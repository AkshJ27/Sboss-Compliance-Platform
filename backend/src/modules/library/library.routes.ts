import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { getUser } from '../../middleware/auth';
import { csvUpload } from '../../middleware/csv-upload';
import { requirePlatformAdmin } from '../../middleware/platform-admin';
import * as s from './library.schema';
import * as lib from './library.service';
import { parseCsv } from './import.parser';
import { planImport, commitImport } from './import.service';

export const libraryRouter = Router();

// Reading: any logged-in user
libraryRouter.get('/lookups', async (_req, res) => {
    res.json(await lib.lookups());
});

libraryRouter.get('/acts', async (req, res) => {
    res.json(await lib.listActs(s.actListQuerySchema.parse(req.query)));
});

libraryRouter.get('/acts/:id/rules', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await lib.listRules(id));
});

libraryRouter.get('/compliances', async (req, res) => {
    res.json(await lib.listCompliances(s.complianceListQuerySchema.parse(req.query)));
});

libraryRouter.get('/compliances/:id', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await lib.getCompliance(id));
});

// Writing: platform admin only
libraryRouter.patch('/compliances/:id', requirePlatformAdmin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const input = s.complianceUpdateSchema.parse(req.body);
    res.json(await lib.updateCompliance(getUser(req), id, input));
});

libraryRouter.post('/import', requirePlatformAdmin, csvUpload, async (req, res) => {
    const { dryRun } = s.importQuerySchema.parse(req.query);
    if (!req.file) throw new HttpError(400, 'Attach a CSV file in the "file" field');

    const parsed = parseCsv(req.file.buffer);
    if (parsed.errors.length) {
        res.status(422).json({
            ok: false,
            errorCount: parsed.errors.length,
            errors: parsed.errors.slice(0, 200),
            ignoredColumns: parsed.ignoredColumns,
        });
        return;
    }

    const plan = await planImport(parsed.rows);
    const body = { ok: true, dryRun, ignoredColumns: parsed.ignoredColumns, ...plan.summary };

    if (dryRun) {
        res.json(body);
        return;
    }
    await commitImport(getUser(req), plan);
    res.status(201).json(body);
});