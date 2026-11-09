import { HttpError } from '../../lib/errors';
import { daysInMonth } from '../../lib/dates';

export type QuarterKey = 'Q1' | 'Q2' | 'Q3' | 'Q4';
export type PeriodKind = 'MONTH' | QuarterKey | 'YTD' | 'CUSTOM';

export type PeriodInput = {
    quarter?: QuarterKey | 'YTD';
    fy?: number; // the year the financial year starts in: 2026 means 2026-27
    dueFrom?: string;
    dueTo?: string;
};

export type Period = {
    kind: PeriodKind;
    from: string;
    to: string;
    label: string;
    financialYear: string | null;
};

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => daysInMonth(y, m - 1);

// The financial year starts in April
export function fyStartYear(date: string): number {
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    return m >= 4 ? y : y - 1;
}

export const fyLabel = (startYear: number) => `${startYear}-${pad((startYear + 1) % 100)}`;

export const fyRange = (startYear: number) => ({
    from: ymd(startYear, 4, 1),
    to: ymd(startYear + 1, 3, 31),
});

export function quarterOf(date: string): 1 | 2 | 3 | 4 {
    const m = Number(date.slice(5, 7));
    return (Math.floor(((m - 4 + 12) % 12) / 3) + 1) as 1 | 2 | 3 | 4;
}

export function quarterRange(startYear: number, q: 1 | 2 | 3 | 4) {
    switch (q) {
        case 1: return { from: ymd(startYear, 4, 1), to: ymd(startYear, 6, 30) };
        case 2: return { from: ymd(startYear, 7, 1), to: ymd(startYear, 9, 30) };
        case 3: return { from: ymd(startYear, 10, 1), to: ymd(startYear, 12, 31) };
        default: return { from: ymd(startYear + 1, 1, 1), to: ymd(startYear + 1, 3, 31) };
    }
}

// ['2026-04', ..., '2027-03']
export function monthsOfFy(startYear: number): string[] {
    return Array.from({ length: 12 }, (_, i) => {
        const m = 4 + i;
        const y = startYear + (m > 12 ? 1 : 0);
        return `${y}-${pad(((m - 1) % 12) + 1)}`;
    });
}

export function monthRange(key: string) {
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7));
    return { from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)) };
}

export const monthLabel = (key: string) =>
    `${MONTH_NAMES[Number(key.slice(5, 7)) - 1].slice(0, 3)} ${key.slice(0, 4)}`;

export function resolvePeriod(input: PeriodInput, today: string): Period {
    if (input.dueFrom && input.dueTo) {
        if (input.dueTo < input.dueFrom) throw new HttpError(400, 'dueTo must be on or after dueFrom');
        return {
            kind: 'CUSTOM',
            from: input.dueFrom,
            to: input.dueTo,
            label: `${input.dueFrom} to ${input.dueTo}`,
            financialYear: null,
        };
    }

    if (input.quarter) {
        const startYear = input.fy ?? fyStartYear(today);
        const financialYear = fyLabel(startYear);

        if (input.quarter === 'YTD') {
            const range = fyRange(startYear);
            if (range.from > today) {
                throw new HttpError(400, 'Year to date is only available for the current or a past financial year');
            }
            return {
                kind: 'YTD',
                from: range.from,
                to: today < range.to ? today : range.to,
                label: `YTD ${financialYear}`,
                financialYear,
            };
        }

        const range = quarterRange(startYear, Number(input.quarter.slice(1)) as 1 | 2 | 3 | 4);
        return { kind: input.quarter, ...range, label: `${input.quarter} ${financialYear}`, financialYear };
    }

    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    return {
        kind: 'MONTH',
        from: ymd(y, m, 1),
        to: ymd(y, m, lastDay(y, m)),
        label: `${MONTH_NAMES[m - 1]} ${y}`,
        financialYear: fyLabel(fyStartYear(today)),
    };
}