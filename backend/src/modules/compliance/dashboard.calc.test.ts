import { describe, it, expect } from 'vitest';
import {
    addInto, bucket, countsByDay, emptyCounts, percentOf, totalOf,
    type DayRow, type StatusCounts,
} from './dashboard.calc';

const TODAY = '2026-11-09';

describe('countsByDay', () => {
    it('classifies every stored status', () => {
        const rows: DayRow[] = [
            { due: '2026-11-01', status: 'DUE', count: 3 },
            { due: '2026-11-20', status: 'DUE', count: 2 },
            { due: '2026-11-01', status: 'CLOSED', count: 5 },
            { due: '2026-11-01', status: 'SUBMITTED', count: 1 },
            { due: '2026-11-01', status: 'MANAGER_APPROVED', count: 1 },
            { due: '2026-11-01', status: 'NOT_APPLICABLE', count: 2 },
            { due: '2026-10-01', status: 'RETURNED', count: 1 },
        ];
        const days = countsByDay(rows, [{ due: '2026-11-01', count: 2 }], TODAY);

        expect(days.get('2026-11-01')).toEqual({
            nonCompliance: 3, lateClosure: 2, onTime: 3, due: 0, notApplicable: 2, pendingApproval: 2,
        });
        expect(days.get('2026-11-20')).toEqual({ ...emptyCounts(), due: 2 });
        expect(days.get('2026-10-01')).toEqual({ ...emptyCounts(), nonCompliance: 1 });
    });

    it('an open item due today is still due', () => {
        const days = countsByDay(
            [
                { due: TODAY, status: 'DUE', count: 1 },
                { due: '2026-11-08', status: 'DUE', count: 1 },
            ],
            [],
            TODAY,
        );
        expect(days.get(TODAY)).toEqual({ ...emptyCounts(), due: 1 });
        expect(days.get('2026-11-08')).toEqual({ ...emptyCounts(), nonCompliance: 1 });
    });

    it('late closures come out of on time', () => {
        const days = countsByDay(
            [{ due: '2026-11-01', status: 'CLOSED', count: 4 }],
            [{ due: '2026-11-01', count: 3 }],
            TODAY,
        );
        expect(days.get('2026-11-01')).toEqual({ ...emptyCounts(), onTime: 1, lateClosure: 3 });
    });

    it('never goes below zero', () => {
        const days = countsByDay(
            [{ due: '2026-11-01', status: 'CLOSED', count: 1 }],
            [{ due: '2026-11-01', count: 2 }],
            TODAY,
        );
        expect(days.get('2026-11-01')?.onTime).toBe(0);
    });
});

describe('bucket and totals', () => {
    it('adds up buckets and skips unwanted keys', () => {
        const days = new Map<string, StatusCounts>([
            ['2026-11-01', { ...emptyCounts(), due: 1, onTime: 2 }],
            ['2026-11-20', { ...emptyCounts(), due: 3 }],
            ['2026-12-01', { ...emptyCounts(), nonCompliance: 4 }],
            ['2025-01-01', { ...emptyCounts(), due: 9 }],
        ]);
        const b = bucket(days, (d) => (d.startsWith('2025') ? null : d.slice(0, 7)));

        expect([...b.keys()].sort()).toEqual(['2026-11', '2026-12']);
        expect(b.get('2026-11')).toEqual({ ...emptyCounts(), due: 4, onTime: 2 });
        expect(b.get('2026-12')).toEqual({ ...emptyCounts(), nonCompliance: 4 });
    });

    it('rounds percentages to one decimal', () => {
        expect(percentOf(1, 3)).toBe(33.3);
        expect(percentOf(2, 3)).toBe(66.7);
        expect(percentOf(5, 5)).toBe(100);
        expect(percentOf(0, 0)).toBe(0);
    });

    it('adds and totals counts', () => {
        const a = { ...emptyCounts(), due: 2, onTime: 1 };
        addInto(a, { ...emptyCounts(), due: 3, notApplicable: 4 });
        expect(a).toEqual({ ...emptyCounts(), due: 5, onTime: 1, notApplicable: 4 });
        expect(totalOf(a)).toBe(10);
    });
});