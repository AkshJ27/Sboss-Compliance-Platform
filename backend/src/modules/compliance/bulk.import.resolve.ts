import type { Frequency, PeriodBasis } from '@prisma/client';
import { peopleProblem } from './bulk.engine';
import type { PeopleProblem } from './bulk.engine';
import { FIELD_LABEL } from './bulk.import.parser';
import type { ColumnKey, RawRow, RowError } from './bulk.import.parser';

// Everything here is plain logic with no database, so it is easy to test.

export type EntityRef = { id: string; code: string; name: string; isActive: boolean };
export type LocationRef = { id: string; entityId: string; name: string; state: string; isActive: boolean };
export type ComplianceRef = {
    id: string;
    code: string;
    title: string;
    risk: string;
    isActive: boolean;
    version: number;
    frequency: Frequency;
    periodBasis: PeriodBasis;
    dueDay: number | null;
    dueMonthOffset: number;
    event: string | null;
    dueDaysAfterEvent: number | null;
    actName: string;
    actState: string | null;
    jurisdiction: string;
    actActive: boolean;
};
export type UserRef = { id: string; name: string; isActive: boolean; role: string };
export type NamedRef = { id: string; isActive: boolean };

export type Lookups = {
    entities: readonly EntityRef[];
    locations: readonly LocationRef[];
    compliances: ReadonlyMap<string, ComplianceRef>; // key: upper-case code
    users: ReadonlyMap<string, UserRef>; // key: lower-case email
    departments: ReadonlyMap<string, NamedRef>; // key: lowerKey(name)
    verticals: ReadonlyMap<string, NamedRef>;
};

export type ResolvedRow = {
    row: number;
    entityId: string;
    locationId: string;
    locationLabel: string;
    compliance: ComplianceRef;
    ownerId: string;
    ownerName: string;
    managerId: string;
    managerName: string;
    approverId: string | null;
    departmentId: string | null;
    verticalId: string | null;
    startDate: string;
};

// "Human  Resources" and "human resources" are the same name
export const lowerKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export const existingKey = (locationId: string, complianceId: string) => `${locationId}|${complianceId}`;

// An entity is found by its code first, then by its name
export function entityFinder(entities: readonly EntityRef[]) {
    const byCode = new Map<string, EntityRef>();
    const byName = new Map<string, EntityRef>();
    for (const e of entities) {
        byCode.set(e.code.trim().toLowerCase(), e);
        byName.set(lowerKey(e.name), e);
    }
    return (text: string): EntityRef | undefined => byCode.get(text.trim().toLowerCase()) ?? byName.get(lowerKey(text));
}

const PEOPLE_ERROR: Record<PeopleProblem, { key: ColumnKey; message: string }> = {
    SAME_OWNER_MANAGER: { key: 'manager', message: 'Owner and manager must be different people' },
    APPROVER_NOT_DISTINCT: {
        key: 'approver',
        message: 'The approver must be a different person from the owner and manager',
    },
    HIGH_RISK_NO_APPROVER: { key: 'approver', message: 'This is a high-risk compliance, so it needs an approver' },
};

export function resolveRows(rows: readonly RawRow[], lk: Lookups, defaultStart: string | null) {
    const findEntity = entityFinder(lk.entities);
    const locations = new Map<string, LocationRef>();
    for (const l of lk.locations) locations.set(`${l.entityId}|${lowerKey(l.name)}`, l);

    const seen = new Map<string, number>();
    const resolved: ResolvedRow[] = [];
    const errors: RowError[] = [];

    for (const r of rows) {
        const bad: RowError[] = [];
        const fail = (key: ColumnKey, message: string) => {
            bad.push({ row: r.row, field: FIELD_LABEL[key], message });
        };

        const entity = findEntity(r.entity);
        if (!entity) fail('entity', `No entity with the code or name "${r.entity}"`);
        else if (!entity.isActive) fail('entity', 'This entity is inactive');

        let loc: LocationRef | undefined;
        if (entity) {
            loc = locations.get(`${entity.id}|${lowerKey(r.location)}`);
            if (!loc) fail('location', `Entity ${entity.code} has no location named "${r.location}"`);
            else if (!loc.isActive) fail('location', 'This location is inactive');
        }

        const c = lk.compliances.get(r.code);
        if (!c) {
            fail('code', `No compliance with the code "${r.code}" in the library`);
        } else if (!c.isActive || !c.actActive) {
            fail('code', 'This compliance is inactive in the library');
        } else if (loc && c.jurisdiction === 'STATE' && c.actState !== loc.state) {
            fail(
                'code',
                `${c.actName} (${c.actState ?? 'no state'}) applies only in ${c.actState ?? 'its own state'}, but this location is in ${loc.state}`,
            );
        }

        if (loc && c) {
            const key = `${loc.id}|${c.id}`;
            const first = seen.get(key);
            if (first === undefined) seen.set(key, r.row);
            else fail('code', `Duplicate of row ${first}`);
        }

        const person = (key: ColumnKey, email: string): UserRef | null => {
            const u = lk.users.get(email);
            if (!u || !u.isActive || u.role === 'VIEWER') {
                fail(key, 'No active, non-viewer user in your company has this email');
                return null;
            }
            return u;
        };
        const owner = person('owner', r.owner);
        const manager = person('manager', r.manager);
        const approver = r.approver ? person('approver', r.approver) : null;

        // Only judge the combination when every person was found, so one mistake is not reported twice
        if (owner && manager && (!r.approver || approver)) {
            const problem = peopleProblem(
                { ownerId: owner.id, managerId: manager.id, approverId: approver ? approver.id : null },
                c?.risk === 'HIGH',
            );
            if (problem) fail(PEOPLE_ERROR[problem].key, PEOPLE_ERROR[problem].message);
        }

        const named = (
            key: ColumnKey,
            text: string | null,
            map: ReadonlyMap<string, NamedRef>,
            noun: string,
        ): string | null => {
            if (text === null) return null;
            const n = map.get(lowerKey(text));
            if (!n) {
                fail(key, `No ${noun} named "${text}"`);
                return null;
            }
            if (!n.isActive) {
                fail(key, `This ${noun} is inactive`);
                return null;
            }
            return n.id;
        };
        const departmentId = named('department', r.department, lk.departments, 'department');
        const verticalId = named('vertical', r.vertical, lk.verticals, 'vertical');

        const start = r.startDate ?? defaultStart;
        if (!start) fail('startDate', 'Required. Add a start date to this row, or choose a default start date');

        if (bad.length > 0) {
            errors.push(...bad);
            continue;
        }
        if (!entity || !loc || !c || !owner || !manager || !start) continue; // cannot happen: every missing piece adds an error

        resolved.push({
            row: r.row,
            entityId: entity.id,
            locationId: loc.id,
            locationLabel: `${entity.code} / ${loc.name}`,
            compliance: c,
            ownerId: owner.id,
            ownerName: owner.name,
            managerId: manager.id,
            managerName: manager.name,
            approverId: approver ? approver.id : null,
            departmentId,
            verticalId,
            startDate: start,
        });
    }
    return { resolved, errors };
}

// `existing` maps "location|compliance" to whether that schedule is active
export function splitExisting(rows: readonly ResolvedRow[], existing: ReadonlyMap<string, boolean>) {
    const toCreate: ResolvedRow[] = [];
    let alreadyActive = 0;
    let alreadyInactive = 0;
    for (const r of rows) {
        const e = existing.get(existingKey(r.locationId, r.compliance.id));
        if (e === undefined) toCreate.push(r);
        else if (e) alreadyActive++;
        else alreadyInactive++;
    }
    return { toCreate, alreadyActive, alreadyInactive };
}