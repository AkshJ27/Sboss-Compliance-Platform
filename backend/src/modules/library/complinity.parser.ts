import type { Frequency } from '@prisma/client';
import { INDIAN_STATES } from '../../lib/india';
import type { ComplianceInput, ParsedRow, RowError } from './import.parser';
import { cellText, normHeader } from './internal.parser';

// Reads Complinity's "Unique Compliance Details" export as it is: its sheets of mapped, unmapped and
// inactivated compliances become the shared statutory library. Plain logic with no database, so it is easy to test.

export type Sheet = { name: string; grid: unknown[][] };

type Key =
    | 'act' | 'section' | 'rule' | 'ruleNo' | 'title' | 'description' | 'applicability' | 'form' | 'periodicity'
    | 'onDate' | 'startEnd' | 'yearBasis' | 'finDueDay' | 'event' | 'attachment' | 'proof' | 'penalty' | 'risk'
    | 'imprisonment' | 'authority' | 'lawCategory' | 'nature' | 'statutory' | 'alertOwner' | 'alertManager'
    | 'code' | 'state' | 'active';

const KEY_OF: Record<string, Key> = {
    actname: 'act',
    sectionno: 'section',
    rulename: 'rule',
    ruleno: 'ruleNo',
    compliancename: 'title',
    compliancedescription: 'description',
    description: 'description',
    applicability: 'applicability',
    formno: 'form',
    periodicity: 'periodicity',
    ondate: 'onDate',
    startendperiod: 'startEnd',
    financialcalendaryear: 'yearBasis',
    findueday: 'finDueDay',
    eventname: 'event',
    attachment: 'attachment',
    proofofcompliance: 'proof',
    penalty: 'penalty',
    risk: 'risk',
    imprisonment: 'imprisonment',
    statutoryauthority: 'authority',
    lawcategory: 'lawCategory',
    compliancenature: 'nature',
    statutoryinternal: 'statutory',
    alertowner: 'alertOwner',
    alertmanager: 'alertManager',
    complianceid: 'code',
    statename: 'state',
    activestatus: 'active',
};
const REQUIRED: Key[] = ['code', 'act', 'title', 'periodicity', 'onDate', 'state'];

export type LibraryRow = ParsedRow & { sheet: string; mapped: boolean };

// ---- Text clean-up ---------------------------------------------------------------

// Complinity's export has some text saved twice-encoded ("crÃ¨che" for "crèche"). Undo that when it is clearly the case.
const CP1252: Record<string, number> = {
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
    '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
    '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
export function repairText(s: string): string {
    if (!/[ÃÂâ][\u0080-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(s)) return s;
    const bytes: number[] = [];
    for (const ch of s) {
        const c = ch.codePointAt(0) as number;
        if (c < 0x100) bytes.push(c);
        else if (CP1252[ch] !== undefined) bytes.push(CP1252[ch]);
        else return s; // not twice-encoded text after all
    }
    const fixed = Buffer.from(bytes).toString('utf8');
    return fixed.includes('\uFFFD') ? s : fixed;
}

const clean = (v: unknown) => repairText(cellText(v)).replace(/\r\n/g, '\n').trim();
const orNull = (s: string) => (s === '' || /^(na|n\/a|nil|-)$/i.test(s) ? null : s);

const stateKey = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const STATE_OF = new Map<string, string>(INDIAN_STATES.map((s) => [stateKey(s), s]));
for (const [alias, name] of [
    ['orissa', 'Odisha'],
    ['pondicherry', 'Puducherry'],
    ['nctofdelhi', 'Delhi'],
    ['newdelhi', 'Delhi'],
    ['damananddiu', 'Dadra and Nagar Haveli and Daman and Diu'],
    ['dadraandnagarhaveli', 'Dadra and Nagar Haveli and Daman and Diu'],
] as const) {
    STATE_OF.set(alias, name);
}
// Complinity's way of writing a state or union territory, as this app names it. Null when it is not one.
export const stateName = (text: string): string | null => STATE_OF.get(stateKey(text)) ?? null;

// ---- Due dates -------------------------------------------------------------------

const PERIODICITY: Record<string, Frequency> = {
    M: 'MONTHLY', Q: 'QUARTERLY', H: 'HALF_YEARLY', A: 'ANNUAL', O: 'ONE_TIME', E: 'EVENT_BASED',
    V: 'EVENT_BASED', // "variable": renewals before expiry and record keeping. They start from a date set when triggered.
};
const LENGTH: Partial<Record<Frequency, number>> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12 };

export type DueRule = Pick<ComplianceInput, 'frequency' | 'dueDay' | 'dueMonthOffset' | 'event' | 'dueDaysAfterEvent'>;

const DAY = 86_400_000;
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * Complinity counts "On Date" in days: from the end of the period (E) or from its start (S).
 * Annual, calendar year, E 46 is 46 days after 31 December: 15 February.
 * Annual, financial year, E 275 is 31 December. Monthly, E 7 is the 7th of the next month.
 * This app stores a day of the month plus months from the last month of the period, so the days are
 * converted using the first period of a typical year. A due date at the end of a month stays at the end of the month.
 */
export function complinityDueRule(
    periodicity: Frequency,
    onDate: number,
    fromStart: boolean,
    financialYear: boolean,
    event: string | null,
): DueRule {
    if (periodicity === 'EVENT_BASED') {
        return { frequency: periodicity, dueDay: undefined, dueMonthOffset: 0, event: event ?? undefined, dueDaysAfterEvent: onDate };
    }
    const len = LENGTH[periodicity] ?? 1;
    const firstMonth = financialYear && periodicity !== 'MONTHLY' ? 3 : 0; // April or January, 2025
    const lastMonth = periodicity === 'ONE_TIME' ? firstMonth : firstMonth + len - 1;
    const from = fromStart || periodicity === 'ONE_TIME' ? Date.UTC(2025, firstMonth, 1) : Date.UTC(2025, lastMonth, lastDayOf(2025, lastMonth));
    const due = new Date(from + onDate * DAY);
    const y = due.getUTCFullYear();
    const m = due.getUTCMonth();
    const d = due.getUTCDate();
    const offset = (y - 2025) * 12 + m - lastMonth;
    return {
        frequency: periodicity,
        dueDay: d === lastDayOf(y, m) && d >= 28 ? 31 : d,
        dueMonthOffset: offset,
        event: undefined,
        dueDaysAfterEvent: undefined,
    };
}

// ---- Sheets ----------------------------------------------------------------------

const YES = (s: string) => /^(y|yes|true|1)$/i.test(s);

export function parseComplinityLibrary(sheets: readonly Sheet[]) {
    const rows: LibraryRow[] = [];
    const errors: (RowError & { sheet: string })[] = [];
    const warnings: string[] = [];
    const fileErrors: string[] = [];
    const seen = new Map<string, string>(); // code -> where it was first seen
    const internal: string[] = [];
    const yearEnd: string[] = [];
    let totalRows = 0;
    let sheetsRead = 0;

    for (const sheet of sheets) {
        const headerAt = sheet.grid.slice(0, 10).findIndex((r) => r.some((c) => KEY_OF[normHeader(cellText(c))] === 'code'));
        if (headerAt < 0) continue;
        const columnOf = new Map<Key, number>();
        sheet.grid[headerAt].forEach((h, i) => {
            const k = KEY_OF[normHeader(cellText(h))];
            if (k && !columnOf.has(k)) columnOf.set(k, i);
        });
        const missing = REQUIRED.filter((k) => !columnOf.has(k));
        if (missing.length) {
            fileErrors.push(`Sheet "${sheet.name}" is missing: ${missing.join(', ')}`);
            continue;
        }
        sheetsRead++;
        const mapped = /^mapped/i.test(sheet.name.trim());

        for (let i = headerAt + 1; i < sheet.grid.length; i++) {
            const line = sheet.grid[i];
            const get = (k: Key) => {
                const col = columnOf.get(k);
                return col === undefined ? '' : clean(line[col]);
            };
            if (!get('code') && !get('title')) continue;
            totalRows++;
            const row = i + 1;
            const bad: (RowError & { sheet: string })[] = [];
            const fail = (field: string, message: string) => bad.push({ sheet: sheet.name, row, field, message });

            const code = get('code').replace(/\.0+$/, '').toUpperCase();
            if (!code) fail('Compliance ID', 'Missing');
            const where = `${sheet.name} row ${row}`;
            if (code && seen.has(code)) {
                warnings.push(`Compliance ID ${code} is in ${seen.get(code)} and ${where}. The first one was used.`);
                continue;
            }
            if (code) seen.set(code, where);

            // The company's own items belong in the internal compliance upload, not the shared library
            if (get('statutory').toUpperCase() === 'I') {
                internal.push(code);
                continue;
            }

            const title = get('title').replace(/\s+/g, ' ');
            if (title.length < 3) fail('Compliance Name', 'Missing');
            const act = get('act').replace(/\s+/g, ' ');
            if (act.length < 2) fail('Act Name', 'Missing');
            const lawCategory = get('lawCategory');
            if (lawCategory.length < 2) fail('Law Category', 'Missing');

            const stateText = get('state');
            const central = /^(central|centre|center|all india|pan india)$/i.test(stateText);
            const state = central ? null : stateName(stateText);
            if (!central && !state) fail('State Name', `Unknown state "${stateText}"`);

            const periodicityText = get('periodicity').toUpperCase();
            const frequency = PERIODICITY[periodicityText];
            if (!frequency) fail('Periodicity', `Unknown periodicity "${periodicityText}"`);

            const onDate = Number(get('onDate'));
            // Event based items can be years away: unpaid dividends move to IEPF after 7 years
            const maxDays = frequency === 'EVENT_BASED' ? 3650 : 730;
            if (!Number.isInteger(onDate) || Math.abs(onDate) > maxDays) fail('On Date', `Not a whole number of days up to ${maxDays}: "${get('onDate')}"`);

            const startEnd = get('startEnd').toUpperCase();
            if (startEnd !== 'S' && startEnd !== 'E') fail('Start/End Period', 'Use S or E');
            const yearBasis = get('yearBasis').toUpperCase();
            if (yearBasis !== 'F' && yearBasis !== 'C') fail('Financial/Calendar Year', 'Use F or C');

            const risk = ({ H: 'HIGH', M: 'MEDIUM', L: 'LOW' } as const)[get('risk').toUpperCase() as 'H' | 'M' | 'L'];
            const attachment = ({ M: 'MANDATORY', O: 'OPTIONAL', N: 'NOT_REQUIRED' } as const)[get('attachment').toUpperCase() as 'M' | 'O' | 'N'];
            const days = (k: Key) => {
                const n = Number(get(k));
                return get(k) !== '' && Number.isInteger(n) && n >= 0 && n <= 999 ? n : undefined;
            };

            if (bad.length || !frequency) {
                errors.push(...bad);
                continue;
            }

            let event = orNull(get('event'));
            if (frequency === 'EVENT_BASED' && !event) event = periodicityText === 'V' ? 'Date varies (renewal or record keeping)' : title;
            const rule = complinityDueRule(frequency, onDate, startEnd === 'S', yearBasis === 'F', event ? event.slice(0, 300) : null);

            const finDue = Number(get('finDueDay'));
            if (frequency !== 'EVENT_BASED' && Number.isInteger(finDue) && finDue !== 0 && finDue !== onDate) yearEnd.push(code);

            const section = orNull(get('section'));
            const ruleNo = orNull(get('ruleNo'));
            const reference = [section ? `Section ${section}` : null, ruleNo].filter(Boolean).join('; ');

            const data: ComplianceInput = {
                code,
                act,
                lawCategory,
                jurisdiction: central ? 'CENTRAL' : 'STATE',
                state: state ?? undefined,
                statutoryAuthority: orNull(get('authority'))?.slice(0, 200) ?? undefined,
                rule: orNull(get('rule'))?.replace(/\s+/g, ' ').slice(0, 500) ?? undefined,
                title: title.slice(0, 500),
                description: orNull(get('description')) ?? undefined,
                form: orNull(get('form'))?.slice(0, 200) ?? undefined,
                reference: reference ? reference.slice(0, 200) : undefined,
                nature: orNull(get('nature'))?.slice(0, 200) ?? undefined,
                type: undefined,
                risk: risk ?? 'MEDIUM',
                impact: undefined,
                attachment: attachment ?? 'OPTIONAL',
                periodBasis: yearBasis === 'F' ? 'FINANCIAL_YEAR' : 'CALENDAR_YEAR',
                ...rule,
                penalty: orNull(get('penalty'))?.slice(0, 2000) ?? undefined,
                imprisonment: YES(get('imprisonment')),
                isActive: get('active') === '' ? true : YES(get('active')),
                applicability: orNull(get('applicability')) ?? undefined,
                proofOfCompliance: orNull(get('proof')) ?? undefined,
                alertOwnerDays: days('alertOwner'),
                alertManagerDays: days('alertManager'),
            };
            rows.push({ row, sheet: sheet.name, mapped, data });
        }
    }

    if (sheetsRead === 0 && fileErrors.length === 0) {
        fileErrors.push('No sheet with a "Compliance ID" column was found. Upload Complinity\'s compliance details export.');
    }
    if (internal.length) {
        warnings.push(
            `${internal.length} internal compliance(s) were skipped (ID ${internal.join(', ')}). They are your company's own items, so they are added with the internal compliance upload.`,
        );
    }
    if (yearEnd.length) {
        warnings.push(
            `${yearEnd.length} item(s) have a different due date for the March period in Complinity (ID ${yearEnd.join(', ')}), such as TDS for March due on 30 April. This app uses the regular due date for every period, which is earlier.`,
        );
    }
    return { rows, errors, fileErrors, warnings, totalRows };
}