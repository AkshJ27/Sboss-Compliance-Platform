import { describe, it, expect } from 'vitest';
import {
    resolveRows,
    splitExisting,
    type ComplianceRef,
    type EntityRef,
    type LocationRef,
    type Lookups,
    type ResolvedRow,
} from './bulk.import.resolve';
import type { RawRow } from './bulk.import.parser';

const ent: EntityRef = { id: 'e1', code: 'ACME', name: 'Acme Manufacturing Pvt Ltd', isActive: true };
const pune: LocationRef = { id: 'l1', entityId: 'e1', name: 'Pune Plant', state: 'Maharashtra', isActive: true };
const blr: LocationRef = { id: 'l2', entityId: 'e1', name: 'Bengaluru Hub', state: 'Karnataka', isActive: true };

const comp = (code: string, o: Partial<ComplianceRef> = {}): ComplianceRef => ({
    id: `c-${code}`,
    code,
    title: `${code} title`,
    risk: 'MEDIUM',
    isActive: true,
    version: 1,
    frequency: 'MONTHLY',
    periodBasis: 'FINANCIAL_YEAR',
    dueDay: 7,
    dueMonthOffset: 1,
    event: null,
    dueDaysAfterEvent: null,
    actName: 'Companies Act, 2013',
    actState: null,
    jurisdiction: 'CENTRAL',
    actActive: true,
    ...o,
});

const user = (id: string, name: string, o: { isActive?: boolean; role?: string } = {}) => ({
    id,
    name,
    isActive: o.isActive ?? true,
    role: o.role ?? 'MEMBER',
});

const lookups = (over: Partial<Lookups> = {}): Lookups => ({
    entities: [ent],
    locations: [pune, blr],
    compliances: new Map([
        ['C1', comp('C1')],
        ['C2', comp('C2')],
    ]),
    users: new Map([
        ['owner@x.com', user('u-owner', 'Ravi Member')],
        ['manager@x.com', user('u-manager', 'Meera Manager')],
        ['approver@x.com', user('u-approver', 'Asha Admin', { role: 'ORG_ADMIN' })],
        ['viewer@x.com', user('u-viewer', 'Vina Viewer', { role: 'VIEWER' })],
        ['gone@x.com', user('u-gone', 'Gone Person', { isActive: false })],
    ]),
    departments: new Map([
        ['human resources', { id: 'd1', isActive: true }],
        ['finance', { id: 'd2', isActive: false }],
    ]),
    verticals: new Map([['manufacturing', { id: 'v1', isActive: true }]]),
    ...over,
});

const raw = (o: Partial<RawRow> = {}): RawRow => ({
    row: 1,
    entity: 'ACME',
    location: 'Pune Plant',
    code: 'C1',
    owner: 'owner@x.com',
    manager: 'manager@x.com',
    approver: null,
    department: null,
    vertical: null,
    startDate: '2026-04-01',
    ...o,
});

describe('resolveRows', () => {
    it('turns a good row into ids and names', () => {
        const r = resolveRows([raw()], lookups(), null);
        expect(r.errors).toEqual([]);
        expect(r.resolved).toHaveLength(1);
        expect(r.resolved[0]).toMatchObject({
            row: 1,
            entityId: 'e1',
            locationId: 'l1',
            locationLabel: 'ACME / Pune Plant',
            ownerId: 'u-owner',
            ownerName: 'Ravi Member',
            managerId: 'u-manager',
            managerName: 'Meera Manager',
            approverId: null,
            departmentId: null,
            verticalId: null,
            startDate: '2026-04-01',
        });
        expect(r.resolved[0].compliance.id).toBe('c-C1');
    });

    it('finds the entity by code or by name, in any capitals and spacing', () => {
        const r = resolveRows(
            [raw({ row: 1, entity: 'acme' }), raw({ row: 2, entity: 'ACME MANUFACTURING  pvt ltd', code: 'C2' })],
            lookups(),
            null,
        );
        expect(r.errors).toEqual([]);
        expect(r.resolved.map((x) => x.entityId)).toEqual(['e1', 'e1']);
    });

    it('finds the location in any capitals and spacing', () => {
        const r = resolveRows([raw({ location: 'pune   PLANT' })], lookups(), null);
        expect(r.errors).toEqual([]);
        expect(r.resolved[0].locationId).toBe('l1');
    });

    it('fills in the approver, department and vertical when given', () => {
        const r = resolveRows(
            [raw({ approver: 'approver@x.com', department: 'Human  Resources', vertical: 'MANUFACTURING' })],
            lookups(),
            null,
        );
        expect(r.errors).toEqual([]);
        expect(r.resolved[0]).toMatchObject({ approverId: 'u-approver', departmentId: 'd1', verticalId: 'v1' });
    });

    it('reports an unknown entity without also complaining about its location', () => {
        expect(resolveRows([raw({ entity: 'NOPE' })], lookups(), null).errors).toEqual([
            { row: 1, field: 'entity', message: 'No entity with the code or name "NOPE"' },
        ]);
    });

    it('reports an inactive entity and an inactive location', () => {
        const inactiveEntity = lookups({ entities: [{ ...ent, isActive: false }] });
        expect(resolveRows([raw()], inactiveEntity, null).errors).toEqual([
            { row: 1, field: 'entity', message: 'This entity is inactive' },
        ]);
        const inactiveLocation = lookups({ locations: [{ ...pune, isActive: false }, blr] });
        expect(resolveRows([raw()], inactiveLocation, null).errors).toEqual([
            { row: 1, field: 'location', message: 'This location is inactive' },
        ]);
    });

    it('reports a location the entity does not have', () => {
        expect(resolveRows([raw({ location: 'Nowhere' })], lookups(), null).errors).toEqual([
            { row: 1, field: 'location', message: 'Entity ACME has no location named "Nowhere"' },
        ]);
    });

    it('reports an unknown compliance and an inactive one, or one whose Act is inactive', () => {
        const lk = lookups({
            compliances: new Map([
                ['C1', comp('C1')],
                ['OFF', comp('OFF', { isActive: false })],
                ['OFFACT', comp('OFFACT', { actActive: false })],
            ]),
        });
        expect(resolveRows([raw({ code: 'NOPE' })], lk, null).errors).toEqual([
            { row: 1, field: 'compliance code', message: 'No compliance with the code "NOPE" in the library' },
        ]);
        for (const code of ['OFF', 'OFFACT']) {
            expect(resolveRows([raw({ code })], lk, null).errors).toEqual([
                { row: 1, field: 'compliance code', message: 'This compliance is inactive in the library' },
            ]);
        }
    });

    it('allows a state law only at a location in that state', () => {
        const wages = comp('W1', { jurisdiction: 'STATE', actState: 'Maharashtra', actName: 'Minimum Wages Act, 1948' });
        const lk = lookups({ compliances: new Map([['W1', wages]]) });
        expect(resolveRows([raw({ code: 'W1' })], lk, null).errors).toEqual([]);
        expect(resolveRows([raw({ code: 'W1', location: 'Bengaluru Hub' })], lk, null).errors).toEqual([
            {
                row: 1,
                field: 'compliance code',
                message: 'Minimum Wages Act, 1948 (Maharashtra) applies only in Maharashtra, but this location is in Karnataka',
            },
        ]);
    });

    it('refuses unknown, deactivated and viewer users with the same message', () => {
        const r = resolveRows(
            [raw({ owner: 'nobody@x.com', manager: 'gone@x.com', approver: 'viewer@x.com' })],
            lookups(),
            null,
        );
        const message = 'No active, non-viewer user in your company has this email';
        expect(r.errors).toEqual([
            { row: 1, field: 'owner email', message },
            { row: 1, field: 'manager email', message },
            { row: 1, field: 'approver email', message },
        ]);
    });

    it('refuses the same person as owner and manager', () => {
        expect(resolveRows([raw({ manager: 'owner@x.com' })], lookups(), null).errors).toEqual([
            { row: 1, field: 'manager email', message: 'Owner and manager must be different people' },
        ]);
    });

    it('refuses an approver who is also the owner', () => {
        expect(resolveRows([raw({ approver: 'owner@x.com' })], lookups(), null).errors).toEqual([
            { row: 1, field: 'approver email', message: 'The approver must be a different person from the owner and manager' },
        ]);
    });

    it('a high-risk compliance needs an approver', () => {
        const lk = lookups({ compliances: new Map([['H1', comp('H1', { risk: 'HIGH' })]]) });
        expect(resolveRows([raw({ code: 'H1' })], lk, null).errors).toEqual([
            { row: 1, field: 'approver email', message: 'This is a high-risk compliance, so it needs an approver' },
        ]);
        expect(resolveRows([raw({ code: 'H1', approver: 'approver@x.com' })], lk, null).errors).toEqual([]);
    });

    it('does not add a missing-approver complaint when the approver email is unknown', () => {
        const lk = lookups({ compliances: new Map([['H1', comp('H1', { risk: 'HIGH' })]]) });
        const r = resolveRows([raw({ code: 'H1', approver: 'nobody@x.com' })], lk, null);
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].field).toBe('approver email');
    });

    it('refuses an unknown or inactive department, and an unknown vertical', () => {
        expect(resolveRows([raw({ department: 'Nope' })], lookups(), null).errors).toEqual([
            { row: 1, field: 'department', message: 'No department named "Nope"' },
        ]);
        expect(resolveRows([raw({ department: 'Finance' })], lookups(), null).errors).toEqual([
            { row: 1, field: 'department', message: 'This department is inactive' },
        ]);
        expect(resolveRows([raw({ vertical: 'Nope' })], lookups(), null).errors).toEqual([
            { row: 1, field: 'vertical', message: 'No vertical named "Nope"' },
        ]);
    });

    it('uses the row start date, falls back to the default, and refuses when there is neither', () => {
        const withDefault = resolveRows(
            [raw({ row: 1, code: 'C1', startDate: '2026-04-01' }), raw({ row: 2, code: 'C2', startDate: null })],
            lookups(),
            '2026-05-01',
        );
        expect(withDefault.resolved.map((x) => x.startDate)).toEqual(['2026-04-01', '2026-05-01']);

        const none = resolveRows([raw({ startDate: null })], lookups(), null);
        expect(none.errors).toEqual([
            { row: 1, field: 'start date', message: 'Required. Add a start date to this row, or choose a default start date' },
        ]);
    });

    it('flags a repeated location and compliance, pointing at the first row', () => {
        const r = resolveRows([raw({ row: 1 }), raw({ row: 2 })], lookups(), null);
        expect(r.resolved).toHaveLength(1);
        expect(r.errors).toEqual([{ row: 2, field: 'compliance code', message: 'Duplicate of row 1' }]);
    });

    it('allows the same compliance at two locations and two compliances at one location', () => {
        const r = resolveRows(
            [
                raw({ row: 1, location: 'Pune Plant', code: 'C1' }),
                raw({ row: 2, location: 'Bengaluru Hub', code: 'C1' }),
                raw({ row: 3, location: 'Pune Plant', code: 'C2' }),
            ],
            lookups(),
            null,
        );
        expect(r.errors).toEqual([]);
        expect(r.resolved).toHaveLength(3);
    });

    it('reports every problem of a row and still resolves the good rows', () => {
        const r = resolveRows([raw({ row: 1 }), raw({ row: 2, location: 'Nowhere', owner: 'nobody@x.com' })], lookups(), null);
        expect(r.resolved.map((x) => x.row)).toEqual([1]);
        expect(r.errors.map((e) => e.row)).toEqual([2, 2]);
        expect(r.errors.map((e) => e.field)).toEqual(['location', 'owner email']);
    });
});

const rr = (locationId: string, complianceId: string) =>
    ({ locationId, compliance: { id: complianceId } }) as unknown as ResolvedRow;

describe('splitExisting', () => {
    it('separates new rows from schedules that are already active or inactive', () => {
        const r = splitExisting(
            [rr('l1', 'c-C1'), rr('l1', 'c-C2'), rr('l1', 'c-C3')],
            new Map([
                ['l1|c-C1', true],
                ['l1|c-C2', false],
            ]),
        );
        expect(r.toCreate.map((x) => x.compliance.id)).toEqual(['c-C3']);
        expect(r.alreadyActive).toBe(1);
        expect(r.alreadyInactive).toBe(1);
    });

    it('judges each location on its own', () => {
        const r = splitExisting([rr('l1', 'c-C1'), rr('l2', 'c-C1')], new Map([['l1|c-C1', true]]));
        expect(r.toCreate.map((x) => x.locationId)).toEqual(['l2']);
        expect(r.alreadyActive).toBe(1);
    });
});