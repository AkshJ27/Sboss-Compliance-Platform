import { describe, it, expect } from 'vitest';
import { planHistory, readHistory, scheduleKey, statusOf, trailTimes } from './complinity.history';
import type { HistoryLookups, ScheduleRef } from './complinity.history';

const HEADER = ['Status', 'Owner[Email Id]', 'Manager[Email Id]', 'Entity', 'Location', 'Due Date', 'Period Start Date', 'Period End Date', 'Done Date', 'Ref No.', 'Remarks', 'Compliance ID', 'Vertical', 'Compliance Instance ID', 'Submitted By', 'Approved By'];
type Cells = Partial<Record<(typeof HEADER)[number], string>>;
const base: Cells = {
    Status: 'On Time', 'Owner[Email Id]': 'Pradeep Singh - [pradeep.panwar@quesscorp.com]', 'Manager[Email Id]': 'Amita Govekar - [hr13@sboss.net.in]',
    Entity: 'SBOSS Contractors', Location: 'Karnataka', 'Due Date': '07-Nov-2026', 'Period Start Date': '01-Oct-2026', 'Period End Date': '31-Oct-2026',
    'Done Date': '05-Nov-2026', 'Ref No.': 'NA', Remarks: '', 'Compliance ID': '19575', Vertical: 'Quess', 'Compliance Instance ID': '1',
};
const sheet = (rows: Cells[]) => ({ name: 'History.xlsx', grid: [['Organisation:', 'SBOSS'], [], [], [], HEADER, ...rows.map((r) => HEADER.map((h) => ({ ...base, ...r })[h] ?? ''))] });

const schedule = (id: string): ScheduleRef => ({ id, complianceId: 'c1', entityId: 'e1', locationId: 'l1', departmentId: null, verticalId: null, approverId: null, highRisk: true });
const lookups = (o: Partial<HistoryLookups> = {}): HistoryLookups => ({
    scheduleAt: new Map([
        [scheduleKey('SBOSS Contractors', 'Quess - Karnataka', '19575'), schedule('s-quess')],
        [scheduleKey('SBOSS Contractors', 'Adecco - Karnataka', '19575'), schedule('s-adecco')],
    ]),
    userByEmail: new Map([['pradeep.panwar@quesscorp.com', 'pradeep'], ['hr13@sboss.net.in', 'amita'], ['nidhi.babbar@adecco.com', 'nidhi']]),
    userByName: new Map([['amita govekar', 'amita']]),
    instances: new Map(),
    ...o,
});

describe('Complinity history', () => {
    it("maps Complinity's statuses", () => {
        expect(statusOf('On Time Without Proof')).toEqual({ status: 'CLOSED', submissionType: 'APPLICABLE', isWip: false });
        expect(statusOf('Late Closure')?.status).toBe('CLOSED');
        expect(statusOf('Not Applicable')).toMatchObject({ status: 'NOT_APPLICABLE', submissionType: 'NOT_APPLICABLE' });
        expect(statusOf('Pending Approval Without Proof')?.status).toBe('SUBMITTED');
        expect(statusOf('Non Compliance (Work in Progress)')).toEqual({ status: 'DUE', submissionType: null, isWip: true });
        expect(statusOf('Something else')).toBeNull();
    });

    it('reads the submit and approve times from the remarks, in India time', () => {
        const t = trailTimes('02-Jan-2026 17:26:43::Akshay Chikodikar ( SUBMITTED as Applicable )::complied \n03-Jan-2026 00:13:02::Sanjay Singh(APPROVED)::Bulk Approval');
        expect(t).toEqual({ submittedAt: '2026-01-02T11:56:43.000Z', closedAt: '2026-01-02T18:43:02.000Z' });
        expect(trailTimes('no trail')).toEqual({ submittedAt: null, closedAt: null });
    });

    it('places each past item on its assignment and period, with the people and times', () => {
        const read = readHistory([
            sheet([
                { Remarks: '06-Nov-2026 10:00:00::Pradeep Singh ( SUBMITTED as Applicable )::done\n07-Nov-2026 09:00:00::Amita Govekar(APPROVED)::ok', 'Approved By': 'Amita Govekar (Manager)', 'Ref No.': 'CH-1' },
                { 'Compliance Instance ID': '2', Vertical: 'Adecco', 'Owner[Email Id]': 'N - [nidhi.babbar@adecco.com]', Status: 'Non Compliance', 'Done Date': '' },
            ]),
        ]);
        expect(read.errors).toEqual([]);
        const plan = planHistory(read.rows, lookups());
        expect(plan.errors).toEqual([]);
        expect(plan.create.map((p) => [p.schedule.id, p.row.status, p.row.periodStart, p.ownerId])).toEqual([
            ['s-quess', 'CLOSED', '2026-10-01', 'pradeep'],
            ['s-adecco', 'DUE', '2026-10-01', 'nidhi'],
        ]);
        expect(plan.create[0]).toMatchObject({ submittedById: 'pradeep', approvedById: 'amita' });
        expect(plan.create[0].row).toMatchObject({ refNo: 'CH-1', doneDate: '2026-11-05', closedAt: '2026-11-07T03:30:00.000Z' });
    });

    it('fills in generated items not yet worked on, and leaves worked ones alone', () => {
        const rows = readHistory([sheet([{}, { 'Compliance Instance ID': '2', Vertical: 'Adecco', 'Owner[Email Id]': 'N - [nidhi.babbar@adecco.com]' }])]).rows;
        const plan = planHistory(rows, lookups({
            instances: new Map([
                ['s-quess|2026-10-01', { id: 'i1', status: 'DUE', touched: false }],
                ['s-adecco|2026-10-01', { id: 'i2', status: 'CLOSED', touched: true }],
            ]),
        }));
        expect(plan.create).toEqual([]);
        expect(plan.update.map((p) => p.existingId)).toEqual(['i1']);
        expect(plan.warnings).toEqual(['1 item(s) have already been worked on here, so they were left as they are.']);
    });

    it('needs the assignments and people first', () => {
        const rows = readHistory([sheet([{ 'Compliance ID': '99999' }, { 'Owner[Email Id]': 'X - [gone@vendor.in]', 'Compliance Instance ID': '3' }])]).rows;
        const plan = planHistory(rows, lookups());
        expect(plan.errors.map((e) => e.message)).toEqual([
            'gone@vendor.in (1 item(s)) is not a user. Add them with the users upload first.',
            '1 item(s) have no assignment here, such as 99999 at Quess - Karnataka. Upload the assignments from Complinity first.',
        ]);
    });
});