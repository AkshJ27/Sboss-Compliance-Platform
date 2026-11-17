import { describe, it, expect } from 'vitest';
import type { InstanceStatus } from '@prisma/client';
import {
    columnsFor,
    effectivePeople,
    peopleProblem,
    planInstanceSwap,
    planReplicate,
    planScheduleSwap,
    signatureOf,
    type InstanceRow,
    type People,
    type Role,
    type SourceSchedule,
} from './bulk.engine';

const people = (o: Partial<People> = {}): People => ({
    ownerId: 'owner',
    managerId: 'manager',
    approverId: 'approver',
    ...o,
});
const only = (...r: Role[]) => new Set<Role>(r);
const ALL = only('OWNER', 'MANAGER', 'APPROVER');

describe('effectivePeople', () => {
    it('keeps the source people when nothing is overridden', () => {
        expect(effectivePeople(people(), {})).toEqual(people());
    });

    it('overrides one person at a time', () => {
        expect(effectivePeople(people(), { ownerId: 'o2' })).toEqual(people({ ownerId: 'o2' }));
        expect(effectivePeople(people(), { managerId: 'm2', approverId: 'a2' })).toEqual(
            people({ managerId: 'm2', approverId: 'a2' }),
        );
    });

    it('an approver override fills in a missing approver', () => {
        expect(effectivePeople(people({ approverId: null }), { approverId: 'a2' }).approverId).toBe('a2');
        expect(effectivePeople(people({ approverId: null }), {}).approverId).toBeNull();
    });
});

describe('peopleProblem', () => {
    it('accepts three different people', () => {
        expect(peopleProblem(people())).toBeNull();
    });

    it('refuses the same owner and manager', () => {
        expect(peopleProblem(people({ managerId: 'owner' }))).toBe('SAME_OWNER_MANAGER');
    });

    it('refuses an approver who is also the owner or the manager', () => {
        expect(peopleProblem(people({ approverId: 'owner' }))).toBe('APPROVER_NOT_DISTINCT');
        expect(peopleProblem(people({ approverId: 'manager' }))).toBe('APPROVER_NOT_DISTINCT');
    });

    it('an approver is optional, whatever the risk', () => {
        expect(peopleProblem(people({ approverId: null }))).toBeNull();
    });
});

const src = (complianceId: string, o: Partial<SourceSchedule> = {}): SourceSchedule => ({
    complianceId,
    risk: 'MEDIUM',
    jurisdiction: 'CENTRAL',
    actName: 'Companies Act, 2013',
    actState: null,
    ...o,
});
const wages = (id: string) =>
    src(id, { jurisdiction: 'STATE', actName: 'Minimum Wages Act, 1948', actState: 'Maharashtra' });

describe('planReplicate', () => {
    it('copies central laws to any state', () => {
        const r = planReplicate([src('a'), src('b')], 'Karnataka', new Map());
        expect(r.toCreate.map((s) => s.complianceId)).toEqual(['a', 'b']);
        expect(r.skippedWrongState).toEqual([]);
    });

    it('copies a state law only to a location in that state', () => {
        expect(planReplicate([wages('w')], 'Maharashtra', new Map()).toCreate).toHaveLength(1);
        const r = planReplicate([wages('w')], 'Karnataka', new Map());
        expect(r.toCreate).toHaveLength(0);
        expect(r.skippedWrongState).toEqual([{ act: 'Minimum Wages Act, 1948 (Maharashtra)', count: 1 }]);
    });

    it('reports skipped state laws by Act, in a steady order', () => {
        const state = (id: string, act: string) => src(id, { jurisdiction: 'STATE', actName: act, actState: 'Goa' });
        const r = planReplicate([state('1', 'B Act'), state('2', 'B Act'), state('3', 'A Act')], 'Kerala', new Map());
        expect(r.skippedWrongState).toEqual([
            { act: 'A Act (Goa)', count: 1 },
            { act: 'B Act (Goa)', count: 2 },
        ]);
    });

    it('counts schedules that already exist, active or inactive', () => {
        const r = planReplicate(
            [src('a'), src('b'), src('c')],
            'Goa',
            new Map([
                ['a', true],
                ['b', false],
            ]),
        );
        expect(r.toCreate.map((s) => s.complianceId)).toEqual(['c']);
        expect(r.alreadyActive).toBe(1);
        expect(r.alreadyInactive).toBe(1);
    });

    it('does nothing for an empty source', () => {
        expect(planReplicate([], 'Goa', new Map())).toEqual({
            toCreate: [],
            alreadyActive: 0,
            alreadyInactive: 0,
            skippedWrongState: [],
        });
    });
});

describe('planScheduleSwap', () => {
    it('moves the owner', () => {
        expect(planScheduleSwap([{ id: 's1', ...people() }], 'owner', 'newbie', only('OWNER'))).toEqual({
            moves: [{ id: 's1', set: { ownerId: 'newbie' } }],
            conflicts: 0,
        });
    });

    it('moves several roles at once and records which columns changed', () => {
        const rows = [
            { id: 's1', ...people({ ownerId: 'p' }) },
            { id: 's2', ...people({ approverId: 'p' }) },
            { id: 's3', ...people({ managerId: 'p' }) },
        ];
        expect(planScheduleSwap(rows, 'p', 'q', ALL)).toEqual({
            moves: [
                { id: 's1', set: { ownerId: 'q' } },
                { id: 's2', set: { approverId: 'q' } },
                { id: 's3', set: { managerId: 'q' } },
            ],
            conflicts: 0,
        });
    });

    it('skips a schedule where the new person would hold two roles', () => {
        const rows = [
            { id: 'c1', ...people({ ownerId: 'p', managerId: 'q' }) },
            { id: 'c2', ...people({ ownerId: 'p', approverId: 'q' }) },
        ];
        expect(planScheduleSwap(rows, 'p', 'q', only('OWNER'))).toEqual({ moves: [], conflicts: 2 });
    });

    it('leaves schedules alone when the person has none of the chosen roles', () => {
        expect(planScheduleSwap([{ id: 's1', ...people() }], 'someone-else', 'q', ALL)).toEqual({
            moves: [],
            conflicts: 0,
        });
    });

    it('leaves a role alone when it was not chosen', () => {
        expect(planScheduleSwap([{ id: 's1', ...people({ managerId: 'p' }) }], 'p', 'q', only('OWNER'))).toEqual({
            moves: [],
            conflicts: 0,
        });
    });

    it('a schedule with no approver never matches the approver role', () => {
        expect(planScheduleSwap([{ id: 's1', ...people({ approverId: null }) }], 'p', 'q', only('APPROVER'))).toEqual({
            moves: [],
            conflicts: 0,
        });
    });
});

const item = (id: string, status: InstanceStatus, o: Partial<InstanceRow> = {}): InstanceRow => ({
    id,
    status,
    ...people(),
    submittedById: null,
    managerActionById: null,
    ...o,
});

describe('planInstanceSwap', () => {
    it('moves the owner only on items that are due or returned', () => {
        const rows = [
            item('a', 'DUE', { ownerId: 'p' }),
            item('b', 'RETURNED', { ownerId: 'p' }),
            item('c', 'SUBMITTED', { ownerId: 'p' }),
            item('d', 'CLOSED', { ownerId: 'p' }),
        ];
        expect(planInstanceSwap(rows, 'p', 'q', only('OWNER'))).toEqual({
            moves: [
                { id: 'a', status: 'DUE', set: { ownerId: 'q' } },
                { id: 'b', status: 'RETURNED', set: { ownerId: 'q' } },
            ],
            conflicts: 0,
            blocked: 0,
        });
    });

    it('moves the manager while an item waits for review, but not after the manager approved it', () => {
        const rows = [
            item('a', 'DUE', { managerId: 'p' }),
            item('b', 'SUBMITTED', { managerId: 'p', submittedById: 'sub' }),
            item('c', 'MANAGER_APPROVED', { managerId: 'p', managerActionById: 'p', submittedById: 'sub' }),
        ];
        const r = planInstanceSwap(rows, 'p', 'q', only('MANAGER'));
        expect(r.moves.map((m) => m.id)).toEqual(['a', 'b']);
        expect(r.conflicts).toBe(0);
        expect(r.blocked).toBe(0);
    });

    it('moves the approver at any open stage, including after the manager approved', () => {
        const rows = [
            item('a', 'DUE', { approverId: 'p' }),
            item('b', 'SUBMITTED', { approverId: 'p', submittedById: 'sub' }),
            item('c', 'MANAGER_APPROVED', { approverId: 'p', submittedById: 'sub', managerActionById: 'mgr' }),
            item('d', 'RETURNED', { approverId: 'p' }),
        ];
        expect(planInstanceSwap(rows, 'p', 'q', only('APPROVER')).moves.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('blocks a new manager who submitted the item', () => {
        const rows = [item('a', 'SUBMITTED', { managerId: 'p', submittedById: 'q' })];
        expect(planInstanceSwap(rows, 'p', 'q', only('MANAGER'))).toEqual({ moves: [], conflicts: 0, blocked: 1 });
    });

    it('blocks a new approver who submitted the item or approved it as manager', () => {
        const rows = [
            item('a', 'MANAGER_APPROVED', { approverId: 'p', submittedById: 'q', managerActionById: 'm' }),
            item('b', 'MANAGER_APPROVED', { approverId: 'p', submittedById: 's', managerActionById: 'q' }),
        ];
        expect(planInstanceSwap(rows, 'p', 'q', only('APPROVER'))).toEqual({ moves: [], conflicts: 0, blocked: 2 });
    });

    it('skips items where the new person would hold two roles', () => {
        const rows = [
            item('a', 'DUE', { ownerId: 'p', managerId: 'q' }),
            item('b', 'DUE', { managerId: 'p', approverId: 'q' }),
        ];
        expect(planInstanceSwap(rows, 'p', 'q', only('OWNER', 'MANAGER'))).toEqual({
            moves: [],
            conflicts: 2,
            blocked: 0,
        });
    });

    it('only applies the review checks while an item is in review', () => {
        const rows = [item('a', 'RETURNED', { managerId: 'p', submittedById: 'q' })];
        expect(planInstanceSwap(rows, 'p', 'q', only('MANAGER'))).toEqual({
            moves: [{ id: 'a', status: 'RETURNED', set: { managerId: 'q' } }],
            conflicts: 0,
            blocked: 0,
        });
    });
});

describe('signatureOf and columnsFor', () => {
    it('builds a signature from the changed columns, in a fixed order', () => {
        expect(signatureOf({ ownerId: 'q' })).toBe('O');
        expect(signatureOf({ managerId: 'q', approverId: 'q' })).toBe('MA');
        expect(signatureOf({ approverId: 'q', managerId: 'q', ownerId: 'q' })).toBe('OMA');
        expect(signatureOf({})).toBe('');
    });

    it('builds the columns to change from a signature', () => {
        expect(columnsFor('OA', 'x')).toEqual({ ownerId: 'x', approverId: 'x' });
        expect(columnsFor('M', 'y')).toEqual({ managerId: 'y' });
    });
});