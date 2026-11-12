import { describe, it, expect } from 'vitest';
import { dueDateForPeriod, occurrences, type ScheduleRule } from './schedule.engine';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe('dueDateForPeriod', () => {
    it('June wages move from the 7th to the 10th of July', () => {
        expect(iso(dueDateForPeriod({ dueDay: 7, dueMonthOffset: 1 }, d('2026-06-30')))).toBe('2026-07-07');
        expect(iso(dueDateForPeriod({ dueDay: 10, dueMonthOffset: 1 }, d('2026-06-30')))).toBe('2026-07-10');
    });

    it('day 31 becomes the last day of a shorter month', () => {
        expect(iso(dueDateForPeriod({ dueDay: 31, dueMonthOffset: 0 }, d('2026-04-30')))).toBe('2026-04-30');
        expect(iso(dueDateForPeriod({ dueDay: 31, dueMonthOffset: 0 }, d('2027-02-28')))).toBe('2027-02-28');
        expect(iso(dueDateForPeriod({ dueDay: 31, dueMonthOffset: 0 }, d('2028-02-29')))).toBe('2028-02-29');
    });

    it('a due month that falls in the next year', () => {
        expect(iso(dueDateForPeriod({ dueDay: 7, dueMonthOffset: 1 }, d('2026-12-31')))).toBe('2027-01-07');
    });

    it('gives no date when there is no due day', () => {
        expect(dueDateForPeriod({ dueDay: null, dueMonthOffset: 1 }, d('2026-06-30'))).toBeNull();
    });

    it('agrees with occurrences() for several rules', () => {
        const rules: ScheduleRule[] = [
            { frequency: 'MONTHLY', periodBasis: 'FINANCIAL_YEAR', dueDay: 7, dueMonthOffset: 1 },
            { frequency: 'QUARTERLY', periodBasis: 'FINANCIAL_YEAR', dueDay: 31, dueMonthOffset: 1 },
            { frequency: 'HALF_YEARLY', periodBasis: 'CALENDAR_YEAR', dueDay: 15, dueMonthOffset: 2 },
            { frequency: 'ANNUAL', periodBasis: 'FINANCIAL_YEAR', dueDay: 30, dueMonthOffset: 6 },
        ];
        for (const r of rules) {
            const list = occurrences(r, d('2026-01-01'), d('2026-01-01'), d('2028-12-31'));
            expect(list.length).toBeGreaterThan(0);
            for (const o of list) expect(dueDateForPeriod(r, o.periodEnd)).toEqual(o.dueDate);
        }
    });
});