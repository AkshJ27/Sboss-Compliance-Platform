import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { getUser } from '../../middleware/auth';
import { csvUpload } from '../../middleware/csv-upload';
import { xlsxUpload } from '../../middleware/xlsx-upload';
import { requirePlatformAdmin } from '../../middleware/platform-admin';
import * as s from './library.schema';
import * as lib from './library.service';
import { exportCompliances } from './library.export';
import { parseCsv } from './import.parser';
import { planImport, commitImport } from './import.service';
import { importComplinityLibrary } from './complinity.service';
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

// The Browse list as Excel: the ticked compliances, or everything matching the filters. Filters in the query, ticks in the body.
libraryRouter.post('/compliances/export', async (req, res) => {
    const q = s.complianceListQuerySchema.parse(req.query);
    const { ids } = s.complianceExportBodySchema.parse(req.body ?? {});
    const out = await exportCompliances(getUser(req), q, ids);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${out.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(out.buffer);
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


// Complinity's compliance details export (.xlsx) as it is: mapped, unmapped and inactivated compliances
libraryRouter.post('/import-complinity', requirePlatformAdmin, xlsxUpload, async (req, res) => {
    const { dryRun } = s.importQuerySchema.parse(req.query);
    if (!req.file) throw new HttpError(400, 'Attach the Excel file in the "file" field');
    const out = await importComplinityLibrary(getUser(req), req.file.buffer, dryRun);
    res.status(out.ok ? (dryRun ? 200 : 201) : 422).json(out);
});