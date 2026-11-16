import { describe, it, expect } from 'vitest';
import { emptyCounts } from '../compliance/dashboard.calc';
import { baseFieldOf, buildSummary, onTimePercentOf, type MoneyRow, type StatusCountRow } from './summary.calc';

const same = (base: string | null) => base;
const name = (key: string | null) => (key === null ? 'Not set' : key.toUpperCase());

describe('baseFieldOf', () => {
    it('groups compliance details through the compliance and state through the location', () => {
        expect(baseFieldOf('actId')).toBe('complianceId');
        expect(baseFieldOf('lawCategoryId')).toBe('complianceId');
        expect(baseFieldOf('risk')).toBe('complianceId');
        expect(baseFieldOf('frequency')).toBe('complianceId');
        expect(baseFieldOf('state')).toBe('locationId');
        expect(baseFieldOf('entityId')).toBe('entityId');
        expect(baseFieldOf('ownerId')).toBe('ownerId');
    });
});

describe('onTimePercentOf', () => {
    it('counts only items that have an outcome', () => {
        const c = { ...emptyCounts(), onTime: 3, lateClosure: 1, nonCompliance: 0, due: 50, notApplicable: 9 };
        expect(onTimePercentOf(c)).toBe(75);
    });

    it('is empty when nothing has an outcome yet', () => {
        expect(onTimePercentOf({ ...emptyCounts(), due: 4, pendingApproval: 2 })).toBeNull();
    });
});

describe('buildSummary', () => {
    it('adds counts and money into groups and a total', () => {
        const counts: StatusCountRow[] = [
            { base: 'a', status: 'onTime', count: 4 },
            { base: 'a', status: 'nonCompliance', count: 1 },
            { base: 'b', status: 'nonCompliance', count: 3 },
            { base: 'b', status: 'notApplicable', count: 2 },
        ];
        const money: MoneyRow[] = [
            { base: 'a', payable: 100.1, paid: 100.1, penalty: 0 },
            { base: 'b', payable: 50, paid: 20, penalty: 5.25 },
        ];
        const { rows, totals } = buildSummary(counts, money, same, name);

        expect(rows.map((r) => r.key)).toEqual(['b', 'a']); // most non compliance first
        expect(rows[0]).toMatchObject({
            label: 'B',
            total: 5,
            applicable: 3,
            decided: 3,
            onTimePercent: 0,
            money: { payable: 50, paid: 20, penalty: 5.25 },
        });
        expect(rows[1]).toMatchObject({ total: 5, decided: 5, onTimePercent: 80 });
        expect(totals).toMatchObject({
            key: null,
            label: 'Total',
            total: 10,
            applicable: 8,
            counts: { ...emptyCounts(), onTime: 4, nonCompliance: 4, notApplicable: 2 },
            onTimePercent: 50,
            money: { payable: 150.1, paid: 120.1, penalty: 5.25 },
        });
    });

    it('merges several base values into one group', () => {
        const act: Record<string, string> = { c1: 'act1', c2: 'act1', c3: 'act2' };
        const counts: StatusCountRow[] = [
            { base: 'c1', status: 'due', count: 2 },
            { base: 'c2', status: 'due', count: 3 },
            { base: 'c3', status: 'due', count: 1 },
        ];
        const { rows } = buildSummary(counts, [], (b) => (b ? act[b] : null), name);
        expect(rows.map((r) => [r.key, r.total])).toEqual([
            ['act1', 5],
            ['act2', 1],
        ]);
    });

    it('keeps items with no value as their own group', () => {
        const counts: StatusCountRow[] = [
            { base: null, status: 'due', count: 2 },
            { base: 'x', status: 'due', count: 2 },
        ];
        const { rows } = buildSummary(counts, [], same, name);
        expect(rows.map((r) => [r.key, r.label])).toEqual([
            ['x', 'X'],
            [null, 'Not set'],
        ]);
    });

    it('gives an empty report when there are no items', () => {
        const { rows, totals } = buildSummary([], [], same, name);
        expect(rows).toEqual([]);
        expect(totals.total).toBe(0);
        expect(totals.onTimePercent).toBeNull();
    });
});