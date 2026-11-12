import { describe, it, expect } from 'vitest';
import {
    describeRule,
    formatChange,
    mergeChanges,
    planOpenItemMoves,
    sameRule,
    summarizePending,
    toChangeViews,
    type LibraryRule,
    type OpenItem,
    type PinGroup,
    type Rule,
} from './amendments.engine';

const rule = (o: Partial<Rule> = {}): Rule => ({
    frequency: 'MONTHLY',
    periodBasis: 'FINANCIAL_YEAR',
    dueDay: 7,
    dueMonthOffset: 1,
    event: null,
    dueDaysAfterEvent: null,
    ...o,
});
const item = (id: string, periodStart: string, periodEnd: string, dueDate: string): OpenItem => ({
    id,
    periodStart,
    periodEnd,
    dueDate,
});

describe('sameRule', () => {
    it('is true for the same rule and false when any due-date field differs', () => {
        const base = rule();
        expect(sameRule(base, { ...base })).toBe(true);
        const variants: Partial<Rule>[] = [
            { frequency: 'QUARTERLY' },
            { periodBasis: 'CALENDAR_YEAR' },
            { dueDay: 8 },
            { dueMonthOffset: 0 },
            { event: 'X' },
            { dueDaysAfterEvent: 5 },
        ];
        for (const v of variants) expect(sameRule(base, rule(v))).toBe(false);
    });
});

describe('mergeChanges', () => {
    it('keeps the earliest from and the latest to across versions', () => {
        const out = mergeChanges([
            { version: 3, changes: { dueDay: { from: 10, to: 12 }, penalty: { from: 'b', to: 'c' } } },
            { version: 2, changes: { dueDay: { from: 7, to: 10 }, penalty: { from: 'a', to: 'b' } } },
        ]);
        expect(out).toEqual([
            { field: 'dueDay', from: 7, to: 12 },
            { field: 'penalty', from: 'a', to: 'c' },
        ]);
    });

    it('drops fields that end where they started', () => {
        const out = mergeChanges([
            { version: 2, changes: { dueDay: { from: 7, to: 10 }, title: { from: 'A', to: 'B' } } },
            { version: 3, changes: { dueDay: { from: 10, to: 7 } } },
        ]);
        expect(out).toEqual([{ field: 'title', from: 'A', to: 'B' }]);
    });

    it('ignores the creation record and changes it cannot read', () => {
        const out = mergeChanges([
            { version: 1, changes: { created: true } },
            { version: 2, changes: null },
            { version: 3, changes: 'oops' },
            { version: 4, changes: { risk: 'HIGH' } },
        ]);
        expect(out).toEqual([]);
    });

    it('lists due-date fields first and the rest alphabetically', () => {
        const out = mergeChanges([
            {
                version: 2,
                changes: {
                    title: { from: 'a', to: 'b' },
                    penalty: { from: null, to: 'x' },
                    dueDay: { from: 1, to: 2 },
                    frequency: { from: 'MONTHLY', to: 'ANNUAL' },
                },
            },
        ]);
        expect(out.map((c) => c.field)).toEqual(['frequency', 'dueDay', 'penalty', 'title']);
    });
});

describe('formatChange', () => {
    it('labels fields and formats their values', () => {
        expect(formatChange({ field: 'dueDay', from: 7, to: 10 })).toEqual({
            field: 'dueDay',
            label: 'Due day',
            kind: 'RULE',
            from: '7',
            to: '10',
            opaque: false,
        });
        expect(formatChange({ field: 'frequency', from: 'MONTHLY', to: 'HALF_YEARLY' })).toMatchObject({
            kind: 'RULE',
            from: 'Monthly',
            to: 'Half yearly',
        });
        expect(formatChange({ field: 'risk', from: 'MEDIUM', to: 'HIGH' })).toMatchObject({
            kind: 'LIVE',
            from: 'Medium',
            to: 'High',
        });
        expect(formatChange({ field: 'penalty', from: null, to: 'Rs 500' })).toMatchObject({
            from: null,
            to: 'Rs 500',
        });
    });

    it('hides the values of fields that only hold ids', () => {
        expect(formatChange({ field: 'actId', from: 'u1', to: 'u2' })).toEqual({
            field: 'actId',
            label: 'Act',
            kind: 'LIVE',
            from: null,
            to: null,
            opaque: true,
        });
    });

    it('formats true and false and shortens very long text', () => {
        expect(formatChange({ field: 'isActive', from: true, to: false })).toMatchObject({
            from: 'Active',
            to: 'Inactive',
        });
        expect(formatChange({ field: 'imprisonment', from: false, to: true })).toMatchObject({
            from: 'No',
            to: 'Yes',
        });
        const long = formatChange({ field: 'description', from: null, to: 'x'.repeat(400) });
        expect(long.to).toHaveLength(300);
        expect(long.to?.endsWith('...')).toBe(true);
    });
});

describe('toChangeViews', () => {
    it('turns stored changes into views and ignores anything else', () => {
        const views = toChangeViews([
            { field: 'dueDay', from: 7, to: 10 },
            { nope: true },
            'junk',
            { field: 'risk', from: 'LOW', to: 'HIGH' },
        ]);
        expect(views.map((v) => [v.field, v.from, v.to])).toEqual([
            ['dueDay', '7', '10'],
            ['risk', 'Low', 'High'],
        ]);
        expect(toChangeViews('not a list')).toEqual([]);
    });
});

describe('describeRule', () => {
    it('describes monthly, calendar-year, one-time and event rules in words', () => {
        expect(describeRule(rule())).toBe('Monthly, day 7, 1 month after the period');
        expect(describeRule(rule({ dueMonthOffset: 3 }))).toBe('Monthly, day 7, 3 months after the period');
        expect(
            describeRule(rule({ frequency: 'QUARTERLY', periodBasis: 'CALENDAR_YEAR', dueDay: 31, dueMonthOffset: 0 })),
        ).toBe('Quarterly, day 31, in the last month of the period, calendar year');
        expect(describeRule(rule({ frequency: 'ONE_TIME', dueDay: null }))).toBe('One time, due on the start date');
        expect(describeRule(rule({ frequency: 'ONE_TIME', dueDay: 15 }))).toBe('One time, day 15');
        expect(
            describeRule(
                rule({ frequency: 'EVENT_BASED', dueDay: null, event: 'Change of registered office', dueDaysAfterEvent: 30 }),
            ),
        ).toBe('Event based: 30 days after "Change of registered office"');
        expect(
            describeRule(rule({ frequency: 'EVENT_BASED', dueDay: null, event: 'X', dueDaysAfterEvent: 1 })),
        ).toBe('Event based: 1 day after "X"');
    });
});

describe('planOpenItemMoves', () => {
    it('moves open monthly items to the new day', () => {
        const plan = planOpenItemMoves(rule({ dueDay: 7 }), rule({ dueDay: 10 }), [
            item('a', '2026-04-01', '2026-04-30', '2026-05-07'),
            item('b', '2026-05-01', '2026-05-31', '2026-06-07'),
        ]);
        expect(plan).toEqual({
            moves: [
                { id: 'a', from: '2026-05-07', to: '2026-05-10' },
                { id: 'b', from: '2026-06-07', to: '2026-06-10' },
            ],
            unchanged: 0,
            kept: 0,
            reason: 'NONE',
        });
    });

    it('leaves items alone when the rule is the same', () => {
        const plan = planOpenItemMoves(rule(), rule(), [item('a', '2026-04-01', '2026-04-30', '2026-05-07')]);
        expect(plan).toEqual({ moves: [], unchanged: 1, kept: 0, reason: 'NONE' });
    });

    it('counts items that are already on the new date as unchanged', () => {
        const plan = planOpenItemMoves(rule({ dueDay: 7 }), rule({ dueDay: 10 }), [
            item('a', '2026-04-01', '2026-04-30', '2026-05-10'),
            item('b', '2026-05-01', '2026-05-31', '2026-06-07'),
        ]);
        expect(plan.unchanged).toBe(1);
        expect(plan.moves).toEqual([{ id: 'b', from: '2026-06-07', to: '2026-06-10' }]);
    });

    it('keeps open items when the periodicity or period basis changes', () => {
        const items = [
            item('a', '2026-04-01', '2026-04-30', '2026-05-07'),
            item('b', '2026-05-01', '2026-05-31', '2026-06-07'),
        ];
        const next = [
            rule({ frequency: 'QUARTERLY' }),
            rule({ periodBasis: 'CALENDAR_YEAR' }),
            rule({ frequency: 'EVENT_BASED', dueDay: null, event: 'E', dueDaysAfterEvent: 30 }),
        ];
        for (const n of next) {
            expect(planOpenItemMoves(rule(), n, items)).toEqual({
                moves: [],
                unchanged: 0,
                kept: 2,
                reason: 'PERIODICITY_CHANGED',
            });
        }
    });

    it('recomputes event items from the event date', () => {
        const old = rule({ frequency: 'EVENT_BASED', dueDay: null, event: 'E', dueDaysAfterEvent: 30 });
        const ev = item('e', '2026-05-01', '2026-05-01', '2026-05-31');

        const longer = planOpenItemMoves(old, { ...old, dueDaysAfterEvent: 45 }, [ev]);
        expect(longer.moves).toEqual([{ id: 'e', from: '2026-05-31', to: '2026-06-15' }]);

        const renamed = planOpenItemMoves(old, { ...old, event: 'E2' }, [ev]);
        expect(renamed).toEqual({ moves: [], unchanged: 1, kept: 0, reason: 'NONE' });
    });

    it('keeps one-time items and items when the new rule has no due day', () => {
        const one = planOpenItemMoves(
            rule({ frequency: 'ONE_TIME', dueDay: null }),
            rule({ frequency: 'ONE_TIME', dueDay: 10 }),
            [item('a', '2026-04-01', '2026-04-01', '2026-04-01')],
        );
        expect(one).toEqual({ moves: [], unchanged: 0, kept: 1, reason: 'ONE_TIME' });

        const noDay = planOpenItemMoves(rule(), rule({ dueDay: null }), [
            item('a', '2026-04-01', '2026-04-30', '2026-05-07'),
        ]);
        expect(noDay).toEqual({ moves: [], unchanged: 0, kept: 1, reason: 'NO_DUE_RULE' });
    });

    it('uses the last day of a short month when the new day is 31', () => {
        const plan = planOpenItemMoves(rule({ dueDay: 7, dueMonthOffset: 0 }), rule({ dueDay: 31, dueMonthOffset: 0 }), [
            item('a', '2026-02-01', '2026-02-28', '2026-02-07'),
        ]);
        expect(plan.moves).toEqual([{ id: 'a', from: '2026-02-07', to: '2026-02-28' }]);
    });
});

describe('summarizePending', () => {
    const lib = (id: string, version: number): LibraryRule => ({ ...rule({ dueDay: 10 }), id, version });
    const pin = (complianceId: string, libraryVersion: number, count: number, o: Partial<Rule> = {}): PinGroup => ({
        ...rule(o),
        complianceId,
        libraryVersion,
        count,
    });

    it('lists only schedules that are behind the library, with the oldest version', () => {
        const out = summarizePending(
            [pin('c1', 1, 2, { dueDay: 7 }), pin('c1', 2, 1, { dueDay: 7 }), pin('c1', 3, 5, { dueDay: 10 }), pin('c2', 1, 4)],
            [lib('c1', 3), lib('c2', 1)],
        );
        expect(out).toEqual([{ id: 'c1', version: 3, fromVersion: 1, schedules: 3, needsDecision: true }]);
    });

    it('needs a decision only when a pinned rule differs from the library', () => {
        const out = summarizePending([pin('c1', 2, 3, { dueDay: 10 })], [lib('c1', 3)]);
        expect(out).toEqual([{ id: 'c1', version: 3, fromVersion: 2, schedules: 3, needsDecision: false }]);
    });

    it('ignores laws that are no longer in the library', () => {
        expect(summarizePending([pin('gone', 1, 1)], [lib('c1', 2)])).toEqual([]);
    });
});