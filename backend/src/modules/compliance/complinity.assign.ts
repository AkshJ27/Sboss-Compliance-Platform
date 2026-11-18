import type { Frequency, PeriodBasis, Role } from '@prisma/client';
import { cellText, normHeader, parseDayMonthYear } from '../library/internal.parser';
import { stateName } from '../library/complinity.parser';

// Reads Complinity's "Dashboard Data" exports as they are, and works out the assignments (schedules) and masters
// they describe. One file covers one period, so several are read together. Plain logic with no database.

export type Sheet = { name: string; grid: unknown[][] };
export type RowError = { file: string; row: number; field?: string; message: string };

type Key =
    | 'owner' | 'manager' | 'entity' | 'department' | 'location' | 'state' | 'locationType' | 'code' | 'title'
    | 'vertical' | 'dueDate' | 'periodicity' | 'assignmentId';

const KEY_OF: Record<string, Key> = {
    owneremailid: 'owner',
    manageremailid: 'manager',
    entity: 'entity',
    department: 'department',
    location: 'location',
    state: 'state',
    locationtype: 'locationType',
    complianceid: 'code',
    compliance: 'title',
    vertical: 'vertical',
    duedate: 'dueDate',
    periodicity: 'periodicity',
    // Complinity calls an assignment a "compliance instance", and each due date a "schedule"
    complianceinstanceid: 'assignmentId',
};
const REQUIRED: Key[] = ['owner', 'manager', 'entity', 'location', 'code', 'dueDate', 'periodicity', 'assignmentId'];

export type Person = { name: string; email: string };

export type Assignment = {
    id: string; // Complinity's Compliance Instance ID
    code: string;
    title: string;
    owner: Person;
    manager: Person;
    entity: string;
    department: string | null;
    location: string;
    state: string; // as this app names it
    locationType: string | null;
    vertical: string | null;
    periodicity: string;
    lastDue: string; // YYYY-MM-DD, the latest due date seen
    file: string; // where the latest due date is, for messages
    row: number;
};

const clean = (v: unknown) => cellText(v).replace(/\s+/g, ' ').trim();

// "Amita Govekar - [hr13@sboss.net.in]"
export function parsePerson(text: string): Person | null {
    const m = /^(.*?)\s*-?\s*\[\s*([^\]\s]+@[^\]\s]+)\s*\]\s*$/.exec(text.trim());
    if (m) return { name: m[1].trim(), email: m[2].toLowerCase() };
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim()) ? { name: '', email: text.trim().toLowerCase() } : null;
}

export function readDashboardData(sheets: readonly Sheet[]) {
    const fileErrors: string[] = [];
    const errors: RowError[] = [];
    const byId = new Map<string, Assignment>();
    let rows = 0;
    let maxDue = '';
    // The due dates each file spans. The one reaching furthest ahead lists every assignment still in use.
    const spans: { from: string; to: string }[] = [];

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

        const span = { from: '9999-12-31', to: '' };
        spans.push(span);
        for (let i = headerAt + 1; i < sheet.grid.length; i++) {
            const line = sheet.grid[i];
            const get = (k: Key) => {
                const col = columnOf.get(k);
                return col === undefined ? '' : clean(line[col]);
            };
            const id = get('assignmentId').replace(/\.0+$/, '');
            if (!id && !get('code')) continue;
            rows++;
            const row = i + 1;
            const bad = (field: string, message: string) => errors.push({ file: sheet.name, row, field, message });

            const owner = parsePerson(get('owner'));
            const manager = parsePerson(get('manager'));
            const due = parseDayMonthYear(get('dueDate'));
            const stateText = get('state') || get('location');
            const state = stateName(stateText);
            if (!id) bad('Compliance Instance ID', 'Missing');
            if (!owner) bad('Owner[Email Id]', `No email in "${get('owner')}"`);
            if (!manager) bad('Manager[Email Id]', `No email in "${get('manager')}"`);
            if (!due) bad('Due Date', `Not a date: "${get('dueDate')}"`);
            if (!state) bad('State', `Unknown state "${stateText}"`);
            if (!id || !owner || !manager || !due || !state) continue;
            if (due > maxDue) maxDue = due;
            if (due < span.from) span.from = due;
            if (due > span.to) span.to = due;

            // The latest due date decides who does it now, and where
            const seen = byId.get(id);
            if (seen && seen.lastDue > due) continue;
            byId.set(id, {
                id,
                code: get('code').replace(/\.0+$/, '').toUpperCase(),
                title: get('title'),
                owner,
                manager,
                entity: get('entity'),
                department: get('department') || null,
                location: get('location'),
                state,
                locationType: get('locationType') || null,
                vertical: get('vertical') || null,
                periodicity: get('periodicity'),
                lastDue: due,
                file: sheet.name,
                row,
            });
        }
    }
    if (rows === 0 && fileErrors.length === 0) fileErrors.push('The files have no rows under the heading');
    const latest = spans.filter((s) => s.to).sort((a, b) => b.to.localeCompare(a.to))[0] ?? { from: maxDue, to: maxDue };
    return { assignments: [...byId.values()], errors, fileErrors, rows, maxDue, latest };
}

// ---- Still in use? -----------------------------------------------------------------

const PERIOD_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12, annual: 12 };

const plusMonths = (date: string, months: number) => {
    const [y, m, d] = date.split('-').map(Number);
    const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
};

/**
 * Complinity creates the due dates of an assignment ahead of time until it is stopped, so the file that reaches
 * furthest ahead lists every assignment still in use. An assignment is stopped when its next due date should be in
 * that file but is not. Files only cover their own periods, so an annual item due in a month no file covers is kept.
 * Event based ones have no calendar, so they are kept.
 */
export function stillInUse(a: Pick<Assignment, 'periodicity' | 'lastDue'>, latest: { from: string; to: string }): boolean {
    const months = PERIOD_MONTHS[a.periodicity.toLowerCase().replace(/[^a-z]/g, '')];
    if (!months) return true;
    for (let k = 1; ; k++) {
        const next = plusMonths(a.lastDue, k * months);
        if (next > latest.to) return true;
        if (next >= latest.from) return false;
    }
}

// ---- Matching against the company --------------------------------------------------

export type Named = { id: string; name: string };
export type ExistingLocation = { id: string; entityId: string; name: string };
export type UserRef = { id: string; email: string; name: string; isActive: boolean; role: Role; defaultApproverId: string | null };
export type ComplianceRef = {
    id: string;
    code: string;
    isActive: boolean;
    jurisdiction: string;
    actState: string | null;
    version: number;
    frequency: Frequency;
    periodBasis: PeriodBasis;
    dueDay: number | null;
    dueMonthOffset: number;
    event: string | null;
    dueDaysAfterEvent: number | null;
};
export type ExistingSchedule = {
    id: string;
    locationId: string;
    complianceId: string;
    ownerId: string;
    managerId: string;
    approverId: string | null;
    departmentId: string | null;
    verticalId: string | null;
    isActive: boolean;
};

export type Lookups = {
    entities: (Named & { code: string })[];
    departments: Named[];
    verticals: Named[];
    locationTypes: Named[];
    locations: ExistingLocation[];
    users: UserRef[];
    compliances: Map<string, ComplianceRef>; // by code
    schedules: ExistingSchedule[];
};

export type NewLocation = { entity: string; name: string; state: string; locationType: string | null };

export type PlannedSchedule = {
    assignmentId: string;
    compliance: ComplianceRef;
    entity: string; // names: the masters may be new, so ids are looked up when saving
    location: { entity: string; name: string };
    department: string | null;
    vertical: string | null;
    ownerId: string;
    managerId: string;
    approverId: string | null;
    isActive: boolean;
    existingId: string | null;
    changes: string[];
};

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// "State Bank Operation Support Services Private Limited" -> SBOSSPL, "SBOSS Contractors" -> SBOSSC
export function entityCode(name: string, taken: ReadonlySet<string>): string {
    const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    let code = words.map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w[0].toUpperCase())).join('').slice(0, 10);
    if (code.length < 2) code = (code + 'XX').slice(0, 2);
    let out = code;
    for (let n = 2; taken.has(out); n++) out = `${code.slice(0, 10 - String(n).length)}${n}`;
    return out;
}

/**
 * A company that hires several vendors in the same state gets one location per vendor there ("Quess - Karnataka"),
 * because this app allows one assignment of a compliance per location. Entities with a single vertical keep the
 * plain location name.
 */
export function locationNameFor(a: Pick<Assignment, 'location' | 'vertical'>, entityHasManyVerticals: boolean): string {
    return entityHasManyVerticals && a.vertical ? `${a.vertical} - ${a.location}` : a.location;
}

export function planComplinityAssignments(
    assignments: readonly Assignment[],
    latest: { from: string; to: string },
    lk: Lookups,
    // History files only add the old assignments that are missing here, and always as stopped
    opts: { pastOnly?: boolean } = {},
) {
    const errors: RowError[] = [];
    const warnings: string[] = [];
    const fail = (a: Assignment, field: string, message: string) => errors.push({ file: a.file, row: a.row, field, message });
    const where = (a: Assignment) => `${a.file} row ${a.row}`;

    // Masters: find by name, or plan to add
    const entityByKey = new Map(lk.entities.map((e) => [key(e.name), e]));
    const takenCodes = new Set(lk.entities.map((e) => e.code));
    const newEntities: { name: string; code: string }[] = [];
    const newNamed = (list: Named[]) => {
        const have = new Set(list.map((n) => key(n.name)));
        const add: string[] = [];
        return {
            add,
            use(name: string | null) {
                if (name && !have.has(key(name))) {
                    have.add(key(name));
                    add.push(name);
                }
            },
        };
    };
    const departments = newNamed(lk.departments);
    const verticals = newNamed(lk.verticals);
    const locationTypes = newNamed(lk.locationTypes);

    const verticalsOf = new Map<string, Set<string>>();
    for (const a of assignments) {
        if (!verticalsOf.has(key(a.entity))) verticalsOf.set(key(a.entity), new Set());
        if (a.vertical) verticalsOf.get(key(a.entity))?.add(key(a.vertical));
    }

    const existingLocation = new Map<string, string>(); // entity name key | location name key -> id
    const entityNameOfId = new Map(lk.entities.map((e) => [e.id, key(e.name)]));
    for (const l of lk.locations) {
        const en = entityNameOfId.get(l.entityId);
        if (en) existingLocation.set(`${en}|${key(l.name)}`, l.id);
    }
    const newLocations = new Map<string, NewLocation>();

    const userByEmail = new Map(lk.users.map((u) => [u.email.toLowerCase(), u]));
    const userById = new Map(lk.users.map((u) => [u.id, u]));
    const scheduleAt = new Map(lk.schedules.map((s) => [`${s.locationId}|${s.complianceId}`, s]));
    const plannedAt = new Map<string, string>(); // location key | compliance id -> assignment id
    const missingUsers = new Map<string, number>();
    const missingCodes = new Map<string, number>();

    const planned: PlannedSchedule[] = [];
    let stopped = 0;
    let libraryInactive = 0;
    const otherState = new Set<string>();

    for (const a of assignments) {
        if (!a.entity || !a.location) {
            fail(a, 'Entity', 'Entity and Location are needed');
            continue;
        }
        const c = lk.compliances.get(a.code);
        if (!c) {
            missingCodes.set(a.code, (missingCodes.get(a.code) ?? 0) + 1);
            continue;
        }

        const owner = userByEmail.get(a.owner.email);
        const manager = userByEmail.get(a.manager.email);
        if (!owner) missingUsers.set(a.owner.email, (missingUsers.get(a.owner.email) ?? 0) + 1);
        if (!manager) missingUsers.set(a.manager.email, (missingUsers.get(a.manager.email) ?? 0) + 1);
        if (!owner || !manager) continue;

        let isActive = opts.pastOnly ? false : stillInUse(a, latest);
        if (!isActive && !opts.pastOnly) stopped++;
        if (isActive && !c.isActive) {
            libraryInactive++;
            isActive = false;
        }
        if (owner.id === manager.id) {
            fail(a, 'Manager[Email Id]', `${a.owner.email} is both owner and manager of ${a.code}`);
            continue;
        }
        if (isActive) {
            const unusable = [owner, manager].find((u) => !u.isActive || u.role === 'VIEWER');
            if (unusable) {
                fail(a, unusable === owner ? 'Owner[Email Id]' : 'Manager[Email Id]', `${unusable.email} is ${unusable.isActive ? 'a viewer' : 'inactive'}, so cannot work on ${a.code}`);
                continue;
            }
        }
        // Kept as Complinity has it: some state rules apply elsewhere too, such as Tamil Nadu's in Puducherry
        if (c.jurisdiction === 'STATE' && c.actState !== a.state) otherState.add(`${c.actState} law in ${a.state}`);

        // The owner's default approver, when they can approve and are not already on the item
        const d = owner.defaultApproverId ? userById.get(owner.defaultApproverId) : undefined;
        const approverId = d && d.isActive && d.role !== 'VIEWER' && d.id !== owner.id && d.id !== manager.id ? d.id : null;

        if (!entityByKey.has(key(a.entity))) {
            const code = entityCode(a.entity, takenCodes);
            takenCodes.add(code);
            const e = { id: '', name: a.entity, code };
            entityByKey.set(key(a.entity), e);
            newEntities.push({ name: a.entity, code });
        }
        departments.use(a.department);
        verticals.use(a.vertical);
        locationTypes.use(a.locationType);

        const locName = locationNameFor(a, (verticalsOf.get(key(a.entity))?.size ?? 0) > 1);
        const locKey = `${key(a.entity)}|${key(locName)}`;
        const locationId = existingLocation.get(locKey) ?? null;
        if (!locationId && !newLocations.has(locKey)) {
            newLocations.set(locKey, { entity: a.entity, name: locName, state: a.state, locationType: a.locationType });
        }

        const at = `${locKey}|${c.id}`;
        if (plannedAt.has(at)) {
            warnings.push(`${where(a)}: ${a.code} at ${locName} is already in the files (assignment ${plannedAt.get(at)}), so this one was skipped`);
            continue;
        }
        plannedAt.set(at, a.id);

        const existing = locationId ? scheduleAt.get(`${locationId}|${c.id}`) : undefined;
        const changes: string[] = [];
        if (existing) {
            if (existing.ownerId !== owner.id) changes.push('owner');
            if (existing.managerId !== manager.id) changes.push('manager');
            if (approverId && existing.approverId !== approverId) changes.push('approver');
            if (existing.isActive !== isActive) changes.push(isActive ? 'activated' : 'stopped');
        }
        planned.push({
            assignmentId: a.id,
            compliance: c,
            entity: a.entity,
            location: { entity: a.entity, name: locName },
            department: a.department,
            vertical: a.vertical,
            ownerId: owner.id,
            managerId: manager.id,
            // A re-upload never removes an approver someone added here
            approverId: approverId ?? existing?.approverId ?? null,
            isActive,
            existingId: existing?.id ?? null,
            changes,
        });
    }

    for (const [email, n] of missingUsers) {
        errors.push({ file: 'Users', row: 0, field: 'Owner/Manager', message: `${email} (${n} assignment(s)) is not a user. Add them with the users upload first.` });
    }
    for (const [code, n] of missingCodes) {
        errors.push({ file: 'Library', row: 0, field: 'Compliance ID', message: `Compliance ID ${code} (${n} assignment(s)) is not in the library. Import Complinity's compliance details first.` });
    }
    if (stopped) warnings.push(`${stopped} assignment(s) have no due date between ${latest.from} and ${latest.to} where one was expected, so Complinity has stopped them. They are added as inactive.`);
    if (otherState.size) warnings.push(`Some assignments use another state's law, as in Complinity: ${[...otherState].join('; ')}.`);
    if (libraryInactive) warnings.push(`${libraryInactive} assignment(s) are for compliances that are inactive in the library, so they are added as inactive.`);

    return {
        planned,
        errors,
        warnings,
        masters: {
            entities: newEntities,
            departments: departments.add,
            verticals: verticals.add,
            locationTypes: locationTypes.add,
            locations: [...newLocations.values()],
        },
    };
}