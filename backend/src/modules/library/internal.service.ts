import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly } from '../../lib/dates';
import { HttpError, rethrowUnique } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import { lowerKey } from '../compliance/bulk.import.resolve';
import type { NamedRef, UserRef } from '../compliance/bulk.import.resolve';
import { UPLOAD_COLUMNS, parseInternalRow, parseInternalSheet } from './internal.parser';
import type { InternalKey, InternalRawRow, RowError } from './internal.parser';
import { existingTitleKey, internalPrefix, nextCodes, resolveInternalRows } from './internal.resolve';
import type { InternalLookups, ResolvedInternalRow } from './internal.resolve';
import { UPDATE_COLUMNS, changedEditable, checkEditable, parseUpdateSheet } from './internal.update';
import type { EditableFields, UpdateRow } from './internal.update';

type Db = Prisma.TransactionClient;

const MAX_ERRORS_SHOWN = 200;
const MAX_UPDATE_ROWS = 5000;
const INTERNAL_ACT = 'Internal Compliance';
const TX = { timeout: 5 * 60 * 1000, maxWait: 10_000 };

// ---- Reading a workbook -------------------------------------------------------------

// The first sheet as a header row and data rows of raw cell values
async function readFirstSheet(buffer: Buffer): Promise<{ header: unknown[]; body: unknown[][] }> {
    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
        throw new HttpError(400, 'Could not read the file. Save it as an Excel workbook (.xlsx) and try again.');
    }
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount === 0) throw new HttpError(400, 'The file is empty');

    const width = ws.columnCount;
    const read = (r: number) => {
        const row = ws.getRow(r);
        return Array.from({ length: width }, (_, i) => row.getCell(i + 1).value as unknown);
    };
    const header = read(1);
    const body: unknown[][] = [];
    for (let r = 2; r <= ws.rowCount; r++) body.push(read(r));
    return { header, body };
}

// ---- Upload: checking -------------------------------------------------------------

const scopeToOrg = (orgId: string): Prisma.ComplianceWhereInput => ({ orgId });

async function loadLookups(db: Db, orgId: string, rows: readonly InternalRawRow[]): Promise<InternalLookups> {
    const [entities, departments, verticals, lawCategories, natures, locations] = await Promise.all([
        db.entity.findMany({ where: { orgId }, select: { id: true, code: true, name: true, isActive: true } }),
        db.department.findMany({ where: { orgId }, select: { id: true, name: true, isActive: true } }),
        db.vertical.findMany({ where: { orgId }, select: { id: true, name: true, isActive: true } }),
        db.lawCategory.findMany({ select: { id: true, name: true } }),
        db.complianceNature.findMany({ select: { id: true, name: true } }),
        db.location.findMany({
            where: { orgId },
            select: { id: true, entityId: true, name: true, state: true, isActive: true },
        }),
    ]);

    const emails = new Set<string>();
    for (const r of rows) {
        emails.add(r.owner);
        emails.add(r.manager);
        if (r.approver) emails.add(r.approver);
    }
    const users = new Map<string, UserRef>();
    for (const part of chunks([...emails], 5000)) {
        const found = await db.user.findMany({
            where: { orgId, email: { in: part } },
            select: { id: true, email: true, name: true, isActive: true, role: true },
        });
        for (const u of found) users.set(u.email.toLowerCase(), { id: u.id, name: u.name, isActive: u.isActive, role: u.role });
    }

    // Internal compliances already scheduled, so the same file uploaded twice is caught
    const existing = new Map<string, string>();
    const scheduled = await db.complianceSchedule.findMany({
        where: { orgId, compliance: scopeToOrg(orgId) },
        select: { locationId: true, compliance: { select: { code: true, title: true } } },
    });
    for (const s of scheduled) existing.set(existingTitleKey(s.locationId, s.compliance.title), s.compliance.code);

    const named = (list: { id: string; name: string; isActive: boolean }[]) => {
        const m = new Map<string, NamedRef>();
        for (const x of list) m.set(lowerKey(x.name), { id: x.id, isActive: x.isActive });
        return m;
    };
    const byName = (list: { id: string; name: string }[]) => new Map(list.map((x) => [lowerKey(x.name), x]));

    return {
        entities,
        locations,
        users,
        departments: named(departments),
        verticals: named(verticals),
        lawCategories: byName(lawCategories),
        natures: byName(natures),
        existing,
    };
}

async function plan(db: Db, orgId: string, rows: readonly InternalRawRow[]) {
    const lookups = await loadLookups(db, orgId, rows);
    return resolveInternalRows(rows, lookups);
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

function summary(resolved: ResolvedInternalRow[], totalRows: number, warnings: string[], dryRun: boolean, created: string[]) {
    return {
        ok: true as const,
        dryRun,
        totalRows,
        toCreate: resolved.length,
        locations: new Set(resolved.map((r) => r.locationId)).size,
        highRisk: resolved.filter((r) => r.raw.risk === 'HIGH').length,
        warnings,
        created: created.length,
        sample: resolved.slice(0, 20).map((r, i) => ({
            row: r.raw.row,
            code: created[i] ?? null,
            title: r.raw.title,
            location: r.locationLabel,
            frequency: r.raw.rule.frequency,
            risk: r.raw.risk,
            owner: r.ownerName,
            manager: r.managerName,
            effectiveDate: r.raw.effectiveDate,
        })),
    };
}

// ---- Upload: writing --------------------------------------------------------------

// The company's "Internal Compliance" Act under each law category, created the first time it is needed
async function actsFor(tx: Db, orgId: string, lawCategoryNames: string[]) {
    const out = new Map<string, string>(); // law category name -> act id
    for (const name of new Set(lawCategoryNames)) {
        let category = await tx.lawCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
        if (!category) category = await tx.lawCategory.create({ data: { name } });

        let act = await tx.act.findFirst({
            where: { orgId, name: INTERNAL_ACT, lawCategoryId: category.id },
            select: { id: true },
        });
        if (!act) {
            act = await tx.act.create({
                data: { orgId, name: INTERNAL_ACT, jurisdiction: 'CENTRAL', state: null, lawCategoryId: category.id },
                select: { id: true },
            });
        }
        out.set(name, act.id);
    }
    return out;
}

// Creates each compliance and its schedule. Returns the new codes in row order.
async function writeRows(tx: Db, actor: AuthUser, resolved: ResolvedInternalRow[]): Promise<string[]> {
    const { orgId } = actor;
    const acts = await actsFor(tx, orgId, resolved.map((r) => r.lawCategoryName));

    const prefix = internalPrefix(orgId);
    const taken = await tx.compliance.findMany({
        where: { code: { startsWith: prefix } },
        select: { code: true },
    });
    const codes = nextCodes(prefix, taken.map((t) => t.code), resolved.length);

    const ids = new Map<string, string>(); // code -> id
    for (const [part, offset] of [...chunks(resolved, 500)].map((p, i) => [p, i * 500] as const)) {
        const made = await tx.compliance.createManyAndReturn({
            data: part.map((r, i) => {
                const raw = r.raw;
                return {
                    orgId,
                    code: codes[offset + i],
                    actId: acts.get(r.lawCategoryName) as string,
                    natureId: r.natureId,
                    title: raw.title,
                    description: raw.description,
                    risk: raw.risk,
                    impact: raw.risk,
                    attachment: raw.attachment,
                    frequency: raw.rule.frequency,
                    periodBasis: raw.periodBasis,
                    dueDay: raw.rule.dueDay,
                    dueMonthOffset: raw.rule.dueMonthOffset,
                    event: raw.rule.event,
                    dueDaysAfterEvent: raw.rule.dueDaysAfterEvent,
                    penalty: raw.penalty,
                    proofOfCompliance: raw.proof,
                    alertOwnerDays: raw.alertOwnerDays,
                    alertManagerDays: raw.alertManagerDays,
                    effectiveDate: parseDateOnly(raw.effectiveDate),
                };
            }),
            select: { id: true, code: true },
        });
        for (const m of made) ids.set(m.code, m.id);
    }

    for (const [part, offset] of [...chunks(resolved, 1000)].map((p, i) => [p, i * 1000] as const)) {
        await tx.complianceSchedule.createMany({
            data: part.map((r, i) => {
                const raw = r.raw;
                return {
                    orgId,
                    complianceId: ids.get(codes[offset + i]) as string,
                    entityId: r.entityId,
                    locationId: r.locationId,
                    departmentId: r.departmentId,
                    verticalId: r.verticalId,
                    ownerId: r.ownerId,
                    managerId: r.managerId,
                    approverId: r.approverId,
                    startDate: parseDateOnly(raw.effectiveDate),
                    libraryVersion: 1,
                    frequency: raw.rule.frequency,
                    periodBasis: raw.periodBasis,
                    dueDay: raw.rule.dueDay,
                    dueMonthOffset: raw.rule.dueMonthOffset,
                    event: raw.rule.event,
                    dueDaysAfterEvent: raw.rule.dueDaysAfterEvent,
                };
            }),
        });
    }
    return codes;
}

async function createInternal(actor: AuthUser, rows: InternalRawRow[], totalRows: number, warnings: string[], dryRun: boolean) {
    const { orgId } = actor;
    if (dryRun) {
        const { resolved, errors } = await plan(prisma, orgId, rows);
        return errors.length ? failure(errors, warnings) : summary(resolved, totalRows, warnings, true, []);
    }
    try {
        return await prisma.$transaction(async (tx) => {
            // Checked again inside the transaction, so what is written is never based on stale data
            const { resolved, errors } = await plan(tx, orgId, rows);
            if (errors.length) return failure(errors, warnings);
            const codes = await writeRows(tx, actor, resolved);
            await recordAudit(tx, actor, 'INTERNAL_COMPLIANCES_CREATED', 'Compliance', 'internal', {
                created: codes.length,
                codes: codes.slice(0, 100),
            });
            return summary(resolved, totalRows, warnings, false, codes);
        }, TX);
    } catch (e) {
        rethrowUnique(e, 'Someone else added internal compliances at the same time. Nothing was saved. Try again.');
    }
}

export async function importInternal(actor: AuthUser, buffer: Buffer, dryRun: boolean) {
    const { header, body } = await readFirstSheet(buffer);
    const parsed = parseInternalSheet(header, body);
    if (parsed.fileErrors.length || parsed.errors.length) {
        return failure(parsed.errors, parsed.warnings, parsed.fileErrors);
    }
    return createInternal(actor, parsed.rows, parsed.totalRows, parsed.warnings, dryRun);
}

// One compliance from the add form. The form sends the same values a spreadsheet row holds.
export async function addInternal(actor: AuthUser, cells: Partial<Record<InternalKey, string>>) {
    const parsed = parseInternalRow(cells, 1);
    if (!parsed.data) return failure(parsed.errors, []);
    return createInternal(actor, [parsed.data], 1, [], false);
}

// ---- Editing ------------------------------------------------------------------------

const editableSelect = {
    id: true,
    code: true,
    title: true,
    description: true,
    attachment: true,
    proofOfCompliance: true,
    risk: true,
    applicability: true,
    penalty: true,
    alertOwnerDays: true,
    alertManagerDays: true,
    isActive: true,
} satisfies Prisma.ComplianceSelect;
type EditableRow = Prisma.ComplianceGetPayload<{ select: typeof editableSelect }>;

const storedFields = (c: EditableRow): EditableFields => ({
    title: c.title,
    description: c.description ?? '',
    attachment: c.attachment,
    proofOfCompliance: c.proofOfCompliance,
    risk: c.risk,
    applicability: c.applicability,
    penalty: c.penalty,
    alertOwnerDays: c.alertOwnerDays ?? 0,
    alertManagerDays: c.alertManagerDays ?? 0,
    isActive: c.isActive,
});

type Change = { id: string; code: string; before: EditableFields; changes: Partial<EditableFields> };

async function planUpdates(db: Db, orgId: string, rows: UpdateRow[]) {
    const byCode = new Map<string, EditableRow>();
    for (const part of chunks(rows.map((r) => r.code), 5000)) {
        const found = await db.compliance.findMany({ where: { orgId, code: { in: part } }, select: editableSelect });
        for (const c of found) byCode.set(c.code.toUpperCase(), c);
    }
    const errors: RowError[] = [];
    const changes: Change[] = [];
    for (const r of rows) {
        const c = byCode.get(r.code);
        if (!c) {
            errors.push({ row: r.row, field: 'compliance code', message: 'No internal compliance of your company has this code' });
            continue;
        }
        const before = storedFields(c);
        const diff = changedEditable(before, r.fields);
        if (Object.keys(diff).length) changes.push({ id: c.id, code: c.code, before, changes: diff });
    }
    return { errors, changes };
}

async function applyUpdates(tx: Db, actor: AuthUser, changes: Change[]) {
    for (const c of changes) {
        await tx.compliance.update({ where: { id: c.id }, data: c.changes });
        const audit: Record<string, { from: unknown; to: unknown }> = {};
        for (const [k, v] of Object.entries(c.changes)) audit[k] = { from: c.before[k as keyof EditableFields], to: v };
        await recordAudit(tx, actor, 'INTERNAL_COMPLIANCE_UPDATED', 'Compliance', c.id, audit as Prisma.InputJsonValue);
    }
}

export async function importUpdates(actor: AuthUser, buffer: Buffer, dryRun: boolean) {
    const { header, body } = await readFirstSheet(buffer);
    const parsed = parseUpdateSheet(header, body, MAX_UPDATE_ROWS);
    if (parsed.fileErrors.length || parsed.errors.length) return failure(parsed.errors, [], parsed.fileErrors);

    const run = async (db: Db, write: boolean) => {
        const p = await planUpdates(db, actor.orgId, parsed.rows);
        if (p.errors.length) return failure(p.errors, []);
        if (write) await applyUpdates(db, actor, p.changes);
        return {
            ok: true as const,
            dryRun: !write,
            totalRows: parsed.totalRows,
            changed: p.changes.length,
            unchanged: parsed.rows.length - p.changes.length,
            sample: p.changes.slice(0, 20).map((c) => ({ code: c.code, fields: Object.keys(c.changes) })),
        };
    };
    return dryRun ? run(prisma, false) : prisma.$transaction((tx) => run(tx, true), TX);
}

export async function patchInternal(actor: AuthUser, id: string, values: Partial<Record<keyof EditableFields, string>>) {
    const checked = checkEditable(values, 1);
    if (!checked.fields) {
        throw new HttpError(400, checked.errors.map((e) => `${e.field}: ${e.message}`).join('; '));
    }
    const fields = checked.fields;
    return prisma.$transaction(async (tx) => {
        const c = await tx.compliance.findFirst({ where: { id, orgId: actor.orgId }, select: editableSelect });
        if (!c) throw new HttpError(404, 'Internal compliance not found');
        const before = storedFields(c);
        const changes = changedEditable(before, fields);
        if (Object.keys(changes).length) await applyUpdates(tx, actor, [{ id, code: c.code, before, changes }]);
        return { id, code: c.code, changed: Object.keys(changes) };
    });
}

// ---- Formats to download --------------------------------------------------------------

const REQUIRED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const OPTIONAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

function sheetOf<T>(wb: ExcelJS.Workbook, name: string, columns: { header: string; width: number; get: (r: T) => unknown }[], rows: T[]) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(columns.map((c) => c.get(r)));
    return ws;
}

const INSTRUCTIONS: [string, string][] = [
    ['Mandatory columns', 'Columns with a yellow heading must be filled in. Blue headings are optional.'],
    ['One row', 'Each row creates one internal compliance and schedules it at one location.'],
    ['Periodicity', 'M monthly, Q quarterly, H half yearly, A annual, O one time, E event based.'],
    ['On Day', 'For M, Q, H, A and O: the day of the month it is due, 1 to 31. For E: days after the event, 0 to 365.'],
    ['Start/End Period', 'E: due on that day of the month after the period ends (June wages, day 10: due 10 July). S: due on that day of the first month of the period.'],
    ['Financial/Calendar Year', 'F: periods follow the April to March year. C: periods follow January to December.'],
    ['Effective Date', 'The date the obligation starts, such as 01-Apr-2026. Nothing falls due before it.'],
    ['Attachment', 'M: proof must be attached when submitting. O: proof is optional.'],
    ['Entity, Department, Location, Vertical', 'Must match a name on the data sheets in this file.'],
    ['Owner, Manager, Approval Level 1', 'Email addresses of active users in the Users sheet. Owner and manager must be different. High-risk items need an approver.'],
    ['Alert days', 'Owner alert days must be more than manager alert days.'],
    ['Law category, Compliance nature', 'Optional. Use a name from their sheets. Without a law category, the item is filed under "Internal Compliance".'],
    ['After uploading', 'Run Setup > Schedules > Generate items to create the dated items.'],
];

export async function uploadFormat(orgId: string): Promise<Buffer> {
    const [entities, departments, locations, users, verticals, categories, natures] = await Promise.all([
        prisma.entity.findMany({ where: { orgId, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.department.findMany({ where: { orgId, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.location.findMany({ where: { orgId, isActive: true }, include: { entity: { select: { name: true } } }, orderBy: { name: 'asc' } }),
        prisma.user.findMany({ where: { orgId, isActive: true, role: { in: ['ORG_ADMIN', 'MEMBER'] } }, orderBy: { name: 'asc' } }),
        prisma.vertical.findMany({ where: { orgId, isActive: true }, orderBy: { name: 'asc' } }),
        prisma.lawCategory.findMany({ orderBy: { name: 'asc' } }),
        prisma.complianceNature.findMany({ orderBy: { name: 'asc' } }),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Compliance Platform';
    const ws = wb.addWorksheet('Internal Compliance Upload', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = UPLOAD_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.alignment = { wrapText: true, vertical: 'middle' };
    head.height = 45;
    UPLOAD_COLUMNS.forEach((c, i) => {
        head.getCell(i + 1).fill = c.required ? REQUIRED_FILL : OPTIONAL_FILL;
    });

    sheetOf(wb, 'Instructions', [
        { header: 'Topic', width: 34, get: (r: [string, string]) => r[0] },
        { header: 'How to fill it', width: 120, get: (r: [string, string]) => r[1] },
    ], INSTRUCTIONS);
    sheetOf(wb, 'Entities', [
        { header: 'Entity Name', width: 50, get: (r: (typeof entities)[number]) => r.name },
        { header: 'Entity Code', width: 16, get: (r) => r.code },
    ], entities);
    sheetOf(wb, 'Departments', [{ header: 'Department Name', width: 40, get: (r: (typeof departments)[number]) => r.name }], departments);
    sheetOf(wb, 'Locations', [
        { header: 'Location Name', width: 30, get: (r: (typeof locations)[number]) => r.name },
        { header: 'Entity', width: 50, get: (r) => r.entity.name },
        { header: 'State', width: 24, get: (r) => r.state },
    ], locations);
    sheetOf(wb, 'Users', [
        { header: 'Email', width: 36, get: (r: (typeof users)[number]) => r.email },
        { header: 'Name', width: 30, get: (r) => r.name },
    ], users);
    sheetOf(wb, 'Verticals', [{ header: 'Vertical Name', width: 40, get: (r: (typeof verticals)[number]) => r.name }], verticals);
    sheetOf(wb, 'Law Categories', [{ header: 'Law Category Name', width: 50, get: (r: (typeof categories)[number]) => r.name }], categories);
    sheetOf(wb, 'Compliance Natures', [{ header: 'Compliance Nature Name', width: 40, get: (r: (typeof natures)[number]) => r.name }], natures);

    return Buffer.from(await wb.xlsx.writeBuffer());
}

const ATTACH_LETTER: Record<string, string> = { MANDATORY: 'M', OPTIONAL: 'O', NOT_REQUIRED: 'O' };
const RISK_LETTER: Record<string, string> = { HIGH: 'H', MEDIUM: 'M', LOW: 'L' };

// The company's internal compliances as they are now, ready to edit and upload again
export async function updateFormat(orgId: string): Promise<Buffer> {
    const rows = await prisma.compliance.findMany({ where: { orgId }, select: editableSelect, orderBy: { code: 'asc' } });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Compliance Platform';

    const value = (r: EditableRow, key: (typeof UPDATE_COLUMNS)[number]['key']): unknown => {
        switch (key) {
            case 'code': return r.code;
            case 'attachment': return ATTACH_LETTER[r.attachment];
            case 'risk': return RISK_LETTER[r.risk];
            case 'isActive': return r.isActive ? 'Y' : 'N';
            case 'alertOwnerDays': return r.alertOwnerDays ?? 0;
            case 'alertManagerDays': return r.alertManagerDays ?? 0;
            default: return r[key] ?? '';
        }
    };
    const ws = sheetOf(wb, 'Internal Compliance Update', UPDATE_COLUMNS.map((c) => ({
        header: c.header,
        width: c.width,
        get: (r: EditableRow) => value(r, c.key),
    })), rows);
    ws.getRow(1).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

    sheetOf(wb, 'Instructions', [
        { header: 'Topic', width: 30, get: (r: [string, string]) => r[0] },
        { header: 'How to fill it', width: 110, get: (r: [string, string]) => r[1] },
    ], [
        ['Compliance Code', 'Do not change it. It is how each row is matched to a compliance.'],
        ['What you can change', 'Name, description, attachment, proof, risk, applicability, penalty, alert days and active.'],
        ['What you cannot change here', 'Periodicity and due day, entity, location and people. Change people under Setup > Schedules.'],
        ['Active', 'N stops new items being generated. Items that already exist are not removed.'],
        ['Rows you leave out', 'Are not changed.'],
    ]);
    return Buffer.from(await wb.xlsx.writeBuffer());
}