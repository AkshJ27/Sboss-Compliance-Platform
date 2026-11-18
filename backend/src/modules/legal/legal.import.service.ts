import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly } from '../../lib/dates';
import { HttpError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import { LEGAL_COLUMNS, actKey, parseLegalSheet, planLegalImport, ruleKey, updateKey } from './legal.import.parser';
import type { LegalLookups, LegalRow, RowError } from './legal.import.parser';
import { notifyFollowers } from './legal.service';

const MAX_ERRORS_SHOWN = 200;
const TX = { timeout: 10 * 60 * 1000, maxWait: 10_000 };
const lower = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

async function readGrid(buffer: Buffer): Promise<unknown[][]> {
    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
        throw new HttpError(400, 'Could not read the file. Save it as an Excel workbook (.xlsx) and try again.');
    }
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount === 0) throw new HttpError(400, 'The file is empty');
    const width = Math.max(ws.columnCount, LEGAL_COLUMNS.length);
    const grid: unknown[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        grid.push(Array.from({ length: width }, (_, i) => row.getCell(i + 1).value as unknown));
    }
    return grid;
}

const failure = (errors: RowError[], warnings: string[], fileErrors: string[] = []) => ({
    ok: false as const,
    fileErrors,
    errorCount: errors.length,
    errors: [...errors].sort((a, b) => a.row - b.row).slice(0, MAX_ERRORS_SHOWN),
    warnings,
});

async function loadLookups(rows: readonly LegalRow[]): Promise<LegalLookups> {
    const actNames = [...new Set(rows.map((r) => r.act.trim()))];
    const [categories, acts] = await Promise.all([
        prisma.lawCategory.findMany({ select: { id: true, name: true } }),
        prisma.act.findMany({
            where: { orgId: null, name: { in: actNames, mode: 'insensitive' } },
            select: { id: true, name: true, jurisdiction: true, state: true, lawCategoryId: true },
        }),
    ]);
    const actIds = acts.map((a) => a.id);
    const [rules, existing] = await Promise.all([
        prisma.rule.findMany({ where: { actId: { in: actIds } }, select: { id: true, actId: true, name: true } }),
        prisma.legalUpdate.findMany({
            where: { actId: { in: actIds } },
            select: { actId: true, notificationDate: true, referenceNumber: true, title: true },
        }),
    ]);
    return {
        categories: new Map(categories.map((c) => [lower(c.name), c.id])),
        acts: new Map(acts.map((a) => [actKey(a.name, a.jurisdiction, a.state), { id: a.id, lawCategoryId: a.lawCategoryId }])),
        rules: new Map(rules.map((r) => [ruleKey(r.actId, r.name), r.id])),
        existing: new Set(existing.map((u) => updateKey(u.actId, u.notificationDate.toISOString().slice(0, 10), u.referenceNumber, u.title))),
    };
}

export async function importLegalUpdates(actor: AuthUser, buffer: Buffer, dryRun: boolean, notify: boolean) {
    const parsed = parseLegalSheet(await readGrid(buffer));
    if (parsed.fileErrors.length || parsed.errors.length) return failure(parsed.errors, parsed.warnings, parsed.fileErrors);

    const lookups = await loadLookups(parsed.rows);
    const plan = planLegalImport(parsed.rows, lookups);
    const warnings = [...parsed.warnings, ...plan.warnings];
    const result = {
        ok: true as const,
        dryRun,
        totalRows: parsed.totalRows,
        toCreate: plan.toCreate.length,
        duplicates: plan.duplicates,
        newActs: plan.newActs.size,
        newRules: plan.newRules.size,
        newCategories: plan.newCategories.size,
        impacted: plan.toCreate.filter((c) => c.row.complianceImpact).length,
        warnings,
        notified: 0,
        sample: plan.toCreate.slice(0, 20).map(({ row }) => ({
            row: row.row,
            notificationDate: row.notificationDate,
            act: row.act,
            title: row.title,
            region: row.state ?? 'Central',
            complianceImpact: row.complianceImpact,
        })),
    };
    if (dryRun || !plan.toCreate.length) return result;

    const notified = await prisma.$transaction(async (tx) => {
        // Law categories, then Acts, then Rules, so every update can point at its Act and Rule
        if (plan.newCategories.size) {
            await tx.lawCategory.createMany({ data: [...plan.newCategories.values()].map((name) => ({ name })), skipDuplicates: true });
        }
        const categoryId = new Map((await tx.lawCategory.findMany({ select: { id: true, name: true } })).map((c) => [lower(c.name), c.id]));

        const actId = new Map<string, string>(); // "new:<actKey>" -> id
        for (const [key, a] of plan.newActs) {
            const id = randomUUID();
            await tx.act.create({
                data: { id, name: a.name, jurisdiction: a.jurisdiction, state: a.state, lawCategoryId: categoryId.get(lower(a.category)) as string },
            });
            actId.set(`new:${key}`, id);
        }
        const realAct = (ref: string) => actId.get(ref) ?? ref;

        const ruleId = new Map<string, string>();
        for (const [key, r] of plan.newRules) {
            const id = randomUUID();
            await tx.rule.create({ data: { id, actId: realAct(r.actRef), name: r.name } });
            ruleId.set(`new:${key}`, id);
        }
        const realRule = (ref: string | null) => (ref ? (ruleId.get(ref) ?? ref) : null);

        const created: { id: string; actId: string; title: string; publishedDate: string; act: string }[] = [];
        for (const part of chunks(plan.toCreate, 1000)) {
            const data = part.map(({ row, actRef, ruleRef }) => {
                const id = randomUUID();
                created.push({ id, actId: realAct(actRef), title: row.title, publishedDate: row.publishedDate, act: row.act });
                return {
                    id,
                    actId: realAct(actRef),
                    ruleId: realRule(ruleRef),
                    ministry: row.ministry,
                    notificationDate: parseDateOnly(row.notificationDate),
                    effectiveDate: row.effectiveDate ? parseDateOnly(row.effectiveDate) : null,
                    publishedDate: parseDateOnly(row.publishedDate),
                    referenceNumber: row.referenceNumber,
                    title: row.title,
                    description: row.description,
                    complianceImpact: row.complianceImpact,
                    isChange: row.isChange,
                    isAddition: row.isAddition,
                    isDeletion: row.isDeletion,
                    isSchedule: row.isSchedule,
                    impactedCompliance: row.impactedCompliance,
                    createdById: actor.id,
                };
            });
            await tx.legalUpdate.createMany({ data });
        }

        const sent = notify
            ? await notifyFollowers(tx, created.map((c) => ({ id: c.id, actId: c.actId, actName: c.act, title: c.title, publishedDate: c.publishedDate })))
            : 0;
        await recordAudit(tx, actor, 'LEGAL_UPDATES_IMPORTED', 'LegalUpdate', 'import', {
            created: created.length,
            duplicates: plan.duplicates,
            newActs: plan.newActs.size,
            newRules: plan.newRules.size,
            notified: sent,
        });
        return sent;
    }, TX);
    return { ...result, notified };
}

// An empty register to fill in, with an example row and the instructions
export async function uploadFormat(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Compliance Platform';
    const ws = wb.addWorksheet('LU-Data', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.columns = LEGAL_COLUMNS.map((c) => ({ width: c.width }));
    ws.addRow(['Report Name:', 'Legal Updates Register']);
    ws.addRow(['Fill in from row 5. Yellow headings are mandatory.']);
    ws.addRow([]);
    const head = ws.addRow(LEGAL_COLUMNS.map((c) => c.header));
    head.font = { bold: true };
    LEGAL_COLUMNS.forEach((c, i) => {
        head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FFFFFF00' : 'FFD9E1F2' } };
    });
    for (let col = 1; col <= LEGAL_COLUMNS.length; col++) ws.getColumn(col).numFmt = '@';


    const help = wb.addWorksheet('Instructions');
    help.columns = [{ header: 'Column', width: 24 }, { header: 'How to fill it', width: 110 }];
    help.getRow(1).font = { bold: true };
    for (const r of [
        ['Law Category, Act, Rule', 'Use the names in the law library. An Act, Rule or law category that is not there yet is added. Write NA for no rule.'],
        ['Central/State', 'Central, or the full name of the state or union territory.'],
        ['Dates', 'Like 11-Nov-2026 (11-Nov-26 also works). Published Date defaults to the Notification Date.'],
        ['Yes/No columns', 'Compliance Impact, Change, Addition, Deletion and Schedule: Yes or No. Blank means No.'],
        ['Repeats', 'A row with the same Act, notification date, reference number and title as an existing update is skipped.'],
        ['Notices', 'People who follow the Act are told about updates published in the last 7 days. Older ones are added quietly.'],
        ['Attachments', 'Add files afterwards by opening the update.'],
    ]) help.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer());
}