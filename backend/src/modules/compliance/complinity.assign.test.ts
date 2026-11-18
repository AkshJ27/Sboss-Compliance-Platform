import { describe, it, expect } from 'vitest';
import { entityCode, parsePerson, planComplinityAssignments, readDashboardData, stillInUse } from './complinity.assign';
import type { ComplianceRef, Lookups } from './complinity.assign';

const HEADER = ['Status', 'Owner[Email Id]', 'Manager[Email Id]', 'Entity', 'Department', 'Location', 'State', 'Location Type', 'Compliance', 'Due Date', 'Periodicity', 'Compliance ID', 'Vertical', 'Compliance Instance ID'];
type Cells = Partial<Record<(typeof HEADER)[number], string>>;
const base: Cells = {
    Status: 'Due', 'Owner[Email Id]': 'Pradeep Singh - [pradeep.panwar@quesscorp.com]', 'Manager[Email Id]': 'Amita Govekar - [hr13@sboss.net.in]',
    Entity: 'SBOSS Contractors', Department: 'Vendors', Location: 'Karnataka', State: 'Karnataka', 'Location Type': 'Vendor Location',
    Compliance: 'Payment of wages', 'Due Date': '07-Apr-2027', Periodicity: 'Monthly', 'Compliance ID': '19575', Vertical: 'Quess', 'Compliance Instance ID': '1',
};
const line = (c: Cells) => HEADER.map((h) => c[h] ?? '');
const sheet = (name: string, rows: Cells[]) => ({ name, grid: [['Organisation:', 'SBOSS'], ['Period:', 'x'], [], HEADER, ...rows.map((r) => line({ ...base, ...r }))] });

const comp = (code: string, o: Partial<ComplianceRef> = {}): ComplianceRef => ({
    id: `c-${code}`, code, isActive: true, jurisdiction: 'STATE', actState: 'Karnataka', version: 1, frequency: 'MONTHLY',
    periodBasis: 'FINANCIAL_YEAR', dueDay: 7, dueMonthOffset: 1, event: null, dueDaysAfterEvent: null, ...o,
});
const user = (id: string, email: string, o: Partial<Lookups['users'][number]> = {}) => ({ id, email, name: id, isActive: true, role: 'MEMBER' as const, defaultApproverId: null, ...o });
const lookups = (o: Partial<Lookups> = {}): Lookups => ({
    entities: [], departments: [], verticals: [], locationTypes: [], locations: [], schedules: [],
    users: [user('pradeep', 'pradeep.panwar@quesscorp.com'), user('amita', 'hr13@sboss.net.in', { defaultApproverId: 'shashi' }), user('nidhi', 'nidhi.babbar@adecco.com'), user('shashi', 'fh1@sboss.net.in')],
    compliances: new Map([['19575', comp('19575')], ['447', comp('447', { actState: 'Delhi' })]]),
    ...o,
});

describe('reading the Dashboard Data export', () => {
    it('reads names and emails', () => {
        expect(parsePerson('Bharat Reddy P - [bharatreddyp@tminetwork.com]')).toEqual({ name: 'Bharat Reddy P', email: 'bharatreddyp@tminetwork.com' });
        expect(parsePerson('a@x.in')).toEqual({ name: '', email: 'a@x.in' });
        expect(parsePerson('Amita')).toBeNull();
    });

    it('turns due dates into assignments, keeping the latest people', () => {
        const out = readDashboardData([
            sheet('2026', [{ 'Due Date': '07-Jan-2026', 'Owner[Email Id]': 'Old - [old@x.in]' }, { 'Compliance Instance ID': '2', Location: 'Jammu and Kashmir', State: 'Jammu & kashmir' }]),
            sheet('2027', [{ 'Due Date': '07-Nov-2027' }]),
        ]);
        expect(out.errors).toEqual([]);
        expect(out.rows).toBe(3);
        expect(out.latest).toEqual({ from: '2027-11-07', to: '2027-11-07' });
        expect(out.assignments.map((a) => [a.id, a.owner.email, a.lastDue, a.state])).toEqual([
            ['1', 'pradeep.panwar@quesscorp.com', '2027-11-07', 'Karnataka'],
            ['2', 'pradeep.panwar@quesscorp.com', '2027-04-07', 'Jammu and Kashmir'],
        ]);
    });

    it('needs the export with Compliance Instance ID', () => {
        expect(readDashboardData([{ name: 'Wrong.xlsx', grid: [['Act', 'Rule']] }]).fileErrors[0]).toContain('Wrong.xlsx: no "Compliance Instance ID" column');
    });
});

describe('which assignments are still in use', () => {
    const latest = { from: '2027-04-01', to: '2027-11-15' };
    it('keeps those the newest file lists, and annual ones it cannot see', () => {
        expect(stillInUse({ periodicity: 'Monthly', lastDue: '2027-11-07' }, latest)).toBe(true);
        expect(stillInUse({ periodicity: 'Yearly', lastDue: '2026-01-31' }, latest)).toBe(true); // next due Jan 2027 and Jan 2028: outside the file
        expect(stillInUse({ periodicity: 'Event Based', lastDue: '2026-01-10' }, latest)).toBe(true);
    });
    it('stops those missing where a due date was expected', () => {
        expect(stillInUse({ periodicity: 'Monthly', lastDue: '2026-08-15' }, latest)).toBe(false);
        expect(stillInUse({ periodicity: 'Yearly', lastDue: '2026-04-30' }, latest)).toBe(false); // April 2027 should be in the file
        expect(stillInUse({ periodicity: 'Half-Yearly', lastDue: '2026-04-30' }, latest)).toBe(false);
    });
});

describe('planning', () => {
    // One file of due dates in April 2027: everything in it is still in use
    const latest = { from: '2027-04-07', to: '2027-04-07' };
    const read = (rows: Cells[]) => readDashboardData([sheet('2027', rows)]).assignments;

    it('makes entity codes', () => {
        expect(entityCode('State Bank Operation Support Services Private Limited', new Set())).toBe('SBOSSPL');
        expect(entityCode('SBOSS Contractors', new Set(['SBOSSC']))).toBe('SBOSSC2');
    });

    it('creates the masters, with one location per vendor where an entity has several', () => {
        const plan = planComplinityAssignments(
            read([
                {},
                { 'Compliance Instance ID': '2', Vertical: 'Adecco', 'Owner[Email Id]': 'Nidhi - [nidhi.babbar@adecco.com]' },
                { 'Compliance Instance ID': '3', Entity: 'State Bank Operation Support Services Private Limited', Location: 'New Delhi', State: 'Delhi', Vertical: 'SBOSS', 'Location Type': 'Registered Office', 'Compliance ID': '447', 'Owner[Email Id]': 'A - [hr13@sboss.net.in]', 'Manager[Email Id]': 'S - [fh1@sboss.net.in]' },
            ]),
            latest,
            lookups({ departments: [{ id: 'd1', name: 'vendors' }] }),
        );
        expect(plan.errors).toEqual([]);
        expect(plan.masters.entities).toEqual([
            { name: 'SBOSS Contractors', code: 'SBOSSC' },
            { name: 'State Bank Operation Support Services Private Limited', code: 'SBOSSPL' },
        ]);
        expect(plan.masters.departments).toEqual([]); // "Vendors" already exists
        expect(plan.masters.verticals).toEqual(['Quess', 'Adecco', 'SBOSS']);
        expect(plan.masters.locations.map((l) => l.name)).toEqual(['Quess - Karnataka', 'Adecco - Karnataka', 'New Delhi']);
        // Amita's default approver is Shashi, but Shashi is already the manager here
        expect(plan.planned[2]).toMatchObject({ ownerId: 'amita', managerId: 'shashi', approverId: null, isActive: true });
    });

    it('uses the owner default approver when they are not on the item already', () => {
        const plan = planComplinityAssignments(read([{ 'Owner[Email Id]': 'A - [hr13@sboss.net.in]', 'Manager[Email Id]': 'N - [nidhi.babbar@adecco.com]' }]), latest, lookups());
        expect(plan.planned[0].approverId).toBe('shashi');
    });

    it('lists people and compliances that are missing, and refuses inactive people on active items', () => {
        const plan = planComplinityAssignments(
            read([
                { 'Owner[Email Id]': 'X - [new@vendor.in]' },
                { 'Compliance Instance ID': '2', 'Compliance ID': '99999' },
                { 'Compliance Instance ID': '3', 'Owner[Email Id]': 'N - [nidhi.babbar@adecco.com]', Vertical: 'Adecco' },
            ]),
            latest,
            lookups({ users: [...lookups().users.filter((u) => u.id !== 'nidhi'), user('nidhi', 'nidhi.babbar@adecco.com', { isActive: false })] }),
        );
        expect(plan.errors.map((e) => e.message)).toEqual([
            'nidhi.babbar@adecco.com is inactive, so cannot work on 19575',
            'new@vendor.in (1 assignment(s)) is not a user. Add them with the users upload first.',
            'Compliance ID 99999 (1 assignment(s)) is not in the library. Import Complinity\'s compliance details first.',
        ]);
    });

    it('updates an assignment already here instead of adding it again', () => {
        const lk = lookups({
            entities: [{ id: 'e1', name: 'SBOSS Contractors', code: 'SC' }],
            locations: [{ id: 'l1', entityId: 'e1', name: 'Karnataka' }],
            schedules: [{ id: 's1', locationId: 'l1', complianceId: 'c-19575', ownerId: 'nidhi', managerId: 'amita', approverId: null, departmentId: null, verticalId: null, isActive: true }],
        });
        const plan = planComplinityAssignments(read([{}]), latest, lk);
        expect(plan.masters.entities).toEqual([]);
        expect(plan.masters.locations).toEqual([]);
        expect(plan.planned[0]).toMatchObject({ existingId: 's1', changes: ['owner'] });
    });

    it('history files add missing assignments as stopped, unless they still have an item due', () => {
        const rows = read([
            { 'Compliance Instance ID': '1', 'Due Date': '30-Nov-2025' },
            { 'Compliance Instance ID': '2', 'Due Date': '30-Nov-2026', Vertical: 'Adecco', 'Owner[Email Id]': 'N - [nidhi.babbar@adecco.com]' },
        ]);
        const plan = planComplinityAssignments(rows, latest, lookups(), { pastOnly: true, liveFrom: '2026-11-18' });
        expect(plan.planned.map((p) => [p.assignmentId, p.isActive])).toEqual([['1', false], ['2', true]]);
        const old = planComplinityAssignments(rows, latest, lookups(), { pastOnly: true });
        expect(old.planned.every((p) => !p.isActive)).toBe(true);
    });
});