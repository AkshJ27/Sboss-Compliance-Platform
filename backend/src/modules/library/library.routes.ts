import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { getUser } from '../../middleware/auth';
import { csvUpload } from '../../middleware/csv-upload';
import { requirePlatformAdmin } from '../../middleware/platform-admin';
import * as s from './library.schema';
import * as lib from './library.service';
import { parseCsv } from './import.parser';
import { planImport, commitImport } from './import.service';
import { notifyLawChange } from '../notifications/law-change.notify';
import { internalRouter } from './internal.routes';
import { mastersRouter } from './masters.routes';

export const libraryRouter = Router();

// A company's own compliances: upload, update, add and edit
libraryRouter.use('/internal', internalRouter);



// Acts, rules, law categories, statutory authorities, natures and types
libraryRouter.use('/masters', mastersRouter);
// Reading: any logged-in user
libraryRouter.get('/lookups', async (_req, res) => {
    res.json(await lib.lookups());
});

libraryRouter.get('/acts', async (req, res) => {
    res.json(await lib.listActs(getUser(req), s.actListQuerySchema.parse(req.query)));
});

libraryRouter.get('/acts/:id/rules', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await lib.listRules(getUser(req), id));
});

libraryRouter.get('/compliances', async (req, res) => {
    res.json(await lib.listCompliances(getUser(req), s.complianceListQuerySchema.parse(req.query)));
});

libraryRouter.get('/compliances/:id', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await lib.getCompliance(getUser(req), id));
});

// Writing: platform admin only
libraryRouter.patch('/compliances/:id', requirePlatformAdmin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const input = s.complianceUpdateSchema.parse(req.body);
    const updated = await lib.updateCompliance(getUser(req), id, input);
    // After the reply, and never allowed to break it. The waiting list is derived, so a lost notice is harmless.
    void notifyLawChange([id]).catch((e) => console.error('[law-change] could not notify', e));
    res.json(updated);
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
    void notifyLawChange(plan.updates.map((u) => u.id)).catch((e) => console.error('[law-change] could not notify', e));
    res.status(201).json(body);
});