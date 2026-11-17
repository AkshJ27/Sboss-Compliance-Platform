import { createHash, randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { recordAudit } from '../../lib/audit';
import { parseDateOnly } from '../../lib/dates';
import { HttpError } from '../../lib/errors';
import { checkFile, cleanFileName } from '../../lib/file-types';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { readZip } from '../../lib/zip';
import type { AuthUser } from '../../middleware/auth';
import { UPLOAD_COLUMNS, parseUploadSheet } from './records.upload.parser';
import type { RowError, UploadRow } from './records.upload.parser';
import { existingKey, resolveUploadRows } from './records.upload.resolve';
import type { ResolvedUploadRow } from './records.upload.resolve';

const MAX_ERRORS_SHOWN = 200;
export const ZIP_LIMITS = { maxEntries: 1000, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024 };
const TX = { timeout: 5 * 60 * 1000, maxWait: 10_000 };

// ---- Reading the files ------------------------------------------------------------------

async function readFirstSheet(buffer: Buffer): Promise<{ header: unknown[]; body: unknown[][] }> {
    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
        throw new HttpError(400, 'Could not read the Excel file. Save it as an Excel workbook (.xlsx) and try again.');
    }
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount === 0) throw new HttpError(400, 'The Excel file is empty');
    const width = ws.columnCount;
    const read = (r: number) => {
        const row = ws.getRow(r);
        return Array.from({ length: width }, (_, i) => row.getCell(i + 1).value as unknown);
    };
    const body: unknown[][] = [];
    for (let r = 2; r <= ws.rowCount; r++) body.push(read(r));
    return { header: read(1), body };
}

const sortErrors = (e: RowError[]) => [...e].sort((a, b) => a.row - b.row);

function failure(errors: RowError[], warnings: string[], fileErrors: string[] = []) {
    return {
        ok: false as const,
        fileErrors,
        errorCount: errors.length,
        errors: sortErrors(errors).slice(0, MAX_ERRORS_SHOWN),
        warnings,
    };
}

// ---- Checking ----------------------------------------------------------------------------

async function loadLookups(orgId: string, rows: readonly UploadRow[], zipPaths: string[]) {
    const emails = [...new Set(rows.flatMap((r) => (r.manager ? [r.owner, r.manager] : [r.owner])))];
    const [entities, verticals, departments, locations, categories, users, existingRows] = await Promise.all([
        prisma.entity.findMany({ where: { orgId }, select: { id: true, name: true, code: true, isActive: true } }),
        prisma.vertical.findMany({ where: { orgId }, select: { id: true, name: true, isActive: true } }),
        prisma.department.findMany({ where: { orgId }, select: { id: true, name: true, isActive: true } }),
        prisma.location.findMany({ where: { orgId }, select: { id: true, name: true, entityId: true, isActive: true } }),
        prisma.docCategory.findMany({ where: { orgId }, select: { id: true, name: true, level: true, parentId: true, isActive: true } }),
        prisma.user.findMany({
            where: { orgId, email: { in: emails, mode: 'insensitive' } },
            select: { id: true, email: true, isActive: true, role: true },
        }),
        prisma.documentRecord.findMany({ where: { orgId, deletedAt: null }, select: { locationId: true, name: true } }),
    ]);
    return {
        entities, verticals, departments, locations, categories, users, zipPaths,
        existing: new Set(existingRows.map((r) => existingKey(r.locationId, r.name))),
    };
}

// Every zip file a row uses must be a real, allowed file. Problems are reported against the rows.
function checkZipFiles(resolved: ResolvedUploadRow[], entries: { path: string; name: string; data: Buffer }[]) {
    const problems = new Map<number, string>();
    const contentTypes = new Map<number, { fileName: string; contentType: string }>();
    for (const i of new Set(resolved.flatMap((r) => r.fileIndexes))) {
        const e = entries[i];
        const fileName = cleanFileName(e.name);
        try {
            if (!fileName) throw new HttpError(400, 'The file needs a name');
            contentTypes.set(i, { fileName, contentType: checkFile(fileName, e.data).contentType });
        } catch (err) {
            problems.set(i, err instanceof HttpError ? err.message : 'The file could not be read');
        }
    }
    const errors: RowError[] = [];
    for (const r of resolved) {
        for (const i of r.fileIndexes) {
            const p = problems.get(i);
            if (p) errors.push({ row: r.raw.row, field: 'Attachment Filename', message: `"${entries[i].path}": ${p}` });
        }
    }
    return { errors, contentTypes };
}

function summary(resolved: ResolvedUploadRow[], totalRows: number, warnings: string[], dryRun: boolean) {
    return {
        ok: true as const,
        dryRun,
        totalRows,
        toCreate: resolved.length,
        files: resolved.reduce((n, r) => n + r.fileIndexes.length, 0),
        warnings,
        sample: resolved.slice(0, 20).map((r) => ({
            row: r.raw.row,
            name: r.raw.name,
            location: r.locationLabel,
            accessLevel: r.raw.accessLevel,
            owner: r.raw.owner,
            files: r.raw.files.length,
            expiryDate: r.raw.expiryDate,
        })),
    };
}

// ---- The upload ----------------------------------------------------------------------------

export async function importRecords(actor: AuthUser, xlsx: Buffer, zip: Buffer | null, dryRun: boolean) {
    const { header, body } = await readFirstSheet(xlsx);
    const parsed = parseUploadSheet(header, body);
    if (!zip) parsed.fileErrors.push('Choose the zip file with the documents too');
    if (parsed.fileErrors.length || parsed.errors.length) return failure(parsed.errors, parsed.warnings, parsed.fileErrors);

    const entries = readZip(zip as Buffer, ZIP_LIMITS);
    if (!entries.length) return failure([], parsed.warnings, ['The zip file has no files in it']);

    const lookups = await loadLookups(actor.orgId, parsed.rows, entries.map((e) => e.path));
    const { resolved, errors, warnings } = resolveUploadRows(parsed.rows, lookups);
    const allWarnings = [...parsed.warnings, ...warnings];
    if (errors.length) return failure(errors, allWarnings);

    const files = checkZipFiles(resolved, entries);
    if (files.errors.length) return failure(files.errors, allWarnings);
    if (dryRun) return summary(resolved, parsed.totalRows, allWarnings, true);

    // Each document gets its own copy of its files, so removing one later never affects another
    const plannedFiles = resolved.flatMap((r, ri) =>
        r.fileIndexes.map((i) => {
            const id = randomUUID();
            const e = entries[i];
            return {
                ri,
                id,
                data: e.data,
                ...(files.contentTypes.get(i) as { fileName: string; contentType: string }),
                sha256: createHash('sha256').update(e.data).digest('hex'),
                storageKey: `${actor.orgId}/${id}`,
            };
        }),
    );
    const recordIds = resolved.map(() => randomUUID());

    const stored: string[] = [];
    try {
        for (const f of plannedFiles) {
            await storage.put(f.storageKey, f.data, f.contentType);
            stored.push(f.storageKey);
        }
        await prisma.$transaction(async (tx) => {
            await tx.documentRecord.createMany({
                data: resolved.map((r, i) => ({
                    id: recordIds[i],
                    orgId: actor.orgId,
                    entityId: r.entityId,
                    verticalId: r.verticalId,
                    locationId: r.locationId,
                    departmentId: r.departmentId,
                    categoryId: r.categoryId,
                    subCategoryId: r.subCategoryId,
                    subSubCategoryId: r.subSubCategoryId,
                    name: r.raw.name,
                    docNumber: r.raw.docNumber,
                    accessLevel: r.raw.accessLevel,
                    storedAt: r.raw.storedAt,
                    ownerId: r.ownerId,
                    managerId: r.managerId,
                    reviewDate: r.raw.reviewDate ? parseDateOnly(r.raw.reviewDate) : null,
                    expiryDate: r.raw.expiryDate ? parseDateOnly(r.raw.expiryDate) : null,
                    alertDays: r.raw.alertDays,
                    remarks: r.raw.remarks,
                    createdById: actor.id,
                })),
            });
            await tx.document.createMany({
                data: plannedFiles.map((f) => {
                    const r = resolved[f.ri];
                    return {
                        id: f.id,
                        orgId: actor.orgId,
                        recordId: recordIds[f.ri],
                        title: r.raw.name.slice(0, 200),
                        accessLevel: r.raw.accessLevel,
                        expiresAt: r.raw.expiryDate ? parseDateOnly(r.raw.expiryDate) : null,
                        fileName: f.fileName,
                        contentType: f.contentType,
                        sizeBytes: f.data.length,
                        sha256: f.sha256,
                        storageKey: f.storageKey,
                        uploadedById: actor.id,
                    };
                }),
            });
            await recordAudit(tx, actor, 'DOC_RECORDS_UPLOADED', 'DocumentRecord', actor.orgId, {
                documents: resolved.length,
                files: plannedFiles.length,
                recordIds: recordIds.slice(0, 200),
            });
        }, TX);
    } catch (e) {
        await Promise.all(stored.map((k) => storage.remove(k).catch(() => undefined)));
        throw e;
    }
    return summary(resolved, parsed.totalRows, allWarnings, false);
}

// ---- The format to download --------------------------------------------------------------

const REQUIRED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const OPTIONAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

function sheetOf<T>(wb: ExcelJS.Workbook, name: string, columns: { header: string; width: number; get: (r: T) => unknown }[], rows: T[]) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(columns.map((c) => c.get(r)));
}

const EXAMPLES: Record<string, string> = {
    entity: 'State Bank Operation Support Services Private Limited',
    vertical: 'Quess',
    department: 'CS and Compliance',
    location: 'New Delhi',
    name: 'Complinity Agreement',
    docNumber: 'DOC-123',
    category: 'Agreements',
    subCategory: '',
    subSubCategory: '',
    documentType: 'Public, Private, Protected or Restricted',
    storedAt: 'Corporate Office',
    reviewDate: '01-Nov-2026',
    expiryDate: '06-Mar-2027',
    alertDays: '150',
    remarks: '',
    files: 'File1.pdf;File2.docx',
    owner: 'owner@sboss.net.in',
    manager: 'manager@sboss.net.in',
};

const INSTRUCTIONS: [string, string][] = [
    ['Where to type', 'Enter documents ONLY on the first sheet, one document per row. The other sheets are for reference.'],
    ['Mandatory columns', 'Yellow headings must be filled in. Blue headings are optional.'],
    ['Entity, Vertical, Department, Location', 'Must match a name on the data sheets. The location must belong to the entity on the same row.'],
    ['Category, Sub Category, Sub Sub Category', 'Must already exist under Document Master. A sub category must sit under the category on the same row.'],
    ['Document Type', 'Public, Private, Protected or Restricted.'],
    ['Review Date, Expiry Date', 'Like 01-Jan-2026.'],
    ['Alert Days', 'How many days before the expiry date to start reminding the owner and manager (0 to 999). Needs an expiry date.'],
    ['Attachment Filename', 'The file names inside the zip. Separate several files with ; (File1.pdf;File2.docx). If two files in different folders share a name, write the folder too (folder/File1.pdf).'],
    ['The zip', 'Put all the files into one zip ("Send to > Compressed (zipped) folder" on Windows). Up to 10 MB per file and 200 MB in all. Allowed: PDF, Word, Excel, CSV, text and images.'],
    ['Owner and Manager', 'Email addresses of active users on the Users-Data sheet. View-only users cannot be owner or manager.'],
    ['Checking', 'The upload is checked first. If anything is wrong, nothing is saved and every problem is listed with its row.'],
    ['Limit', 'Up to 500 documents per upload.'],
];

export async function uploadFormat(orgId: string): Promise<Buffer> {
    const [entities, verticals, departments, locations, categories, users] = await Promise.all([
        prisma.entity.findMany({ where: { orgId, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.vertical.findMany({ where: { orgId, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.department.findMany({ where: { orgId, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.location.findMany({ where: { orgId, isActive: true }, include: { entity: { select: { name: true } } }, orderBy: { name: 'asc' } }),
        prisma.docCategory.findMany({ where: { orgId, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.user.findMany({ where: { orgId, isActive: true, role: { in: ['ORG_ADMIN', 'MEMBER'] } }, orderBy: { name: 'asc' } }),
    ]);
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Compliance Platform';
    const ws = wb.addWorksheet('Document ExcelUpload Format', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = UPLOAD_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.alignment = { wrapText: true, vertical: 'middle' };
    head.height = 45;
    UPLOAD_COLUMNS.forEach((c, i) => {
        head.getCell(i + 1).fill = c.required ? REQUIRED_FILL : OPTIONAL_FILL;
    });
    // Text columns stay text, so Excel never turns a document number into a date
    for (let col = 1; col <= UPLOAD_COLUMNS.length; col++) ws.getColumn(col).numFmt = '@';

    sheetOf(wb, 'Instructions', [
        { header: 'Topic', width: 38, get: (r: [string, string]) => r[0] },
        { header: 'How to fill it', width: 120, get: (r: [string, string]) => r[1] },
    ], INSTRUCTIONS);
    sheetOf(wb, 'Example', [
        { header: 'Column', width: 40, get: (c: (typeof UPLOAD_COLUMNS)[number]) => c.header },
        { header: 'Mandatory', width: 12, get: (c) => (c.required ? 'Y' : 'N') },
        { header: 'Example', width: 60, get: (c) => EXAMPLES[c.key] ?? '' },
    ], UPLOAD_COLUMNS);
    sheetOf(wb, 'Entity-Data', [
        { header: 'Entity Name', width: 55, get: (r: (typeof entities)[number]) => r.name },
        { header: 'Entity Code', width: 16, get: (r) => r.code },
    ], entities);
    sheetOf(wb, 'Vertical-Data', [{ header: 'Vertical Name', width: 45, get: (r: (typeof verticals)[number]) => r.name }], verticals);
    sheetOf(wb, 'Department-Data', [{ header: 'Department Name', width: 40, get: (r: (typeof departments)[number]) => r.name }], departments);
    sheetOf(wb, 'Location-Data', [
        { header: 'Location Name', width: 30, get: (r: (typeof locations)[number]) => r.name },
        { header: 'Entity Name', width: 55, get: (r) => r.entity.name },
        { header: 'State', width: 24, get: (r) => r.state },
    ], locations);
    sheetOf(wb, 'Category-Data', [{ header: 'Category Name', width: 40, get: (r: (typeof categories)[number]) => r.name }], categories.filter((c) => c.level === 1));
    sheetOf(wb, 'Sub Category-Data', [
        { header: 'Category Name', width: 35, get: (r: (typeof categories)[number]) => catName.get(r.parentId as string) ?? '' },
        { header: 'Sub Category Name', width: 35, get: (r) => r.name },
    ], categories.filter((c) => c.level === 2 && catName.has(c.parentId as string)));
    sheetOf(wb, 'Sub Sub Category-Data', [
        { header: 'Category Name', width: 30, get: (r: (typeof categories)[number]) => catName.get(parentOf.get(r.parentId as string) as string) ?? '' },
        { header: 'Sub Category Name', width: 30, get: (r) => catName.get(r.parentId as string) ?? '' },
        { header: 'Sub Sub Category Name', width: 30, get: (r) => r.name },
    ], categories.filter((c) => c.level === 3 && catName.has(c.parentId as string)));
    sheetOf(wb, 'Users-Data', [
        { header: 'User Name', width: 30, get: (r: (typeof users)[number]) => r.name },
        { header: 'User Email', width: 36, get: (r) => r.email },
    ], users);

    return Buffer.from(await wb.xlsx.writeBuffer());
}