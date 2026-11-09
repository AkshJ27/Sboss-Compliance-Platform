import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { INDIAN_STATES } from '../../lib/india';
import { HttpError } from '../../lib/errors';
import { scheduleProblem } from './library.schema';

export const MAX_ROWS = 5000;

// Header names are matched ignoring case, spaces, underscores and punctuation
const ALIASES: Record<string, string[]> = {
    code: ['code', 'compliancecode', 'complianceid', 'libraryid'],
    act: ['act', 'actname'],
    lawCategory: ['lawcategory', 'category'],
    jurisdiction: ['jurisdiction', 'centstate', 'centralstate'],
    state: ['state'],
    statutoryAuthority: ['statutoryauthority', 'authority'],
    rule: ['rule', 'rulename'],
    title: ['title', 'compliancename', 'compliancetitle'],
    description: ['description'],
    form: ['form', 'formname', 'formno'],
    reference: ['reference', 'section', 'sectionreference'],
    nature: ['nature', 'compliancenature'],
    type: ['type', 'compliancetype'],
    risk: ['risk', 'risklevel'],
    impact: ['impact'],
    attachment: ['attachment', 'attachmentrule'],
    frequency: ['frequency', 'periodicity'],
    periodBasis: ['periodbasis'],
    dueDay: ['dueday'],
    dueMonthOffset: ['duemonthoffset'],
    event: ['event', 'eventname'],
    dueDaysAfterEvent: ['duedaysafterevent'],
    penalty: ['penalty', 'penaltydescription'],
    imprisonment: ['imprisonment', 'imprisonmentapplicable'],
    isActive: ['isactive', 'active'],
};

const REQUIRED = ['code', 'act', 'lawCategory', 'jurisdiction', 'title', 'frequency'];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const HEADER_TO_FIELD = new Map<string, string>();
for (const [field, names] of Object.entries(ALIASES)) {
    for (const n of names) HEADER_TO_FIELD.set(n, field);
}

const FREQ = {
    monthly: 'MONTHLY', quarterly: 'QUARTERLY', halfyearly: 'HALF_YEARLY', biannual: 'HALF_YEARLY',
    annual: 'ANNUAL', annually: 'ANNUAL', yearly: 'ANNUAL', onetime: 'ONE_TIME', once: 'ONE_TIME',
    eventbased: 'EVENT_BASED', event: 'EVENT_BASED',
} as const;
const RISK = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' } as const;
const ATTACH = { mandatory: 'MANDATORY', optional: 'OPTIONAL', notrequired: 'NOT_REQUIRED' } as const;
const BASIS = {
    financialyear: 'FINANCIAL_YEAR', fy: 'FINANCIAL_YEAR',
    calendaryear: 'CALENDAR_YEAR', cy: 'CALENDAR_YEAR',
} as const;
const JUR = { central: 'CENTRAL', cent: 'CENTRAL', centre: 'CENTRAL', state: 'STATE' } as const;
const BOOL: Record<string, boolean> = {
    yes: true, y: true, true: true, '1': true, active: true,
    no: false, n: false, false: false, '0': false, inactive: false,
};
const STATE_LOOKUP = new Map<string, string>(INDIAN_STATES.map((s) => [norm(s), s]));

const pick = <T extends string>(map: Record<string, T>, label: string) =>
    z
        .string()
        .refine((v) => map[norm(v)] !== undefined, {
            error: (iss) => `Invalid ${label}: "${String(iss.input)}"`,
        })
        .transform((v) => map[norm(v)] as T);

const optText = (max: number) => z.string().max(max).optional();

const intField = (min: number, max: number, label: string) =>
    z
        .string()
        .regex(/^\d+$/, `${label} must be a whole number`)
        .transform(Number)
        .refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}`)
        .optional();

const boolField = (label: string) =>
    z
        .string()
        .refine((v) => BOOL[norm(v)] !== undefined, `${label} must be Yes or No`)
        .transform((v) => BOOL[norm(v)] as boolean)
        .optional();

const stateField = z
    .string()
    .refine((v) => STATE_LOOKUP.has(norm(v)), {
        error: (iss) => `Unknown state: "${String(iss.input)}"`,
    })
    .transform((v) => STATE_LOOKUP.get(norm(v)) as string)
    .optional();

const rowSchema = z
    .object({
        code: z.string().min(1).max(100).transform((s) => s.toUpperCase()),
        act: z.string().min(2).max(500),
        lawCategory: z.string().min(2).max(200),
        jurisdiction: pick(JUR, 'jurisdiction'),
        state: stateField,
        statutoryAuthority: optText(200),
        rule: optText(500),
        title: z.string().min(3).max(500),
        description: optText(5000),
        form: optText(200),
        reference: optText(200),
        nature: optText(200),
        type: optText(200),
        risk: pick(RISK, 'risk').optional(),
        impact: pick(RISK, 'impact').optional(),
        attachment: pick(ATTACH, 'attachment').optional(),
        frequency: pick(FREQ, 'frequency'),
        periodBasis: pick(BASIS, 'period basis').optional(),
        dueDay: intField(1, 31, 'Due day'),
        dueMonthOffset: intField(0, 12, 'Due month offset'),
        event: optText(300),
        dueDaysAfterEvent: intField(0, 365, 'Due days after event'),
        penalty: optText(2000),
        imprisonment: boolField('Imprisonment'),
        isActive: boolField('Active'),
    })
    .superRefine((r, ctx) => {
        if (r.jurisdiction === 'STATE' && !r.state) {
            ctx.addIssue({ code: 'custom', path: ['state'], message: 'State is required for state laws' });
        }
        if (r.jurisdiction === 'CENTRAL' && r.state) {
            ctx.addIssue({ code: 'custom', path: ['state'], message: 'Leave state empty for central laws' });
        }
        const problem = scheduleProblem(r);
        if (problem) ctx.addIssue({ code: 'custom', path: ['frequency'], message: problem });
    });

export type ComplianceInput = z.infer<typeof rowSchema>;
export type ParsedRow = { row: number; data: ComplianceInput };
export type RowError = { row: number; field?: string; message: string };

export function parseCsv(buffer: Buffer) {
    const ignored: string[] = [];
    const mapped = new Set<string>();

    let records: Record<string, string>[];
    try {
        records = parse(buffer, {
            bom: true,
            skip_empty_lines: true,
            trim: true,
            columns: (header: string[]) =>
                header.map((h, i) => {
                    const field = HEADER_TO_FIELD.get(norm(h));
                    if (!field) {
                        ignored.push(h);
                        return `__ignored_${i}`;
                    }
                    if (mapped.has(field)) throw new Error(`Column "${h}" duplicates another column`);
                    mapped.add(field);
                    return field;
                }),
        });
    } catch (e) {
        throw new HttpError(400, `Could not read the CSV: ${(e as Error).message}`);
    }

    if (records.length === 0) throw new HttpError(400, 'The file has no data rows');
    if (records.length > MAX_ROWS) {
        throw new HttpError(400, `Too many rows (max ${MAX_ROWS} per file). Split the file.`);
    }
    const missing = REQUIRED.filter((f) => !mapped.has(f));
    if (missing.length) throw new HttpError(400, `Missing required columns: ${missing.join(', ')}`);

    const rows: ParsedRow[] = [];
    const errors: RowError[] = [];
    const seen = new Map<string, number>();

    records.forEach((rec, i) => {
        const row = i + 1; // row 1 is the first row under the header
        const cleaned = Object.fromEntries(
            Object.entries(rec).filter(([k, v]) => !k.startsWith('__ignored_') && v !== ''),
        );

        const res = rowSchema.safeParse(cleaned);
        if (!res.success) {
            for (const issue of res.error.issues) {
                errors.push({ row, field: issue.path.join('.') || undefined, message: issue.message });
            }
            return;
        }

        const prev = seen.get(res.data.code);
        if (prev) {
            errors.push({ row, field: 'code', message: `Duplicate code (also in row ${prev})` });
            return;
        }
        seen.set(res.data.code, row);
        rows.push({ row, data: res.data });
    });

    return { rows, errors, ignoredColumns: ignored, totalRows: records.length };
}