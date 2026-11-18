// The due rule of a library compliance in words, the same as the Browse screen shows it. No database, so it is easy to test.

const PERIOD_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12 };

type DueFields = { frequency: string; dueDay: number | null; dueMonthOffset: number; event: string | null; dueDaysAfterEvent: number | null };

export function dueRuleText(c: DueFields): string {
    if (c.frequency === 'EVENT_BASED') return `${c.dueDaysAfterEvent ?? '?'} days after: ${c.event ?? '?'}`;
    if (c.frequency === 'ONE_TIME') return c.dueDay ? `Day ${c.dueDay}` : 'On the start date';
    if (c.dueDay == null) return '';
    const months = (n: number) => `${n} month${n === 1 ? '' : 's'}`;
    const when =
        c.dueMonthOffset === 0
            ? 'in the last month of the period'
            : c.dueMonthOffset === 1 - (PERIOD_MONTHS[c.frequency] ?? 1)
                ? 'in the first month of the period'
                : c.dueMonthOffset < 0
                    ? `${months(-c.dueMonthOffset)} before the last month of the period`
                    : `${months(c.dueMonthOffset)} after the period`;
    return `Day ${c.dueDay}, ${when}`;
}