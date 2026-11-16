import { describe, it, expect } from 'vitest';
import { UPDATE_COLUMNS, changedEditable, checkEditable, parseUpdateSheet } from './internal.update';

const values = {
    title: 'Monthly MIS',
    description: 'Send it',
    attachment: 'M',
    proofOfCompliance: '',
    risk: 'h',
    applicability: 'All offices',
    penalty: '',
    alertOwnerDays: '7',
    alertManagerDays: '3',
    isActive: 'Y',
};
const header = UPDATE_COLUMNS.map((c) => c.header);
const rowOf = (code: string, v: Record<string, string>) => UPDATE_COLUMNS.map((c) => (c.key === 'code' ? code : v[c.key] ?? ''));

describe('checkEditable', () => {
    it('turns letters into stored values', () => {
        const { fields, errors } = checkEditable(values, 2);
        expect(errors).toEqual([]);
        expect(fields).toEqual({
            title: 'Monthly MIS', description: 'Send it', attachment: 'MANDATORY', proofOfCompliance: null, risk: 'HIGH',
            applicability: 'All offices', penalty: null, alertOwnerDays: 7, alertManagerDays: 3, isActive: true,
        });
    });

    it('reports bad values', () => {
        const { fields, errors } = checkEditable({ ...values, risk: 'x', isActive: 'maybe', alertOwnerDays: '2' }, 4);
        expect(fields).toBeNull();
        expect(errors.map((e) => e.field)).toEqual(['risk', 'active', 'alert owner']);
    });
});

describe('parseUpdateSheet', () => {
    it('reads rows by code and catches repeats', () => {
        const out = parseUpdateSheet(header, [rowOf('ic1-0001', values), rowOf('IC1-0001', values), rowOf('', values)], 100);
        expect(out.fileErrors).toEqual([]);
        expect(out.rows).toEqual([expect.objectContaining({ row: 2, code: 'IC1-0001' })]);
        expect(out.errors.map((e) => [e.row, e.message])).toEqual([
            [3, 'Same code as row 2'],
            [4, 'This is required'],
        ]);
    });

    it('needs every column of the format', () => {
        expect(parseUpdateSheet(['Compliance Code (do not change)'], [['x']], 100).fileErrors[0]).toContain('Missing columns');
    });
});

describe('changedEditable', () => {
    it('keeps only what changed', () => {
        const before = checkEditable(values, 1).fields!;
        const after = { ...before, risk: 'LOW' as const, isActive: false };
        expect(changedEditable(before, after)).toEqual({ risk: 'LOW', isActive: false });
        expect(changedEditable(before, before)).toEqual({});
    });
});