import type { InstanceStatus, SubmissionType } from '@prisma/client';
import { cellText, normHeader, parseDayMonthYear } from '../library/internal.parser';
import { locationNameFor, parsePerson } from './complinity.assign';
import type { RowError, Sheet } from './complinity.assign';

// Reads the past due items in Complinity's "Dashboard Data" export (every status, any period) and works out
// the items to add here, with their status, done date and remarks. Plain logic with no database.

type Key =
    | 'status' | 'owner' | 'manager' | 'entity' | 'location' | 'vertical' | 'code' | 'assignmentId' | 'dueDate'
    | 'periodStart' | 'periodEnd' | 'doneDate' | 'enteredDate' | 'refNo' | 'challanNo' | 'remarks' | 'submittedBy' | 'approvedBy';

const KEY_OF: Record<string, Key> = {
    status: 'status',
    owneremailid: 'owner',
    manageremailid: 'manager',
    entity: 'entity',
    location: 'location',
    vertical: 'vertical',
    complianceid: 'code',
    complianceinstanceid: 'assignmentId',
    duedate: 'dueDate',
    periodstartdate: 'periodStart',
    periodenddate: 'periodEnd',
    donedate: 'doneDate',
    entereddate: 'enteredDate',
    refno: 'refNo',
    challanno: 'challanNo',
    remarks: 'remarks',
    submittedby: 'submittedBy',
    approvedby: 'approvedBy',
};
const REQUIRED: Key[] = ['status', 'owner', 'manager', 'entity', 'location', 'code', 'assignmentId', 'dueDate'];

export type HistoryRow = {
    file: string;
    row: number;
    assignmentId: string;
    code: string;
    entity: string;
    location: string;
    vertical: string | null;
    ownerEmail: string;
    managerEmail: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    status: InstanceStatus;
    submissionType: SubmissionType | null;
    isWip: boolean;
    doneDate: string | null;
    submittedAt: string | null; // ISO date and time
    closedAt: string | null;
    submittedBy: string | null; // a name, as Complinity writes it
    approvedBy: string | null;
    refNo: string | null;
    challanNo: string | null;
    remarks: string | null;
};

// Complinity's statuses, as this app stores them. The dashboard works out on time or late from the dates.
export function statusOf(text: string): { status: InstanceStatus; submissionType: SubmissionType | null; isWip: boolean } | null {
    const s = text.toLowerCase().replace(/without proof/g, '').replace(/[^a-z]/g, '');
    if (s === 'ontime' || s === 'lateclosure' || s === 'closed' || s === 'complied') return { status: 'CLOSED', submissionType: 'APPLICABLE', isWip: false };
    if (s === 'notapplicable') return { status: 'NOT_APPLICABLE', submissionType: 'NOT_APPLICABLE', isWip: false };
    if (s === 'pendingapproval') return { status: 'SUBMITTED', submissionType: 'APPLICABLE', isWip: false };
    if (s === 'noncompliance' || s === 'due') return { status: 'DUE', submissionType: null, isWip: false };
    if (s === 'noncomplianceworkinprogress' || s === 'dueworkinprogress') return { status: 'DUE', submissionType: null, isWip: true };
    return null;
}

const MONTH: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * The remarks hold Complinity's trail, one line per step:
 * "02-Jan-2026 17:26:43::Akshay Chikodikar ( SUBMITTED as Applicable )::complied"
 * The first submission and the last approval give the times. Times are India time.
 */
export function trailTimes(remarks: string): { submittedAt: string | null; closedAt: string | null } {
    let submittedAt: string | null = null;
    let closedAt: string | null = null;
    for (const line of remarks.split(/\r?\n/)) {
        const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})::[^:]*\(\s*([A-Za-z ]+?)\s*[)a-z]/.exec(line.trim());
        if (!m) continue;
        const month = MONTH[m[2].toLowerCase()];
        if (month === undefined) continue;
        // India is UTC+5:30
        const at = new Date(Date.UTC(+m[3], month, +m[1], +m[4], +m[5], +m[6]) - 330 * 60_000).toISOString();
        const action = m[7].toUpperCase();
        if (action.startsWith('SUBMITTED') && !submittedAt) submittedAt = at;
        if (action.startsWith('APPROVED')) closedAt = at;
    }
    return { submittedAt, closedAt };
}

const clean = (v: unknown) => cellText(v).replace(/[ \t]+/g, ' ').trim();
const orNull = (s: string) => (s === '' || /^(na|n\/a|nil|-|0)$/i.test(s) ? null : s);
const personName = (s: string) => orNull(s.replace(/\s*\([^)]*\)\s*$/, '').trim()); // "Ravi Jadhav (Owner)"

export function readHistory(sheets: readonly Sheet[]) {
    const fileErrors: string[] = [];
    const errors: RowError[] = [];
    const rows: HistoryRow[] = [];

    for (const sheet of sheets) {
        const headerAt = sheet.grid.slice(0, 15).findIndex((r) => r.some((c) => KEY_OF[normHeader(cellText(c))] === 'assignmentId'));
        if (headerAt < 0) {
            fileErrors.push(`${sheet.name}: no "Compliance Instance ID" column. Upload Complinity's Dashboard Data export.`);
            continue;
        }
        const columnOf = new Map<Key, number>();
        sheet.grid[headerAt].forEach((h, i) => {
            const k = KEY_OF[normHeader(cellText(h))];
            if (k && !columnOf.has(k)) columnOf.set(k, i);
        });
        const missing = REQUIRED.filter((k) => !columnOf.has(k));
        if (missing.length) {
            fileErrors.push(`${sheet.name}: missing columns ${missing.join(', ')}`);
            continue;
        }

        for (let i = headerAt + 1; i < sheet.grid.length; i++) {
            const line = sheet.grid[i];
            const get = (k: Key) => {
                const col = columnOf.get(k);
                return col === undefined ? '' : clean(line[col]);
            };
            const assignmentId = get('assignmentId').replace(/\.0+$/, '');
            if (!assignmentId && !get('code')) continue;
            const row = i + 1;
            const bad = (field: string, message: string) => errors.push({ file: sheet.name, row, field, message });

            const st = statusOf(get('status'));
            const owner = parsePerson(get('owner'));
            const manager = parsePerson(get('manager'));
            const dueDate = parseDayMonthYear(get('dueDate'));
            const doneText = get('doneDate');
            const doneDate = doneText ? parseDayMonthYear(doneText) : null;
            // Event based items have no period: the due date stands for it
            const periodStart = (get('periodStart') && parseDayMonthYear(get('periodStart'))) || dueDate;
            const periodEnd = (get('periodEnd') && parseDayMonthYear(get('periodEnd'))) || periodStart;
            if (!st) bad('Status', `Unknown status "${get('status')}"`);
            if (!owner) bad('Owner[Email Id]', `No email in "${get('owner')}"`);
            if (!manager) bad('Manager[Email Id]', `No email in "${get('manager')}"`);
            if (!dueDate) bad('Due Date', `Not a date: "${get('dueDate')}"`);
            if (doneText && !doneDate) bad('Done Date', `Not a date: "${doneText}"`);
            if (!st || !owner || !manager || !dueDate || !periodStart || !periodEnd || (doneText && !doneDate)) continue;

            const remarks = cellText(line[columnOf.get('remarks') ?? -1]).trim();
            const times = trailTimes(remarks);
            rows.push({
                file: sheet.name,
                row,
                assignmentId,
                code: get('code').replace(/\.0+$/, '').toUpperCase(),
                entity: get('entity'),
                location: get('location'),
                vertical: get('vertical') || null,
                ownerEmail: owner.email,
                managerEmail: manager.email,
                periodStart,
                periodEnd,
                dueDate,
                ...st,
                doneDate,
                submittedAt: times.submittedAt,
                closedAt: st.status === 'CLOSED' || st.status === 'NOT_APPLICABLE' ? times.closedAt : null,
                submittedBy: personName(get('submittedBy')),
                approvedBy: personName(get('approvedBy')),
                refNo: orNull(get('refNo'))?.slice(0, 200) ?? null,
                challanNo: orNull(get('challanNo'))?.slice(0, 200) ?? null,
                remarks: remarks ? remarks.slice(0, 5000) : null,
            });
        }
    }
    if (!rows.length && !fileErrors.length && !errors.length) fileErrors.push('The files have no rows under the heading');
    return { rows, errors, fileErrors };
}

// ---- Matching against what is here --------------------------------------------------

export type ScheduleRef = {
    id: string;
    complianceId: string;
    entityId: string;
    locationId: string;
    departmentId: string | null;
    verticalId: string | null;
    approverId: string | null;
    highRisk: boolean;
};
export type ExistingInstance = { id: string; status: InstanceStatus; touched: boolean };
export type HistoryLookups = {
    // entity name | location name | compliance code, all lower case -> the assignment here
    scheduleAt: Map<string, ScheduleRef>;
    userByEmail: Map<string, string>;
    userByName: Map<string, string>;
    instances: Map<string, ExistingInstance>; // schedule id | period start
};

export type PlannedItem = { row: HistoryRow; schedule: ScheduleRef; ownerId: string; managerId: string; submittedById: string | null; approvedById: string | null; existingId: string | null };

const lower = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export const scheduleKey = (entity: string, location: string, code: string) => `${lower(entity)}|${lower(location)}|${code.toUpperCase()}`;

export function planHistory(rows: readonly HistoryRow[], lk: HistoryLookups) {
    const errors: RowError[] = [];
    const warnings: string[] = [];

    const create: PlannedItem[] = [];
    const update: PlannedItem[] = [];
    const seen = new Set<string>();
    let alreadyWorked = 0;
    let repeated = 0;
    const noAssignment = new Map<string, number>();
    const missingUsers = new Map<string, number>();

    for (const r of rows) {
        // The assignments upload names a vendor's location "Quess - Karnataka", or just "New Delhi" where an entity has one vertical
        const locName = locationNameFor(r, true);
        const schedule = lk.scheduleAt.get(scheduleKey(r.entity, locName, r.code)) ?? lk.scheduleAt.get(scheduleKey(r.entity, r.location, r.code));
        if (!schedule) {
            const k = `${r.code} at ${locName}`;
            noAssignment.set(k, (noAssignment.get(k) ?? 0) + 1);
            continue;
        }
        const ownerId = lk.userByEmail.get(r.ownerEmail);
        const managerId = lk.userByEmail.get(r.managerEmail);
        if (!ownerId) missingUsers.set(r.ownerEmail, (missingUsers.get(r.ownerEmail) ?? 0) + 1);
        if (!managerId) missingUsers.set(r.managerEmail, (missingUsers.get(r.managerEmail) ?? 0) + 1);
        if (!ownerId || !managerId) continue;

        const at = `${schedule.id}|${r.periodStart}`;
        if (seen.has(at)) {
            repeated++;
            continue;
        }
        seen.add(at);

        const byName = (n: string | null) => (n ? (lk.userByName.get(lower(n)) ?? null) : null);
        const item: PlannedItem = {
            row: r,
            schedule,
            ownerId,
            managerId,
            submittedById: byName(r.submittedBy) ?? (r.submittedAt ? ownerId : null),
            approvedById: byName(r.approvedBy),
            existingId: null,
        };
        const existing = lk.instances.get(at);
        if (!existing) create.push(item);
        else if (existing.touched) alreadyWorked++; // someone already worked on it here: their work stands
        else update.push({ ...item, existingId: existing.id });
    }

    for (const [email, n] of missingUsers) {
        errors.push({ file: 'Users', row: 0, field: 'Owner/Manager', message: `${email} (${n} item(s)) is not a user. Add them with the users upload first.` });
    }
    if (noAssignment.size) {
        const total = [...noAssignment.values()].reduce((a, b) => a + b, 0);
        errors.push({
            file: 'Assignments',
            row: 0,
            field: 'Compliance ID',
            message: `${total} item(s) have no assignment here, such as ${[...noAssignment.keys()].slice(0, 5).join('; ')}. Upload the assignments from Complinity first.`,
        });
    }
    if (repeated) warnings.push(`${repeated} row(s) repeat a period already in the files, so they were skipped.`);
    if (alreadyWorked) warnings.push(`${alreadyWorked} item(s) have already been worked on here, so they were left as they are.`);
    return { create, update, errors, warnings };
}