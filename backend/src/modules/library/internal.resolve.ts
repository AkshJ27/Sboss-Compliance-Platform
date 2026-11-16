import { peopleProblem } from '../compliance/bulk.engine';
import { entityFinder, lowerKey } from '../compliance/bulk.import.resolve';
import type { EntityRef, LocationRef, NamedRef, UserRef } from '../compliance/bulk.import.resolve';
import { FIELD_LABEL } from './internal.parser';
import type { InternalKey, InternalRawRow, RowError } from './internal.parser';

// Matches the names and emails in each row to records of the signed-in company.
// Everything here is plain logic with no database, so it is easy to test.

export const DEFAULT_LAW_CATEGORY = 'Internal Compliance';

export type InternalLookups = {
    entities: readonly EntityRef[];
    locations: readonly LocationRef[];
    users: ReadonlyMap<string, UserRef>; // key: lower-case email
    departments: ReadonlyMap<string, NamedRef>; // key: lowerKey(name)
    verticals: ReadonlyMap<string, NamedRef>;
    lawCategories: ReadonlyMap<string, { id: string; name: string }>; // shared, key: lowerKey(name)
    natures: ReadonlyMap<string, { id: string; name: string }>;
    // Internal compliances the company already has: "locationId|lowerKey(title)" -> code
    existing: ReadonlyMap<string, string>;
};

export type ResolvedInternalRow = {
    raw: InternalRawRow;
    entityId: string;
    locationId: string;
    locationLabel: string;
    departmentId: string;
    verticalId: string;
    ownerId: string;
    ownerName: string;
    managerId: string;
    managerName: string;
    approverId: string | null;
    lawCategoryName: string; // the name to file it under; created when it does not exist yet
    natureId: string | null;
};

export const existingTitleKey = (locationId: string, title: string) => `${locationId}|${lowerKey(title)}`;

export function resolveInternalRows(rows: readonly InternalRawRow[], lk: InternalLookups) {
    const findEntity = entityFinder(lk.entities);
    const locations = new Map<string, LocationRef>();
    for (const l of lk.locations) locations.set(`${l.entityId}|${lowerKey(l.name)}`, l);

    const seen = new Map<string, number>();
    const resolved: ResolvedInternalRow[] = [];
    const errors: RowError[] = [];

    for (const r of rows) {
        const bad: RowError[] = [];
        const fail = (key: InternalKey, message: string) => bad.push({ row: r.row, field: FIELD_LABEL[key], message });

        const entity = findEntity(r.entity);
        if (!entity) fail('entity', `No entity with the name or code "${r.entity}"`);
        else if (!entity.isActive) fail('entity', 'This entity is inactive');

        let loc: LocationRef | undefined;
        if (entity) {
            loc = locations.get(`${entity.id}|${lowerKey(r.location)}`);
            if (!loc) fail('location', `${entity.name} has no location named "${r.location}"`);
            else if (!loc.isActive) fail('location', 'This location is inactive');
        }

        if (loc) {
            const key = existingTitleKey(loc.id, r.title);
            const code = lk.existing.get(key);
            if (code) fail('title', `This location already has an internal compliance with this name (${code})`);
            const first = seen.get(key);
            if (first === undefined) seen.set(key, r.row);
            else fail('title', `Same name and location as row ${first}`);
        }

        const named = (key: InternalKey, text: string, map: ReadonlyMap<string, NamedRef>, noun: string) => {
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

        const person = (key: InternalKey, email: string): UserRef | null => {
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
                r.risk === 'HIGH',
            );
            if (problem === 'SAME_OWNER_MANAGER') fail('manager', 'Owner and manager must be different people');
            else if (problem === 'APPROVER_NOT_DISTINCT') fail('approver', 'The approver must be different from the owner and manager');
            else if (problem === 'HIGH_RISK_NO_APPROVER') fail('approver', 'High-risk items need an approver in Approval Level 1');
        }

        let lawCategoryName = DEFAULT_LAW_CATEGORY;
        if (r.lawCategory) {
            const c = lk.lawCategories.get(lowerKey(r.lawCategory));
            if (!c && lowerKey(r.lawCategory) !== lowerKey(DEFAULT_LAW_CATEGORY)) {
                fail('lawCategory', `No law category named "${r.lawCategory}"`);
            } else if (c) {
                lawCategoryName = c.name;
            }
        }

        let natureId: string | null = null;
        if (r.nature) {
            const n = lk.natures.get(lowerKey(r.nature));
            if (!n) fail('nature', `No compliance nature named "${r.nature}"`);
            else natureId = n.id;
        }

        if (bad.length > 0) {
            errors.push(...bad);
            continue;
        }
        if (!entity || !loc || !departmentId || !verticalId || !owner || !manager) continue; // every gap adds an error

        resolved.push({
            raw: r,
            entityId: entity.id,
            locationId: loc.id,
            locationLabel: `${entity.code} / ${loc.name}`,
            departmentId,
            verticalId,
            ownerId: owner.id,
            ownerName: owner.name,
            managerId: manager.id,
            managerName: manager.name,
            approverId: approver ? approver.id : null,
            lawCategoryName,
            natureId,
        });
    }
    return { resolved, errors };
}

// Codes for new internal compliances: a short company prefix and a running number, such as IC3F9A2B10-0007
export const internalPrefix = (orgId: string) => `IC${orgId.replace(/-/g, '').slice(0, 8).toUpperCase()}-`;

export function nextCodes(prefix: string, existingCodes: readonly string[], count: number): string[] {
    let max = 0;
    for (const c of existingCodes) {
        if (!c.startsWith(prefix)) continue;
        const n = Number(c.slice(prefix.length));
        if (Number.isInteger(n) && n > max) max = n;
    }
    return Array.from({ length: count }, (_, i) => `${prefix}${String(max + i + 1).padStart(4, '0')}`);
}