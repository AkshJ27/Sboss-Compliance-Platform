import { describe, it, expect } from 'vitest';
import { occurrences } from '../compliance/schedule.engine';
import {
    UPLOAD_COLUMNS, cellText, dueRuleFor, normHeader, parseDayMonthYear, parseInternalRow, parseInternalSheet, parsePeriodicity,
} from './internal.parser';
import type { InternalKey } from './internal.parser';

const good: Partial<Record<InternalKey, string>> = {
    title: 'Submit monthly MIS to board',
    description: 'Prepare and send the MIS pack',
    periodicity: 'M',
    onDay: '10',
    startEnd: 'E',
    yearBasis: 'F',
    effectiveDate: '01-Apr-2026',
    attachment: 'O',
    risk: 'M',
    entity: 'SBOSS',
    department: 'Finance',
    location: 'New Delhi',
    owner: 'Owner@Example.com',
    alertOwner: '7',
    manager: 'manager@example.com',
    alertManager: '3',
    vertical: 'SBOSS',
};

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe('headers and cells', () => {
    it("matches Complinity's headers without their notes", () => {
        expect(normHeader('Compliance Name (Length=500)*')).toBe('compliancename');
        expect(normHeader('Effective Date(dd-Mon-yyyy(01-Jan-2018))*')).toBe('effectivedate');
        expect(normHeader('Start/End Period (S/E)*')).toBe('startendperiod');
        expect(normHeader('Event Name (Length=500) (Enter If Periodicity is E)')).toBe('eventname');
    });

    it('reads links, rich text, formulas and dates', () => {
        expect(cellText({ text: 'a@b.com', hyperlink: 'mailto:a@b.com' })).toBe('a@b.com');
        expect(cellText({ richText: [{ text: 'Fin' }, { text: 'ance ' }] })).toBe('Finance');
        expect(cellText({ formula: 'A1', result: 12 })).toBe('12');
        expect(cellText(new Date(Date.UTC(2026, 3, 1)))).toBe('2026-04-01');
        expect(cellText(null)).toBe('');
    });

    it('reads dates with month names or numbers', () => {
        expect(parseDayMonthYear('01-Jan-2018')).toBe('2018-01-01');
        expect(parseDayMonthYear('5 September 2026')).toBe('2026-09-05');
        expect(parseDayMonthYear('31-02-2026')).toBeNull();
        expect(parseDayMonthYear('2026-04-01')).toBe('2026-04-01');
        expect(parseDayMonthYear('01-Foo-2026')).toBeNull();
    });
});

describe('periodicity', () => {
    it('accepts letters and words', () => {
        expect(parsePeriodicity('m')).toBe('MONTHLY');
        expect(parsePeriodicity('Half Yearly')).toBe('HALF_YEARLY');
        expect(parsePeriodicity('E')).toBe('EVENT_BASED');
    });

    it('says which periodicities are not supported yet', () => {
        expect(parsePeriodicity('W')).toEqual({ error: expect.stringContaining('Weekly is not supported') });
        expect(parsePeriodicity('x')).toEqual({ error: expect.stringContaining('Use M') });
    });
});

describe('dueRuleFor', () => {
    it('E: that day of the month after the period', () => {
        const r = dueRuleFor('MONTHLY', 10, false, null);
        const [june] = occurrences({ ...r, periodBasis: 'FINANCIAL_YEAR' }, d('2026-04-01'), d('2026-07-01'), d('2026-07-31'));
        expect(iso(june.periodStart)).toBe('2026-06-01');
        expect(iso(june.dueDate)).toBe('2026-07-10');
    });

    it('S: that day of the first month of the period', () => {
        const r = dueRuleFor('QUARTERLY', 15, true, null);
        expect(r.dueMonthOffset).toBe(-2);
        const out = occurrences({ ...r, periodBasis: 'FINANCIAL_YEAR' }, d('2026-04-01'), d('2026-04-01'), d('2027-03-31'));
        expect(out.map((o) => [iso(o.periodStart), iso(o.dueDate)])).toEqual([
            ['2026-04-01', '2026-04-15'],
            ['2026-07-01', '2026-07-15'],
            ['2026-10-01', '2026-10-15'],
            ['2027-01-01', '2027-01-15'],
        ]);
    });

    it('S on a monthly item is due in the same month', () => {
        expect(dueRuleFor('MONTHLY', 5, true, null).dueMonthOffset).toBe(0);
    });

    it('event based: days after the event', () => {
        expect(dueRuleFor('EVENT_BASED', 30, false, 'New hire')).toEqual({
            frequency: 'EVENT_BASED', dueDay: null, dueMonthOffset: 0, event: 'New hire', dueDaysAfterEvent: 30,
        });
    });
});

describe('parseInternalRow', () => {
    it('reads a complete row', () => {
        const { data, errors } = parseInternalRow(good, 2);
        expect(errors).toEqual([]);
        expect(data).toMatchObject({
            row: 2,
            owner: 'owner@example.com',
            effectiveDate: '2026-04-01',
            periodBasis: 'FINANCIAL_YEAR',
            attachment: 'OPTIONAL',
            risk: 'MEDIUM',
            alertOwnerDays: 7,
            alertManagerDays: 3,
            rule: { frequency: 'MONTHLY', dueDay: 10, dueMonthOffset: 1 },
            approver: null,
            lawCategory: null,
        });
    });

    it('lists every missing required value', () => {
        const { data, errors } = parseInternalRow({}, 5);
        expect(data).toBeNull();
        const required = UPLOAD_COLUMNS.filter((c) => c.required).length;
        expect(errors.filter((e) => e.message === 'This is required')).toHaveLength(required);
        expect(errors.every((e) => e.row === 5)).toBe(true);
    });

    it('checks letters, days and emails', () => {
        const { errors } = parseInternalRow(
            { ...good, startEnd: 'X', onDay: '40', owner: 'not-an-email', alertOwner: '2', alertManager: '3' },
            3,
        );
        const fields = errors.map((e) => e.field);
        expect(fields).toEqual(expect.arrayContaining(['start/end period', 'on day', 'owner email', 'alert owner']));
    });

    it('needs an event name for event based items and allows up to 365 days', () => {
        expect(parseInternalRow({ ...good, periodicity: 'E', onDay: '30' }, 2).errors[0]).toMatchObject({ field: 'event name' });
        const ok = parseInternalRow({ ...good, periodicity: 'E', onDay: '300', event: 'New hire' }, 2);
        expect(ok.errors).toEqual([]);
        expect(ok.data?.rule.dueDaysAfterEvent).toBe(300);
    });
});

describe('parseInternalSheet', () => {
    const header = UPLOAD_COLUMNS.map((c) => c.header);
    const rowOf = (v: Partial<Record<InternalKey, string>>) => UPLOAD_COLUMNS.map((c) => (c.key ? v[c.key] ?? '' : ''));

    it('reads rows and skips blank ones', () => {
        const out = parseInternalSheet(header, [rowOf(good), [], rowOf({ ...good, title: 'Second item' })]);
        expect(out.fileErrors).toEqual([]);
        expect(out.errors).toEqual([]);
        expect(out.totalRows).toBe(2);
        expect(out.rows.map((r) => r.row)).toEqual([2, 4]);
    });

    it('reports missing required columns', () => {
        const out = parseInternalSheet(['Compliance Name (Length=500)*'], [['x']]);
        expect(out.fileErrors[0]).toContain('Missing required columns');
    });

    it('warns about escalation columns and rejects extra approval levels', () => {
        const h = [...header, 'Escalation User Level 1 Email Id (Length=200)', 'Approval Level 2 Email Id (Length=200)'];
        const out = parseInternalSheet(h, [
            [...rowOf(good), 'esc@example.com', ''],
            [...rowOf({ ...good, title: 'Other' }), '', 'second@example.com'],
        ]);
        expect(out.warnings[0]).toContain('Escalation User Level 1');
        expect(out.rows).toHaveLength(1);
        expect(out.errors).toEqual([expect.objectContaining({ row: 3, field: 'approval levels 2 to 5' })]);
    });

    it('accepts the columns in any order', () => {
        const order = [...UPLOAD_COLUMNS].reverse();
        const out = parseInternalSheet(
            order.map((c) => c.header),
            [order.map((c) => (c.key ? good[c.key] ?? '' : ''))],
        );
        expect(out.errors).toEqual([]);
        expect(out.rows).toHaveLength(1);
    });
});