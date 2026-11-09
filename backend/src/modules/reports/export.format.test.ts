import { describe, it, expect } from 'vitest';
import { neutralize, toCsv, type Column } from './export.format';

type Row = { a: string | null | undefined; b: number | null };
const cols: Column<Row>[] = [
    { header: 'A', width: 10, get: (r) => r.a },
    { header: 'B', width: 10, get: (r) => r.b },
];

describe('neutralize', () => {
    it('prefixes every character a spreadsheet treats as a formula', () => {
        for (const v of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
            expect(neutralize(v)).toBe(`'${v}`);
        }
    });

    it('leaves safe values alone', () => {
        expect(neutralize('hello')).toBe('hello');
        expect(neutralize('')).toBe('');
        expect(neutralize('2026-11-09')).toBe('2026-11-09');
        expect(neutralize(15000.5)).toBe(15000.5);
        expect(neutralize(-5)).toBe(-5);
        expect(neutralize(null)).toBeNull();
        expect(neutralize(undefined)).toBeNull();
    });
});

describe('toCsv', () => {
    it('quotes fields with commas, quotes and line breaks', () => {
        const csv = toCsv(
            [{ a: 'a,b', b: 1 }, { a: 'say "hi"', b: 2 }, { a: 'line1\nline2', b: 3 }],
            cols,
        );
        expect(csv).toContain('"a,b",1');
        expect(csv).toContain('"say ""hi""",2');
        expect(csv).toContain('"line1\nline2",3');
    });

    it('starts with a byte order mark and uses CRLF line endings', () => {
        expect(toCsv([{ a: 'x', b: 1 }], cols)).toBe('\uFEFFA,B\r\nx,1\r\n');
    });

    it('neutralizes formula text and writes empty cells for missing values', () => {
        expect(toCsv([{ a: '=cmd', b: null }], cols)).toBe("\uFEFFA,B\r\n'=cmd,\r\n");
    });

    it('writes only the header when there are no rows', () => {
        expect(toCsv([], cols)).toBe('\uFEFFA,B\r\n');
    });
});