import { describe, it, expect } from 'vitest';
import { occurrences, type ScheduleRule } from './schedule.engine';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dues = (o: { dueDate: Date }[]) => o.map((x) => x.dueDate.toISOString().slice(0, 10));
const rule = (r: Partial<ScheduleRule> = {}): ScheduleRule => ({
    frequency: 'MONTHLY',
    periodBasis: 'FINANCIAL_YEAR',
    dueDay: 7,
    dueMonthOffset: 1,
    ...r,
});

describe('occurrences', () => {
    it('monthly wages: the June period is due on 7 July', () => {
        const o = occurrences(rule(), d('2026-01-01'), d('2026-04-01'), d('2027-03-31'));
        expect(o).toHaveLength(12);
        expect(o[0]).toEqual({
            periodStart: d('2026-03-01'),
            periodEnd: d('2026-03-31'),
            dueDate: d('2026-04-07'),
        });
        const june = o.find((x) => x.periodStart.getTime() === d('2026-06-01').getTime());
        expect(june?.dueDate).toEqual(d('2026-07-07'));
        expect(dues(o)[11]).toBe('2027-03-07');
    });

    it('quarterly with due day 31 uses the last day of shorter months', () => {
        const o = occurrences(
            rule({ frequency: 'QUARTERLY', dueDay: 31 }),
            d('2026-01-01'),
            d('2026-04-01'),
            d('2027-03-31'),
        );
        expect(dues(o)).toEqual(['2026-04-30', '2026-07-31', '2026-10-31', '2027-01-31']);
    });

    it('February: 28 in a normal year, 29 in a leap year', () => {
        const r = rule({ dueDay: 30, dueMonthOffset: 0 });
        expect(dues(occurrences(r, d('2027-01-01'), d('2027-02-01'), d('2027-02-28')))).toEqual(['2027-02-28']);
        expect(dues(occurrences(r, d('2028-01-01'), d('2028-02-01'), d('2028-02-29')))).toEqual(['2028-02-29']);
    });

    it('annual on a financial year basis', () => {
        const r = rule({ frequency: 'ANNUAL', dueDay: 30, dueMonthOffset: 6 });
        const o = occurrences(r, d('2026-04-01'), d('2027-04-01'), d('2028-03-31'));
        expect(o).toEqual([
            { periodStart: d('2026-04-01'), periodEnd: d('2027-03-31'), dueDate: d('2027-09-30') },
        ]);
    });

    it('annual on a calendar year basis', () => {
        const r = rule({ frequency: 'ANNUAL', periodBasis: 'CALENDAR_YEAR', dueDay: 31, dueMonthOffset: 3 });
        const o = occurrences(r, d('2026-01-01'), d('2027-01-01'), d('2027-12-31'));
        expect(o).toEqual([
            { periodStart: d('2026-01-01'), periodEnd: d('2026-12-31'), dueDate: d('2027-03-31') },
        ]);
    });

    it('half-yearly on a financial year basis', () => {
        const r = rule({ frequency: 'HALF_YEARLY', dueDay: 30 });
        const o = occurrences(r, d('2026-01-01'), d('2026-04-01'), d('2027-03-31'));
        expect(dues(o)).toEqual(['2026-04-30', '2026-10-30']);
    });

    it('skips periods that ended before the start date', () => {
        const o = occurrences(rule(), d('2026-09-01'), d('2026-04-01'), d('2027-03-31'));
        expect(o).toHaveLength(6);
        expect(dues(o)[0]).toBe('2026-10-07');
    });

    it('includes due dates exactly on the range edges', () => {
        const o = occurrences(rule(), d('2026-01-01'), d('2026-04-07'), d('2026-04-07'));
        expect(dues(o)).toEqual(['2026-04-07']);
    });

    it('does not create event-based items from the calendar', () => {
        const r = rule({ frequency: 'EVENT_BASED', dueDay: null });
        expect(occurrences(r, d('2026-01-01'), d('2026-01-01'), d('2026-12-31'))).toEqual([]);
    });

    it('one-time: due on the start date when there is no due day', () => {
        const r = rule({ frequency: 'ONE_TIME', dueDay: null, dueMonthOffset: 0 });
        const o = occurrences(r, d('2026-06-15'), d('2026-06-01'), d('2026-06-30'));
        expect(o).toEqual([
            { periodStart: d('2026-06-15'), periodEnd: d('2026-06-15'), dueDate: d('2026-06-15') },
        ]);
    });

    it('one-time: never due before the start date', () => {
        const r = rule({ frequency: 'ONE_TIME', dueDay: 7, dueMonthOffset: 0 });
        const o = occurrences(r, d('2026-06-15'), d('2026-06-01'), d('2026-06-30'));
        expect(dues(o)).toEqual(['2026-06-15']);
    });
});