import { INDIAN_STATES } from '../../lib/india';
import { parseDateCell } from '../compliance/bulk.import.parser';
import { cellText, normHeader } from '../library/internal.parser';

// Reads a Legal Updates Register (the same layout the Excel export produces, and Complinity's own export).
// Plain logic with no database, so it is easy to test.

export const MAX_LEGAL_ROWS = 10_000;

export type LegalKey =
    | 'lawCategory' | 'act' | 'rule' | 'region' | 'ministry' | 'notificationDate' | 'effectiveDate' | 'referenceNumber'
    | 'title' | 'description' | 'complianceImpact' | 'change' | 'addition' | 'deletion' | 'schedule'
    | 'impactedCompliance' | 'publishedDate';

export const LEGAL_COLUMNS: { key: LegalKey; header: string; required: boolean; max?: number; width: number }[] = [
    { key: 'lawCategory', header: 'Law Category', required: true, max: 200, width: 22 },
    { key: 'act', header: 'Act', required: true, max: 500, width: 40 },
    { key: 'rule', header: 'Rule', required: false, max: 500, width: 40 },
    { key: 'region', header: 'Central/State', required: true, max: 60, width: 16 },
    { key: 'ministry', header: 'Ministry', required: false, max: 200, width: 30 },
    { key: 'notificationDate', header: 'Notification Date', required: true, width: 16 },
    { key: 'effectiveDate', header: 'Effective Date', required: false, width: 16 },
    { key: 'referenceNumber', header: 'Reference Number', required: false, max: 200, width: 30 },
    { key: 'title', header: 'Title', required: true, max: 500, width: 50 },
    { key: 'description', header: 'Description', required: true, max: 20000, width: 80 },
    { key: 'complianceImpact', header: 'Compliance Impact', required: false, width: 12 },
    { key: 'change', header: 'Change', required: false, width: 10 },
    { key: 'addition', header: 'Addition', required: false, width: 10 },
    { key: 'deletion', header: 'Deletion', required: false, width: 10 },
    { key: 'schedule', header: 'Schedule', required: false, width: 10 },
    { key: 'impactedCompliance', header: 'Impacted Compliance', required: false, max: 5000, width: 30 },
    { key: 'publishedDate', header: 'Published Date', required: false, width: 16 },
];

const KEY_OF: Record<string, LegalKey> = {
    lawcategory: 'lawCategory',
    act: 'act', actname: 'act',
    rule: 'rule', rulename: 'rule',
    centralstate: 'region', centstate: 'region', state: 'region',
    ministry: 'ministry',
    notificationdate: 'notificationDate',
    effectivedate: 'effectiveDate',
    referencenumber: 'referenceNumber', notificationno: 'referenceNumber', referenceno: 'referenceNumber',
    title: 'title',
    description: 'description',
    complianceimpact: 'complianceImpact',
    change: 'change', addition: 'addition', deletion: 'deletion', schedule: 'schedule',
    impactedcompliance: 'impactedCompliance',
    publisheddate: 'publishedDate',
};

const LABEL = Object.fromEntries(LEGAL_COLUMNS.map((c) => [c.key, c.header])) as Record<LegalKey, string>;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const STATE_BY_KEY = new Map<string, string>(INDIAN_STATES.map((s) => [s.toLowerCase(), s]));

export type RowError = { row: number; field?: string; message: string };

export type LegalRow = {
    row: number;
    lawCategory: string;
    act: string;
    rule: string | null;
    jurisdiction: 'CENTRAL' | 'STATE';
    state: string | null;
    ministry: string | null;
    notificationDate: string; // YYYY-MM-DD
    effectiveDate: string | null;
    publishedDate: string;
    referenceNumber: string | null;
    title: string;
    description: string;
    complianceImpact: boolean;
    isChange: boolean;
    isAddition: boolean;
    isDeletion: boolean;
    isSchedule: boolean;
    impactedCompliance: string | null;
};

// 11-Nov-26, 11-Nov-2026, 11 November 2026, 2026-11-11 or 11/11/2026. Returns YYYY-MM-DD or null.
export function parseLegalDate(input: string): string | null {
    const s = input.trim();
    const named = /^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{2}|\d{4})$/.exec(s);
    if (named) {
        const m = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
        if (m < 0) return null;
        const y = named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3]);
        return parseDateCell(`${y}-${m + 1}-${named[1]}`);
    }
    return parseDateCell(s);
}

// "NA", "-" and blanks all mean nothing was given
const nothing = (v: string) => !v || /^(na|n\/a|-|nil|none)$/i.test(v);

function yesNo(v: string): boolean | null {
    const k = v.trim().toLowerCase();
    if (!k || k === 'no' || k === 'n' || k === 'false' || k === '0') return false;
    if (k === 'yes' || k === 'y' || k === 'true' || k === '1') return true;
    return null;
}

export function parseLegalRow(cells: Partial<Record<LegalKey, string>>, row: number): { data: LegalRow | null; errors: RowError[] } {
    const errors: RowError[] = [];
    const err = (key: LegalKey, message: string) => errors.push({ row, field: LABEL[key], message });
    const get = (key: LegalKey) => (cells[key] ?? '').trim();

    for (const c of LEGAL_COLUMNS) {
        const v = get(c.key);
        if (c.required && !v) err(c.key, 'Required');
        else if (c.max && v.length > c.max) err(c.key, `Longer than ${c.max} characters`);
    }

    const regionText = get('region');
    let jurisdiction: 'CENTRAL' | 'STATE' = 'CENTRAL';
    let state: string | null = null;
    if (regionText && !/^cent(ral)?$/i.test(regionText)) {
        state = STATE_BY_KEY.get(regionText.toLowerCase().replace(/\s+/g, ' ')) ?? null;
        if (state) jurisdiction = 'STATE';
        else err('region', `Use Central or the name of a state or union territory, not "${regionText}"`);
    }

    const date = (key: LegalKey) => {
        const v = get(key);
        if (!v) return null;
        const d = parseLegalDate(v);
        if (!d) err(key, 'Use a date like 11-Nov-2026');
        return d;
    };
    const notificationDate = date('notificationDate');
    const effectiveDate = date('effectiveDate');
    const publishedDate = date('publishedDate');

    const flag = (key: LegalKey) => {
        const b = yesNo(get(key));
        if (b === null) err(key, 'Use Yes or No');
        return b === true;
    };
    const complianceImpact = flag('complianceImpact');
    const isChange = flag('change');
    const isAddition = flag('addition');
    const isDeletion = flag('deletion');
    const isSchedule = flag('schedule');

    if (errors.length || !notificationDate) return { data: null, errors };
    const opt = (key: LegalKey) => (nothing(get(key)) ? null : get(key));
    return {
        data: {
            row,
            lawCategory: get('lawCategory'),
            act: get('act'),
            rule: opt('rule'),
            jurisdiction,
            state,
            ministry: opt('ministry'),
            notificationDate,
            effectiveDate,
            publishedDate: publishedDate ?? notificationDate,
            referenceNumber: opt('referenceNumber'),
            title: get('title'),
            description: get('description'),
            complianceImpact,
            isChange,
            isAddition,
            isDeletion,
            isSchedule,
            impactedCompliance: opt('impactedCompliance'),
        },
        errors,
    };
}

// The register has a few title lines above the column headings, so the heading row is searched for
export function parseLegalSheet(grid: unknown[][]) {
    const fileErrors: string[] = [];
    const warnings: string[] = [];
    const errors: RowError[] = [];
    const rows: LegalRow[] = [];

    const headerAt = grid.slice(0, 15).findIndex((r) => {
        const keys = new Set(r.map((c) => KEY_OF[normHeader(cellText(c))]));
        return keys.has('title') && keys.has('act') && keys.has('notificationDate');
    });
    if (headerAt < 0) {
        fileErrors.push('Could not find the heading row (Law Category, Act, ... Title). Download the export or the format and fill that in.');
        return { rows, errors, fileErrors, warnings, totalRows: 0 };
    }

    const columnOf = new Map<LegalKey, number>();
    grid[headerAt].forEach((h, i) => {
        const text = cellText(h);
        if (!text) return;
        const key = KEY_OF[normHeader(text)];
        if (!key) warnings.push(`The column "${text}" is not used and was ignored`);
        else if (columnOf.has(key)) fileErrors.push(`The column "${LABEL[key]}" appears twice`);
        else columnOf.set(key, i);
    });
    for (const c of LEGAL_COLUMNS) {
        if (c.required && !columnOf.has(c.key)) fileErrors.push(`The column "${c.header}" is missing`);
    }
    if (fileErrors.length) return { rows, errors, fileErrors, warnings, totalRows: 0 };

    let totalRows = 0;
    for (let i = headerAt + 1; i < grid.length; i++) {
        const values: Partial<Record<LegalKey, string>> = {};
        for (const [key, col] of columnOf) values[key] = cellText(grid[i][col]);
        if (Object.values(values).every((v) => !v)) continue;
        totalRows++;
        if (totalRows > MAX_LEGAL_ROWS) continue;
        const out = parseLegalRow(values, i + 1);
        errors.push(...out.errors);
        if (out.data) rows.push(out.data);
    }
    if (totalRows === 0) fileErrors.push('The sheet has no legal updates under the heading row');
    if (totalRows > MAX_LEGAL_ROWS) fileErrors.push(`At most ${MAX_LEGAL_ROWS} rows per upload. This file has ${totalRows}.`);
    return { rows, errors, fileErrors, warnings, totalRows };
}

// ---- Matching against the library ------------------------------------------------------------

const lower = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export const actKey = (name: string, jurisdiction: string, state: string | null) => `${lower(name)}|${jurisdiction}|${state ?? ''}`;
export const ruleKey = (actRef: string, name: string) => `${actRef}|${lower(name)}`;
// The same update uploaded twice: same Act, notification date, reference number and title
export const updateKey = (actRef: string, notificationDate: string, reference: string | null, title: string) =>
    `${actRef}|${notificationDate}|${lower(reference ?? '')}|${lower(title)}`;

export type LegalLookups = {
    categories: Map<string, string>; // lower name -> id
    acts: Map<string, { id: string; lawCategoryId: string }>; // actKey -> shared act
    rules: Map<string, string>; // ruleKey(actId, name) -> id
    existing: Set<string>; // updateKey(actId, ...)
};

// What has to be created for these rows. New Acts are referred to as "new:<actKey>" until saved.
export function planLegalImport(rows: readonly LegalRow[], lk: LegalLookups) {
    const warnings: string[] = [];
    const newCategories = new Map<string, string>(); // lower -> name as written
    const newActs = new Map<string, { name: string; jurisdiction: 'CENTRAL' | 'STATE'; state: string | null; category: string }>();
    const newRules = new Map<string, { actRef: string; name: string }>();
    const toCreate: { row: LegalRow; actRef: string; ruleRef: string | null }[] = [];
    const seen = new Set<string>();
    let duplicates = 0;
    let categoryMismatch = 0;

    for (const r of rows) {
        const cat = lower(r.lawCategory);
        if (!lk.categories.has(cat) && !newCategories.has(cat)) newCategories.set(cat, r.lawCategory.trim());

        const ak = actKey(r.act, r.jurisdiction, r.state);
        const existingAct = lk.acts.get(ak);
        let actRef: string;
        if (existingAct) {
            actRef = existingAct.id;
            const catId = lk.categories.get(cat);
            if (catId && catId !== existingAct.lawCategoryId) categoryMismatch++;
        } else {
            actRef = `new:${ak}`;
            if (!newActs.has(ak)) newActs.set(ak, { name: r.act.trim(), jurisdiction: r.jurisdiction, state: r.state, category: r.lawCategory.trim() });
        }

        let ruleRef: string | null = null;
        if (r.rule) {
            const rk = ruleKey(actRef, r.rule);
            ruleRef = lk.rules.get(rk) ?? `new:${rk}`;
            if (ruleRef.startsWith('new:') && !newRules.has(rk)) newRules.set(rk, { actRef, name: r.rule.trim() });
        }

        const uk = updateKey(actRef, r.notificationDate, r.referenceNumber, r.title);
        if (lk.existing.has(uk) || seen.has(uk)) {
            duplicates++;
            continue;
        }
        seen.add(uk);
        toCreate.push({ row: r, actRef, ruleRef });
    }

    if (duplicates) warnings.push(`${duplicates} row(s) are already in the system or repeated in the file and will be skipped`);
    if (categoryMismatch) warnings.push(`${categoryMismatch} row(s) give a different law category from their Act's own. The Act's own category is kept.`);
    if (newActs.size) warnings.push(`${newActs.size} Act(s) are not in the library yet and will be added: ${[...newActs.values()].slice(0, 5).map((a) => a.name).join('; ')}${newActs.size > 5 ? ' ...' : ''}`);
    if (newRules.size) warnings.push(`${newRules.size} Rule(s) will be added to the library`);
    if (newCategories.size) warnings.push(`New law categories will be added: ${[...newCategories.values()].join(', ')}`);
    return { toCreate, newCategories, newActs, newRules, duplicates, warnings };
}