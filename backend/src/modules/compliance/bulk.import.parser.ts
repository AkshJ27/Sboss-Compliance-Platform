import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { HttpError } from '../../lib/errors';

export const MAX_ROWS = 5000;
const MAX_TEXT = 200;

export type ColumnKey =
    | 'entity'
    | 'location'
    | 'code'
    | 'owner'
    | 'manager'
    | 'approver'
    | 'department'
    | 'vertical'
    | 'startDate';

// The order columns are checked in, and in the template
const COLUMN_ORDER: ColumnKey[] = [
    'entity',
    'location',
    'code',
    'owner',
    'manager',
    'approver',
    'department',
    'vertical',
    'startDate',
];

// The names shown in error messages and in the template
export const FIELD_LABEL: Record<ColumnKey, string> = {
    entity: 'entity',
    location: 'location',
    code: 'compliance code',
    owner: 'owner email',
    manager: 'manager email',
    approver: 'approver email',
    department: 'department',
    vertical: 'vertical',
    startDate: 'start date',
};

// Header names are matched ignoring case, spaces, underscores and punctuation
const ALIASES: Record<ColumnKey, string[]> = {
    entity: ['entity', 'entitycode', 'entityname'],
    location: ['location', 'locationname'],
    code: ['compliancecode', 'code', 'libraryid', 'complianceid'],
    owner: ['owneremail', 'owner'],
    manager: ['manageremail', 'manager'],
    approver: ['approveremail', 'approver'],
    department: ['department', 'departmentname'],
    vertical: ['vertical', 'verticalname'],
    startDate: ['startdate', 'obligationsapplyfrom'],
};

const REQUIRED: ColumnKey[] = ['entity', 'location', 'code', 'owner', 'manager'];
const EMAIL_KEYS: ColumnKey[] = ['owner', 'manager', 'approver'];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const HEADER_TO_FIELD = new Map<string, ColumnKey>();
for (const [field, names] of Object.entries(ALIASES) as [ColumnKey, string[]][]) {
    for (const n of names) HEADER_TO_FIELD.set(n, field);
}

export type RowError = { row: number; field?: string; message: string };

export type RawRow = {
    row: number; // 1 is the first row under the header
    entity: string;
    location: string;
    code: string; // upper case
    owner: string; // lower case
    manager: string;
    approver: string | null;
    department: string | null;
    vertical: string | null;
    startDate: string | null; // YYYY-MM-DD
};

// YYYY-MM-DD, or day first: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY. Returns YYYY-MM-DD, or null.
export function parseDateCell(input: string): string | null {
    const s = input.trim();
    let y: number;
    let m: number;
    let d: number;

    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (iso) {
        y = Number(iso[1]);
        m = Number(iso[2]);
        d = Number(iso[3]);
    } else {
        const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
        if (!dayFirst) return null;
        d = Number(dayFirst[1]);
        m = Number(dayFirst[2]);
        y = Number(dayFirst[3]);
    }

    if (y < 2000 || y > 2100) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return date.toISOString().slice(0, 10);
}

const EMAIL = z.string().email();
const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function parseRow(rec: Record<string, unknown>, row: number): { data: RawRow | null; errors: RowError[] } {
    const errors: RowError[] = [];
    const text: Partial<Record<ColumnKey, string>> = {};

    for (const key of COLUMN_ORDER) {
        const value = clean(rec[key]);
        const field = FIELD_LABEL[key];

        if (value === '') {
            if (REQUIRED.includes(key)) errors.push({ row, field, message: 'This is required' });
            continue;
        }
        if (value.length > MAX_TEXT) {
            errors.push({ row, field, message: `Too long (at most ${MAX_TEXT} characters)` });
            continue;
        }
        if (EMAIL_KEYS.includes(key)) {
            if (!EMAIL.safeParse(value).success) {
                errors.push({ row, field, message: 'Enter a valid email address' });
                continue;
            }
            text[key] = value.toLowerCase();
            continue;
        }
        if (key === 'startDate') {
            const date = parseDateCell(value);
            if (!date) {
                errors.push({ row, field, message: 'Use YYYY-MM-DD or DD-MM-YYYY' });
                continue;
            }
            text[key] = date;
            continue;
        }
        text[key] = key === 'code' ? value.toUpperCase() : value;
    }

    if (errors.length > 0) return { data: null, errors };
    return {
        data: {
            row,
            entity: text.entity as string,
            location: text.location as string,
            code: text.code as string,
            owner: text.owner as string,
            manager: text.manager as string,
            approver: text.approver ?? null,
            department: text.department ?? null,
            vertical: text.vertical ?? null,
            startDate: text.startDate ?? null,
        },
        errors,
    };
}

export function parseScheduleCsv(buffer: Buffer) {
    const ignored: string[] = [];
    const duplicates: string[] = [];
    const mapped = new Set<ColumnKey>();

    let records: Record<string, unknown>[];
    try {
        records = parse(buffer, {
            bom: true,
            skip_empty_lines: true,
            trim: true,
            columns: (header: string[]) =>
                header.map((h, i) => {
                    const field = HEADER_TO_FIELD.get(norm(h));
                    if (!field) {
                        if (h.trim() !== '') ignored.push(h);
                        return `__skip_${i}`;
                    }
                    if (mapped.has(field)) {
                        duplicates.push(h);
                        return `__skip_${i}`;
                    }
                    mapped.add(field);
                    return field;
                }),
        }) as Record<string, unknown>[];
    } catch (e) {
        throw new HttpError(400, `Could not read the CSV: ${(e as Error).message}`);
    }

    if (mapped.size === 0 && ignored.length === 0 && duplicates.length === 0) {
        throw new HttpError(400, 'The file is empty');
    }
    if (records.length > MAX_ROWS) {
        throw new HttpError(400, `Too many rows (max ${MAX_ROWS}). Split the file.`);
    }
    const missing = REQUIRED.filter((k) => !mapped.has(k));
    if (missing.length > 0) {
        throw new HttpError(400, `Missing required columns: ${missing.map((k) => FIELD_LABEL[k]).join(', ')}`);
    }
    if (duplicates.length > 0) {
        throw new HttpError(400, `Some columns appear more than once: ${duplicates.join(', ')}`);
    }

    const rows: RawRow[] = [];
    const errors: RowError[] = [];
    let counted = 0;

    records.forEach((rec, i) => {
        // Rows that are only commas, which Excel adds at the end of a sheet, are skipped
        if (COLUMN_ORDER.every((k) => clean(rec[k]) === '')) return;
        counted++;
        const parsed = parseRow(rec, i + 1);
        errors.push(...parsed.errors);
        if (parsed.data) rows.push(parsed.data);
    });

    if (counted === 0) throw new HttpError(400, 'The file has no data rows');
    return { rows, errors, ignoredColumns: ignored, totalRows: counted };
}

// An empty file to fill in: the headings only, so no made-up rows can be uploaded by mistake
export function templateCsv(): string {
    const header = COLUMN_ORDER.map((k) => FIELD_LABEL[k]);
    return '\uFEFF' + header.join(',') + '\r\n';
}