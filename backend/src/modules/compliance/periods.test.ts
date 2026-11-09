import { describe, it, expect } from 'vitest';
import {
    fyLabel, fyStartYear, monthRange, monthsOfFy, quarterOf, resolvePeriod,
} from './periods';

const TODAY = '2026-11-09';

describe('financial year helpers', () => {
    it('finds the financial year of a date', () => {
        expect(fyStartYear('2026-03-31')).toBe(2025);
        expect(fyStartYear('2026-04-01')).toBe(2026);
        expect(fyStartYear('2026-12-31')).toBe(2026);
        expect(fyStartYear('2027-01-01')).toBe(2026);
    });

    it('labels a financial year', () => {
        expect(fyLabel(2026)).toBe('2026-27');
        expect(fyLabel(2009)).toBe('2009-10');
        expect(fyLabel(2099)).toBe('2099-00');
    });

    it('finds the quarter of a date', () => {
        expect(quarterOf('2026-04-01')).toBe(1);
        expect(quarterOf('2026-06-30')).toBe(1);
        expect(quarterOf('2026-07-01')).toBe(2);
        expect(quarterOf('2026-09-30')).toBe(2);
        expect(quarterOf('2026-10-01')).toBe(3);
        expect(quarterOf('2026-12-31')).toBe(3);
        expect(quarterOf('2027-01-01')).toBe(4);
        expect(quarterOf('2027-03-31')).toBe(4);
    });

    it('lists the months of a financial year', () => {
        const m = monthsOfFy(2026);
        expect(m).toHaveLength(12);
        expect(m[0]).toBe('2026-04');
        expect(m[8]).toBe('2026-12');
        expect(m[9]).toBe('2027-01');
        expect(m[11]).toBe('2027-03');
    });

    it('gives the first and last day of a month', () => {
        expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
        expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    });
});

describe('resolvePeriod', () => {
    it('defaults to the current month', () => {
        expect(resolvePeriod({}, TODAY)).toEqual({
            kind: 'MONTH',
            from: '2026-11-01',
            to: '2026-11-30',
            label: 'November 2026',
            financialYear: '2026-27',
        });
    });

    it('handles February in normal and leap years', () => {
        expect(resolvePeriod({}, '2028-02-10').to).toBe('2028-02-29');
        expect(resolvePeriod({}, '2027-02-10').to).toBe('2027-02-28');
    });

    it('gives the four quarters of the current financial year', () => {
        expect(resolvePeriod({ quarter: 'Q1' }, TODAY)).toMatchObject({ from: '2026-04-01', to: '2026-06-30', label: 'Q1 2026-27' });
        expect(resolvePeriod({ quarter: 'Q2' }, TODAY)).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
        expect(resolvePeriod({ quarter: 'Q3' }, TODAY)).toMatchObject({ from: '2026-10-01', to: '2026-12-31' });
        expect(resolvePeriod({ quarter: 'Q4' }, TODAY)).toMatchObject({ from: '2027-01-01', to: '2027-03-31' });
    });

    it('puts January to March in the financial year that started the previous April', () => {
        expect(resolvePeriod({ quarter: 'Q4' }, '2027-02-01')).toMatchObject({ from: '2027-01-01', to: '2027-03-31' });
        expect(resolvePeriod({ quarter: 'Q1' }, '2027-02-01')).toMatchObject({ from: '2026-04-01', to: '2026-06-30' });
    });

    it('uses the financial year that is asked for', () => {
        expect(resolvePeriod({ quarter: 'Q2', fy: 2025 }, TODAY)).toMatchObject({
            from: '2025-07-01',
            to: '2025-09-30',
            label: 'Q2 2025-26',
        });
    });

    it('year to date runs from April to today', () => {
        expect(resolvePeriod({ quarter: 'YTD' }, TODAY)).toMatchObject({
            kind: 'YTD',
            from: '2026-04-01',
            to: TODAY,
            label: 'YTD 2026-27',
        });
    });

    it('year to date for a past year is the whole year', () => {
        expect(resolvePeriod({ quarter: 'YTD', fy: 2025 }, TODAY)).toMatchObject({
            from: '2025-04-01',
            to: '2026-03-31',
        });
    });

    it('rejects year to date for a future year', () => {
        expect(() => resolvePeriod({ quarter: 'YTD', fy: 2027 }, TODAY)).toThrow(/current or a past/);
    });

    it('accepts a custom range and rejects a reversed one', () => {
        expect(resolvePeriod({ dueFrom: '2026-01-01', dueTo: '2026-01-31' }, TODAY)).toMatchObject({
            kind: 'CUSTOM',
            from: '2026-01-01',
            to: '2026-01-31',
            financialYear: null,
        });
        expect(() => resolvePeriod({ dueFrom: '2026-05-01', dueTo: '2026-04-01' }, TODAY)).toThrow(/on or after/);
    });
});