import { Frequency, PeriodBasis } from '@prisma/client';
import { daysInMonth, utcDate } from '../../lib/dates';

export type ScheduleRule = {
    frequency: Frequency;
    periodBasis: PeriodBasis;
    dueDay: number | null;
    dueMonthOffset: number;
};

export type Occurrence = { periodStart: Date; periodEnd: Date; dueDate: Date };

const LENGTH = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12 } as const;
const APRIL = 3; // zero-based month the financial year starts in

// A month as one number, so month arithmetic never has to think about years
const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
const firstOf = (idx: number) => utcDate(Math.floor(idx / 12), idx % 12, 1);

const lastOf = (idx: number) => {
    const y = Math.floor(idx / 12);
    const m = idx % 12;
    return utcDate(y, m, daysInMonth(y, m));
};

// Day 31 in a 30-day month (or 30 in February) becomes the last day of that month
const dueOn = (idx: number, day: number) => {
    const y = Math.floor(idx / 12);
    const m = idx % 12;
    return utcDate(y, m, Math.min(day, daysInMonth(y, m)));
};

/**
 * Periods whose due date falls between `from` and `to` (inclusive), skipping
 * periods that ended before the schedule's start date.
 *
 * due date = last month of the period + dueMonthOffset months, on dueDay.
 * Example: June wages, dueDay 7, offset 1 -> 7 July.
 */
export function occurrences(rule: ScheduleRule, start: Date, from: Date, to: Date): Occurrence[] {
    if (rule.frequency === 'EVENT_BASED') return []; // created by a trigger, not the calendar

    const startT = start.getTime();
    const inRange = (d: Date) => d.getTime() >= from.getTime() && d.getTime() <= to.getTime();

    if (rule.frequency === 'ONE_TIME') {
        let due = start;
        if (rule.dueDay != null) {
            const computed = dueOn(monthIndex(start) + rule.dueMonthOffset, rule.dueDay);
            if (computed.getTime() > startT) due = computed; // never due before the start date
        }
        return inRange(due) ? [{ periodStart: start, periodEnd: start, dueDate: due }] : [];
    }

    if (rule.dueDay == null) return [];

    const len = LENGTH[rule.frequency as keyof typeof LENGTH];
    const anchor = rule.periodBasis === 'FINANCIAL_YEAR' ? APRIL : 0;

    // First month of the period that contains the given month
    const periodStartOf = (idx: number) => idx - ((((idx % 12) - anchor) % len) + len) % len;

    const lastDueMonth = monthIndex(to);
    const out: Occurrence[] = [];

    // Begin early enough to catch periods whose due date lands inside the range
    let ps = periodStartOf(monthIndex(from) - rule.dueMonthOffset - len);
    for (; ; ps += len) {
        const pe = ps + len - 1;
        const dueMonth = pe + rule.dueMonthOffset;
        if (dueMonth > lastDueMonth) break;

        const periodEnd = lastOf(pe);
        if (periodEnd.getTime() < startT) continue;

        const dueDate = dueOn(dueMonth, rule.dueDay);
        if (inRange(dueDate)) out.push({ periodStart: firstOf(ps), periodEnd, dueDate });
    }
    return out;
}