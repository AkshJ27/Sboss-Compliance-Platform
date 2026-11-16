import type { AttachmentRule, Frequency, PeriodBasis, RiskLevel } from '@prisma/client';
import { parseDateCell } from '../compliance/bulk.import.parser';

// Reads the rows of the internal compliance upload format.
// Everything here is plain logic with no database, so it is easy to test.

export const MAX_INTERNAL_ROWS = 2000;

export type InternalKey =
    | 'title'
    | 'description'
    | 'periodicity'
    | 'event'
    | 'onDay'
    | 'startEnd'
    | 'yearBasis'
    | 'effectiveDate'
    | 'months'
    | 'attachment'
    | 'proof'
    | 'risk'
    | 'entity'
    | 'department'
    | 'location'
    | 'owner'
    | 'alertOwner'
    | 'manager'
    | 'alertManager'
    | 'approver'
    | 'vertical'
    | 'lawCategory'
    | 'nature'
    | 'penalty';

// The columns of the upload format, in order, with the header each one has
export const UPLOAD_COLUMNS: { key: InternalKey | null; header: string; required: boolean; width: number }[] = [
    { key: 'title', header: 'Compliance Name (Length=500)*', required: true, width: 40 },
    { key: 'description', header: 'Compliance Description (Length=20000)*', required: true, width: 50 },
    { key: 'periodicity', header: 'Periodicity (M,Q,H,A,E,O)*', required: true, width: 16 },
    { key: 'event', header: 'Event Name (Length=500) (Enter If Periodicity is E)', required: false, width: 30 },
    { key: 'onDay', header: 'On Day*', required: true, width: 10 },
    { key: 'startEnd', header: 'Start/End Period (S/E)*', required: true, width: 14 },
    { key: 'yearBasis', header: 'Financial/Calendar Year (F/C)*', required: true, width: 14 },
    { key: 'effectiveDate', header: 'Effective Date(dd-Mon-yyyy(01-Jan-2018))*', required: true, width: 18 },
    { key: 'months', header: 'No Of Months (Numeric Only)', required: false, width: 12 },
    { key: 'attachment', header: 'Attachment(M/O)*', required: true, width: 12 },
    { key: 'proof', header: 'Proof of Compliance (Length=1000)', required: false, width: 30 },
    { key: 'risk', header: 'Risk (H/M/L)*', required: true, width: 10 },
    { key: 'entity', header: 'Entity Name (Length=50)*', required: true, width: 30 },
    { key: 'department', header: 'Department Name (Length=50)*', required: true, width: 24 },
    { key: 'location', header: 'Location Name (Length=50)*', required: true, width: 24 },
    { key: 'owner', header: 'Owner Email ID (Length=200)*', required: true, width: 30 },
    { key: 'alertOwner', header: 'Alert Owner (no of days)*', required: true, width: 12 },
    { key: 'manager', header: 'Manager Email Id (Length=200)*', required: true, width: 30 },
    { key: 'alertManager', header: 'Alert Manager (no of days)*', required: true, width: 12 },
    { key: 'approver', header: 'Approval Level 1 Email Id (Length=200)', required: false, width: 30 },
    { key: 'vertical', header: 'Vertical*', required: true, width: 20 },
    { key: 'lawCategory', header: 'Law category (Length=500)', required: false, width: 24 },
    { key: 'nature', header: 'Compliance Nature (Length=200)', required: false, width: 22 },
    { key: 'penalty', header: 'Penalty (Length=2000)', required: false, width: 40 },
];

export const FIELD_LABEL: Record<InternalKey, string> = {
    title: 'compliance name',
    description: 'description',
    periodicity: 'periodicity',
    event: 'event name',
    onDay: 'on day',
    startEnd: 'start/end period',
    yearBasis: 'financial/calendar year',
    effectiveDate: 'effective date',
    months: 'no of months',
    attachment: 'attachment',
    proof: 'proof of compliance',
    risk: 'risk',
    entity: 'entity',
    department: 'department',
    location: 'location',
    owner: 'owner email',
    alertOwner: 'alert owner',
    manager: 'manager email',
    alertManager: 'alert manager',
    approver: 'approval level 1 email',
    vertical: 'vertical',
    lawCategory: 'law category',
    nature: 'compliance nature',
    penalty: 'penalty',
};

const MAX_LENGTH: Partial<Record<InternalKey, number>> = {
    title: 500,
    description: 20000,
    event: 500,
    proof: 1000,
    entity: 100,
    department: 200,
    location: 100,
    owner: 200,
    manager: 200,
    approver: 200,
    vertical: 200,
    lawCategory: 500,
    nature: 200,
    penalty: 2000,
};

// Columns of Complinity's format that this app reads but does not use yet.
// A value in any of them is reported as a warning, never silently dropped.
const IGNORED_PREFIXES = ['escalationuserlevel', 'escalationdayslevel', 'dependentcomplianceid'];
const EXTRA_APPROVAL = /^approvallevel[2-5]emailid$/;

// "Compliance Name (Length=500)*" -> "compliancename"
export const normHeader = (h: string) =>
    h
        .replace(/\(.*\)/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

const HEADER_ALIASES: Record<string, InternalKey> = {
    compliancename: 'title',
    compliancedescription: 'description',
    description: 'description',
    periodicity: 'periodicity',
    eventname: 'event',
    onday: 'onDay',
    startendperiod: 'startEnd',
    financialcalendaryear: 'yearBasis',
    effectivedate: 'effectiveDate',
    noofmonths: 'months',
    attachment: 'attachment',
    proofofcompliance: 'proof',
    risk: 'risk',
    entityname: 'entity',
    entity: 'entity',
    departmentname: 'department',
    department: 'department',
    locationname: 'location',
    location: 'location',
    owneremailid: 'owner',
    owneremail: 'owner',
    alertowner: 'alertOwner',
    manageremailid: 'manager',
    manageremail: 'manager',
    alertmanager: 'alertManager',
    approvallevel1emailid: 'approver',
    approveremail: 'approver',
    vertical: 'vertical',
    lawcategory: 'lawCategory',
    compliancenature: 'nature',
    penalty: 'penalty',
};

export type RowError = { row: number; field?: string; message: string };

export type DueRule = {
    frequency: Frequency;
    dueDay: number | null;
    dueMonthOffset: number;
    event: string | null;
    dueDaysAfterEvent: number | null;
};

export type InternalRawRow = {
    row: number; // the row number in the sheet, so errors point at the right line
    title: string;
    description: string;
    rule: DueRule;
    periodBasis: PeriodBasis;
    effectiveDate: string; // YYYY-MM-DD
    attachment: AttachmentRule;
    proof: string | null;
    risk: RiskLevel;
    entity: string;
    department: string;
    location: string;
    owner: string; // lower case
    alertOwnerDays: number;
    manager: string;
    alertManagerDays: number;
    approver: string | null;
    vertical: string;
    lawCategory: string | null;
    nature: string | null;
    penalty: string | null;
};

// ---- Cell values -----------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// The text of a spreadsheet cell, whatever form the library gives it in:
// plain values, dates, links (emails often become links), rich text and formulas.
export function cellText(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (Array.isArray(o.richText)) {
            return o.richText.map((p) => (p && typeof p === 'object' ? String((p as { text?: unknown }).text ?? '') : '')).join('').trim();
        }
        if ('text' in o) return cellText(o.text);
        if ('result' in o) return cellText(o.result);
    }
    return '';
}

// 01-Jan-2018, 1 January 2018, 2018-01-01, 01-01-2018 or 01/01/2018. Returns YYYY-MM-DD or null.
export function parseDayMonthYear(input: string): string | null {
    const s = input.trim();
    const named = /^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{4})$/.exec(s);
    if (named) {
        const m = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
        if (m < 0) return null;
        return parseDateCell(`${named[3]}-${m + 1}-${named[1]}`);
    }
    return parseDateCell(s);
}

// ---- Periodicity -----------------------------------------------------------------

const PERIOD_MONTHS: Partial<Record<Frequency, number>> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12 };

const PERIODICITY: Record<string, Frequency> = {
    m: 'MONTHLY',
    monthly: 'MONTHLY',
    q: 'QUARTERLY',
    quarterly: 'QUARTERLY',
    h: 'HALF_YEARLY',
    halfyearly: 'HALF_YEARLY',
    a: 'ANNUAL',
    annual: 'ANNUAL',
    annually: 'ANNUAL',
    yearly: 'ANNUAL',
    o: 'ONE_TIME',
    onetime: 'ONE_TIME',
    e: 'EVENT_BASED',
    event: 'EVENT_BASED',
    eventbased: 'EVENT_BASED',
};
const UNSUPPORTED_PERIODICITY: Record<string, string> = {
    f: 'Fortnightly',
    fortnightly: 'Fortnightly',
    b: 'Bi-weekly',
    biweekly: 'Bi-weekly',
    w: 'Weekly',
    weekly: 'Weekly',
    v: 'Variable',
    variable: 'Variable',
};

export function parsePeriodicity(text: string): Frequency | { error: string } {
    const k = text.toLowerCase().replace(/[^a-z]/g, '');
    const f = PERIODICITY[k];
    if (f) return f;
    const unsupported = UNSUPPORTED_PERIODICITY[k];
    if (unsupported) return { error: `${unsupported} is not supported yet. Use M, Q, H, A, O or E` };
    return { error: 'Use M (monthly), Q (quarterly), H (half yearly), A (annual), O (one time) or E (event based)' };
}

/**
 * Turns Complinity's "On Day" and "Start/End Period" into this app's due-date rule,
 * which is a day of the month plus a number of months from the last month of the period.
 *
 * E (end): due on that day of the month after the period ends. Monthly, day 10: June is due 10 July.
 * S (start): due on that day of the first month of the period. Quarterly, day 15: Apr-Jun is due 15 April.
 * One time: the day of the effective date's month (S) or of the month after it (E).
 * Event based: due that many days after the event.
 */
export function dueRuleFor(
    frequency: Frequency,
    onDay: number,
    fromStart: boolean,
    event: string | null,
): DueRule {
    if (frequency === 'EVENT_BASED') {
        return { frequency, dueDay: null, dueMonthOffset: 0, event, dueDaysAfterEvent: onDay };
    }
    if (frequency === 'ONE_TIME') {
        return { frequency, dueDay: onDay, dueMonthOffset: fromStart ? 0 : 1, event: null, dueDaysAfterEvent: null };
    }
    const len = PERIOD_MONTHS[frequency] ?? 1;
    return {
        frequency,
        dueDay: onDay,
        dueMonthOffset: fromStart ? 1 - len : 1,
        event: null,
        dueDaysAfterEvent: null,
    };
}

// ---- Rows ------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LETTER: Record<string, Record<string, string>> = {
    startEnd: { s: 'S', start: 'S', startperiod: 'S', e: 'E', end: 'E', endperiod: 'E' },
    yearBasis: { f: 'FINANCIAL_YEAR', financial: 'FINANCIAL_YEAR', financialyear: 'FINANCIAL_YEAR', c: 'CALENDAR_YEAR', calendar: 'CALENDAR_YEAR', calendaryear: 'CALENDAR_YEAR' },
    attachment: { m: 'MANDATORY', mandatory: 'MANDATORY', o: 'OPTIONAL', optional: 'OPTIONAL' },
    risk: { h: 'HIGH', high: 'HIGH', m: 'MEDIUM', medium: 'MEDIUM', l: 'LOW', low: 'LOW' },
};
const LETTER_HELP: Record<string, string> = {
    startEnd: 'Use S (start of the period) or E (end of the period)',
    yearBasis: 'Use F (financial year) or C (calendar year)',
    attachment: 'Use M (mandatory) or O (optional)',
    risk: 'Use H, M or L',
};

const wholeNumber = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

// Checks one row. `cells` maps each column this app reads to the text in it.
export function parseInternalRow(cells: Partial<Record<InternalKey, string>>, row: number) {
    const errors: RowError[] = [];
    const fail = (key: InternalKey, message: string) => errors.push({ row, field: FIELD_LABEL[key], message });
    const text = (key: InternalKey) => (cells[key] ?? '').trim();

    for (const c of UPLOAD_COLUMNS) {
        if (!c.key) continue;
        const v = text(c.key);
        if (c.required && v === '') fail(c.key, 'This is required');
        const max = MAX_LENGTH[c.key];
        if (max && v.length > max) fail(c.key, `Too long (at most ${max} characters)`);
    }

    const letter = (key: 'startEnd' | 'yearBasis' | 'attachment' | 'risk') => {
        const v = text(key);
        if (v === '') return null;
        const found = LETTER[key][v.toLowerCase().replace(/[^a-z]/g, '')];
        if (!found) fail(key, LETTER_HELP[key]);
        return found ?? null;
    };
    const startEnd = letter('startEnd');
    const yearBasis = letter('yearBasis') as PeriodBasis | null;
    const attachment = letter('attachment') as AttachmentRule | null;
    const risk = letter('risk') as RiskLevel | null;

    let frequency: Frequency | null = null;
    if (text('periodicity')) {
        const p = parsePeriodicity(text('periodicity'));
        if (typeof p === 'string') frequency = p;
        else fail('periodicity', p.error);
    }

    const event = text('event') || null;
    if (frequency === 'EVENT_BASED' && !event) fail('event', 'Required when the periodicity is E');

    let onDay: number | null = null;
    if (text('onDay')) {
        onDay = wholeNumber(text('onDay'));
        if (onDay === null) fail('onDay', 'Enter a whole number');
        else if (frequency === 'EVENT_BASED' && onDay > 365) fail('onDay', 'For event based items, enter 0 to 365 days after the event');
        else if (frequency !== 'EVENT_BASED' && (onDay < 1 || onDay > 31)) fail('onDay', 'Enter a day of the month, 1 to 31');
    }

    let effectiveDate: string | null = null;
    if (text('effectiveDate')) {
        effectiveDate = parseDayMonthYear(text('effectiveDate'));
        if (!effectiveDate) fail('effectiveDate', 'Use a date such as 01-Apr-2026');
    }

    const days = (key: 'alertOwner' | 'alertManager') => {
        const v = text(key);
        if (v === '') return null;
        const n = wholeNumber(v);
        if (n === null || n > 999) {
            fail(key, 'Enter a whole number of days, 0 to 999');
            return null;
        }
        return n;
    };
    const alertOwnerDays = days('alertOwner');
    const alertManagerDays = days('alertManager');
    if (alertOwnerDays !== null && alertManagerDays !== null && alertOwnerDays <= alertManagerDays) {
        fail('alertOwner', 'Owner alert days must be more than manager alert days');
    }

    const email = (key: 'owner' | 'manager' | 'approver') => {
        const v = text(key).toLowerCase();
        if (v === '') return null;
        if (!EMAIL.test(v)) {
            fail(key, 'Enter a valid email address');
            return null;
        }
        return v;
    };
    const owner = email('owner');
    const manager = email('manager');
    const approver = email('approver');

    if (errors.length > 0 || !frequency || onDay === null || !startEnd || !yearBasis || !attachment || !risk) {
        return { data: null, errors };
    }
    if (!effectiveDate || !owner || !manager || alertOwnerDays === null || alertManagerDays === null) {
        return { data: null, errors };
    }

    const data: InternalRawRow = {
        row,
        title: text('title'),
        description: text('description'),
        rule: dueRuleFor(frequency, onDay, startEnd === 'S', event),
        periodBasis: yearBasis,
        effectiveDate,
        attachment,
        proof: text('proof') || null,
        risk,
        entity: text('entity'),
        department: text('department'),
        location: text('location'),
        owner,
        alertOwnerDays,
        manager,
        alertManagerDays,
        approver,
        vertical: text('vertical'),
        lawCategory: text('lawCategory') || null,
        nature: text('nature') || null,
        penalty: text('penalty') || null,
    };
    return { data, errors };
}

/**
 * Reads a whole sheet: the first row is the header, the rest are data.
 * Columns are matched by name, ignoring case, spaces and the "(Length=...)" notes,
 * so Complinity's own format file works as it is.
 */
export function parseInternalSheet(header: unknown[], body: unknown[][]) {
    const keyAt = new Map<number, InternalKey>();
    const ignoredAt = new Map<number, string>();
    const unknown: string[] = [];
    const seen = new Set<InternalKey>();
    const duplicates: string[] = [];
    let extraApprovalAt: number[] = [];

    header.forEach((h, i) => {
        const raw = cellText(h);
        if (!raw) return;
        const n = normHeader(raw);
        const key = HEADER_ALIASES[n];
        if (key) {
            if (seen.has(key)) duplicates.push(raw);
            else {
                seen.add(key);
                keyAt.set(i, key);
            }
            return;
        }
        if (EXTRA_APPROVAL.test(n)) {
            extraApprovalAt = [...extraApprovalAt, i];
            return;
        }
        if (IGNORED_PREFIXES.some((p) => n.startsWith(p))) {
            ignoredAt.set(i, raw);
            return;
        }
        unknown.push(raw);
    });

    const fileErrors: string[] = [];
    if (duplicates.length) fileErrors.push(`Some columns appear more than once: ${duplicates.join(', ')}`);
    const missing = UPLOAD_COLUMNS.filter((c) => c.key && c.required && !seen.has(c.key)).map((c) => FIELD_LABEL[c.key as InternalKey]);
    if (missing.length) fileErrors.push(`Missing required columns: ${missing.join(', ')}`);

    const rows: InternalRawRow[] = [];
    const errors: RowError[] = [];
    const ignoredUsed = new Set<string>();
    let counted = 0;

    if (fileErrors.length === 0) {
        body.forEach((cellsInRow, i) => {
            const rowNo = i + 2; // the header is row 1
            const cells: Partial<Record<InternalKey, string>> = {};
            let any = false;
            for (const [col, key] of keyAt) {
                const t = cellText(cellsInRow[col]);
                if (t) any = true;
                cells[key] = t;
            }
            if (!any) return; // empty rows at the end of a sheet
            counted++;
            if (counted > MAX_INTERNAL_ROWS) return;

            for (const [col, name] of ignoredAt) if (cellText(cellsInRow[col])) ignoredUsed.add(name);
            const extra = extraApprovalAt.filter((col) => cellText(cellsInRow[col]));

            const parsed = parseInternalRow(cells, rowNo);
            errors.push(...parsed.errors);
            if (extra.length > 0) {
                errors.push({
                    row: rowNo,
                    field: 'approval levels 2 to 5',
                    message: 'Only one approval level is supported. Put the approver in Approval Level 1 and leave levels 2 to 5 empty',
                });
            } else if (parsed.data) {
                rows.push(parsed.data);
            }
        });
        if (counted === 0) fileErrors.push('The file has no data rows');
        if (counted > MAX_INTERNAL_ROWS) fileErrors.push(`Too many rows (at most ${MAX_INTERNAL_ROWS}). Split the file.`);
    }

    const warnings: string[] = [];
    if (ignoredUsed.size > 0) {
        warnings.push(`These columns are not used yet, so their values were ignored: ${[...ignoredUsed].join(', ')}`);
    }
    return { rows, errors, fileErrors, warnings, unknownColumns: unknown, totalRows: counted };
}