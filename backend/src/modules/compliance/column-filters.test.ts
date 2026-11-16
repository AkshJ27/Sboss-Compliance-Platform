import { describe, it, expect } from 'vitest';
import { columnFilterWhere, columnFiltersField, orderFor, selectedIdsField } from './column-filters';

const ci = 'insensitive';

describe('columnFilterWhere', () => {
    it('turns each rule into a database condition', () => {
        expect(
            columnFilterWhere([
                {
                    col: 'owner',
                    match: 'all',
                    rules: [
                        { op: 'startsWith', value: 'Am' },
                        { op: 'notContains', value: 'x' },
                    ],
                },
            ]),
        ).toEqual({
            AND: [
                {
                    AND: [
                        { owner: { name: { startsWith: 'Am', mode: ci } } },
                        { NOT: { owner: { name: { contains: 'x', mode: ci } } } },
                    ],
                },
            ],
        });
    });

    it('uses OR for "match any" and reaches through the compliance and optional links', () => {
        expect(
            columnFilterWhere([
                { col: 'act', match: 'any', rules: [{ op: 'equals', value: 'Payment of Wages Act, 1936' }, { op: 'endsWith', value: '1948' }] },
                { col: 'vertical', match: 'all', rules: [{ op: 'notEquals', value: 'SBOSS' }] },
            ]),
        ).toEqual({
            AND: [
                {
                    OR: [
                        { compliance: { act: { name: { equals: 'Payment of Wages Act, 1936', mode: ci } } } },
                        { compliance: { act: { name: { endsWith: '1948', mode: ci } } } },
                    ],
                },
                { AND: [{ NOT: { vertical: { is: { name: { equals: 'SBOSS', mode: ci } } } } }] },
            ],
        });
    });
});

describe('orderFor', () => {
    it('sorts by due date by default', () => {
        expect(orderFor(undefined, 'asc')).toEqual([{ dueDate: 'asc' }, { id: 'asc' }]);
        expect(orderFor('dueDate', 'desc')).toEqual([{ dueDate: 'desc' }, { id: 'asc' }]);
    });

    it('sorts by another column, then due date, then id', () => {
        expect(orderFor('owner', 'desc')).toEqual([{ owner: { name: 'desc' } }, { dueDate: 'asc' }, { id: 'asc' }]);
        expect(orderFor('act', 'asc')[0]).toEqual({ compliance: { act: { name: 'asc' } } });
    });
});

describe('parsing from the address', () => {
    it('reads column filters from JSON and rejects bad ones', () => {
        const ok = columnFiltersField.safeParse(JSON.stringify([{ col: 'owner', rules: [{ op: 'contains', value: 'amita' }] }]));
        expect(ok.success).toBe(true);
        expect(ok.data).toEqual([{ col: 'owner', match: 'all', rules: [{ op: 'contains', value: 'amita' }] }]);
        expect(columnFiltersField.safeParse('not json').success).toBe(false);
        expect(columnFiltersField.safeParse(JSON.stringify([{ col: 'password', rules: [{ op: 'contains', value: 'a' }] }])).success).toBe(false);
        expect(columnFiltersField.safeParse(undefined).data).toBeUndefined();
    });

    it('reads ticked ids and limits how many', () => {
        const id = '3f9a2b10-aaaa-4bbb-8ccc-000000000000';
        expect(selectedIdsField.parse(`${id},${id}`)).toEqual([id]);
        const many = Array.from({ length: 101 }, (_, i) => `3f9a2b10-aaaa-4bbb-8ccc-${String(i).padStart(12, '0')}`).join(',');
        expect(selectedIdsField.safeParse(many).success).toBe(false);
    });
});