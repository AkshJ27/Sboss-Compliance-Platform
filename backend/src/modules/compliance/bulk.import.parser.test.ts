import { describe, it, expect } from 'vitest';
import { MAX_ROWS, parseDateCell, parseScheduleCsv, templateCsv } from './bulk.import.parser';

const HEADER = 'entity,location,compliance code,owner email,manager email,approver email,department,vertical,start date';
const csv = (...lines: string[]) => Buffer.from(lines.join('\r\n'), 'utf8');

describe('parseDateCell', () => {
    it('accepts ISO and day-first formats', () => {
        expect(parseDateCell('2026-04-01')).toBe('2026-04-01');
        expect(parseDateCell('1-4-2026')).toBe('2026-04-01');
        expect(parseDateCell('01/04/2026')).toBe('2026-04-01');
        expect(parseDateCell('1.4.2026')).toBe('2026-04-01');
        expect(parseDateCell(' 2026-4-1 ')).toBe('2026-04-01');
    });

    it('reads the day first, never the month', () => {
        expect(parseDateCell('04-01-2026')).toBe('2026-01-04');
        expect(parseDateCell('13/01/2026')).toBe('2026-01-13');
        expect(parseDateCell('01/13/2026')).toBeNull();
    });

    it('rejects dates that do not exist', () => {
        expect(parseDateCell('31-02-2026')).toBeNull();
        expect(parseDateCell('2026-02-30')).toBeNull();
        expect(parseDateCell('2026-13-01')).toBeNull();
        expect(parseDateCell('00-01-2026')).toBeNull();
        expect(parseDateCell('29-02-2028')).toBe('2028-02-29');
        expect(parseDateCell('29-02-2027')).toBeNull();
    });

    it('rejects other text and years that are out of range', () => {
        for (const s of ['tomorrow', '', '2026/04/01', '1999-01-01', '2101-01-01', '45000', '1-Apr-26']) {
            expect(parseDateCell(s)).toBeNull();
        }
    });
});

describe('parseScheduleCsv', () => {
    it('reads rows with loose headers and trims and normalizes the values', () => {
        const r = parseScheduleCsv(
            csv(
                'Entity,Location Name,Compliance Code,Owner Email,Manager Email,Approver Email,Department,Vertical,Start Date',
                ' acme ,  Pune Plant ,sample-001, Ravi@Acme.Test ,meera@acme.test,,Human Resources,,1-4-2026',
            ),
        );
        expect(r.errors).toEqual([]);
        expect(r.rows).toEqual([
            {
                row: 1,
                entity: 'acme',
                location: 'Pune Plant',
                code: 'SAMPLE-001',
                owner: 'ravi@acme.test',
                manager: 'meera@acme.test',
                approver: null,
                department: 'Human Resources',
                vertical: null,
                startDate: '2026-04-01',
            },
        ]);
    });

    it('matches header names ignoring case, spaces and punctuation', () => {
        const r = parseScheduleCsv(csv('ENTITY,location_name,Compliance-Code,owner,MANAGER', 'ACME,Pune,C1,a@b.co,c@d.co'));
        expect(r.errors).toEqual([]);
        expect(r.rows[0]).toMatchObject({ entity: 'ACME', location: 'Pune', code: 'C1', approver: null, startDate: null });
    });

    it('reports columns it does not recognise', () => {
        const r = parseScheduleCsv(csv(`${HEADER},Comments`, 'ACME,Pune,C1,a@b.co,c@d.co,,,,,hello'));
        expect(r.ignoredColumns).toEqual(['Comments']);
        expect(r.rows).toHaveLength(1);
    });

    it('strips the byte order mark and skips blank and comma-only lines', () => {
        const r = parseScheduleCsv(
            Buffer.from(`\uFEFF${HEADER}\r\n\r\nACME,Pune,C1,a@b.co,c@d.co,,,,\r\n,,,,,,,,\r\n`, 'utf8'),
        );
        expect(r.errors).toEqual([]);
        expect(r.rows).toHaveLength(1);
        expect(r.totalRows).toBe(1);
    });

    it('keeps commas inside quoted values', () => {
        const r = parseScheduleCsv(csv(HEADER, 'ACME,"Pune, Plant",C1,a@b.co,c@d.co,,,,'));
        expect(r.rows[0].location).toBe('Pune, Plant');
    });

    it('treats empty optional cells as missing', () => {
        const r = parseScheduleCsv(csv(HEADER, 'ACME,Pune,C1,a@b.co,c@d.co,,,,'));
        expect(r.rows[0]).toMatchObject({ approver: null, department: null, vertical: null, startDate: null });
    });

    it('reports row problems with their row numbers and keeps the good rows', () => {
        const r = parseScheduleCsv(
            csv(
                HEADER,
                'ACME,Pune,C1,a@b.co,c@d.co,,,,',
                'ACME,,C1,not-an-email,c@d.co,,,,',
                'ACME,Pune,C1,a@b.co,c@d.co,,,,31-02-2026',
            ),
        );
        expect(r.rows).toHaveLength(1);
        expect(r.totalRows).toBe(3);
        expect(r.errors).toEqual([
            { row: 2, field: 'location', message: 'This is required' },
            { row: 2, field: 'owner email', message: 'Enter a valid email address' },
            { row: 3, field: 'start date', message: 'Use YYYY-MM-DD or DD-MM-YYYY' },
        ]);
    });

    it('refuses a file with no data rows', () => {
        expect(() => parseScheduleCsv(csv(HEADER))).toThrow('The file has no data rows');
    });

    it('refuses a file that lacks required columns', () => {
        expect(() => parseScheduleCsv(csv('entity,location', 'ACME,Pune'))).toThrow(
            'Missing required columns: compliance code, owner email, manager email',
        );
    });

    it('refuses a file where a column appears twice', () => {
        expect(() =>
            parseScheduleCsv(csv('entity,Entity,location,compliance code,owner email,manager email', 'A,B,C,D,e@f.co,g@h.co')),
        ).toThrow(/appear more than once: Entity/);
    });

    it('refuses a file with too many rows', () => {
        const lines = [HEADER, ...Array.from({ length: MAX_ROWS + 1 }, () => 'ACME,Pune,C1,a@b.co,c@d.co,,,,')];
        expect(() => parseScheduleCsv(csv(...lines))).toThrow(/Too many rows/);
    });

    it('refuses a row with the wrong number of columns', () => {
        expect(() => parseScheduleCsv(csv(HEADER, 'ACME,Pune,C1,a@b.co,c@d.co,,,,,EXTRA'))).toThrow(/Could not read the CSV/);
    });

    it('the downloadable template has the headings only, and they read back', () => {
        const lines = templateCsv().replace(/^\uFEFF/, '').trim().split('\r\n');
        expect(lines).toHaveLength(1);
        const r = parseScheduleCsv(Buffer.from(templateCsv() + 'ACME,Pune Plant,C1,owner@x.co,manager@x.co,,,,\r\n', 'utf8'));
        expect(r.errors).toEqual([]);
        expect(r.ignoredColumns).toEqual([]);
        expect(r.rows).toHaveLength(1);
    });

    it('refuses an empty file', () => {
        expect(() => parseScheduleCsv(Buffer.from(''))).toThrow('The file is empty');
    });
});