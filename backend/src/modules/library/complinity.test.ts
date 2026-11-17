import { describe, it, expect } from 'vitest';
import { occurrences } from '../compliance/schedule.engine';
import { complinityDueRule, parseComplinityLibrary, repairText } from './complinity.parser';
import type { Frequency } from '@prisma/client';

// The due dates a rule gives in 2026-27, as YYYY-MM-DD
function dues(frequency: Frequency, onDate: number, startEnd: 'S' | 'E', year: 'F' | 'C') {
    const r = complinityDueRule(frequency, onDate, startEnd === 'S', year === 'F', null);
    const rule = { frequency, periodBasis: year === 'F' ? ('FINANCIAL_YEAR' as const) : ('CALENDAR_YEAR' as const), dueDay: r.dueDay ?? null, dueMonthOffset: r.dueMonthOffset ?? 0 };
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    return occurrences(rule, d('2026-01-01'), d('2026-04-01'), d('2027-03-31')).map((o) => o.dueDate.toISOString().slice(0, 10));
}

const HEADER = ['Act Name', 'Section No', 'Rule Name', 'Rule No', 'Compliance Name', 'Compliance Description', 'Applicability', 'Form No', 'Periodicity', 'On Date', 'Start/End Period', 'Financial/Calendar Year', 'Fin Dueday', 'Event Name', 'Attachment', 'Proof of Compliance', 'Penalty', 'Risk', 'Imprisonment', 'Statutory Authority', 'Law Category', 'Compliance Nature', 'Statutory/Internal', 'Alert Owner', 'Alert Manager', 'Compliance ID', 'State Name', 'Active Status'];
type Cells = Partial<Record<(typeof HEADER)[number], string>>;
const line = (c: Cells) => HEADER.map((h) => c[h] ?? '');
const base: Cells = {
    'Act Name': 'Maternity Benefit Act, 1961', 'Section No': '28', 'Rule Name': 'Delhi Maternity Benefit Rules, 1971', 'Rule No': 'Rule 16 (1) ',
    'Compliance Name': ' Annual return', 'Periodicity': 'A', 'On Date': '31', 'Start/End Period': 'E', 'Financial/Calendar Year': 'C', 'Fin Dueday': '0',
    'Attachment': 'M', 'Proof of Compliance': 'NA', 'Risk': 'H', 'Imprisonment': 'Y', 'Statutory Authority': 'Labour Inspector', 'Law Category': 'Labour Laws',
    'Compliance Nature': 'Return', 'Statutory/Internal': 'S', 'Alert Owner': '15', 'Alert Manager': '7', 'Compliance ID': '447', 'State Name': 'Delhi', 'Active Status': 'Y',
};

describe('Complinity due dates', () => {
    it('counts On Date in days from the end of the period', () => {
        expect(dues('ANNUAL', 31, 'E', 'C')).toEqual(['2027-01-31']); // Form K by 31 January
        expect(dues('ANNUAL', 46, 'E', 'C')).toEqual(['2027-02-15']); // by 15 February
        expect(dues('ANNUAL', 275, 'E', 'F')).toEqual(['2026-12-31']); // ROC filing: 275 days after 31 March
        expect(dues('ANNUAL', 183, 'E', 'F')).toEqual(['2026-09-30']);
        expect(dues('MONTHLY', 7, 'E', 'F').slice(0, 3)).toEqual(['2026-04-07', '2026-05-07', '2026-06-07']);
        expect(dues('QUARTERLY', 15, 'E', 'F')).toEqual(['2026-04-15', '2026-07-15', '2026-10-15', '2027-01-15']); // Jan-Mar is due 15 April
        expect(dues('HALF_YEARLY', 31, 'E', 'F')).toEqual(['2026-04-30', '2026-10-31']); // MSME-1: 30 April and 31 October
    });

    it('counts from the start of the period with S', () => {
        expect(dues('ANNUAL', 30, 'S', 'F')).toEqual(['2026-05-01']); // 30 days after 1 April
        expect(dues('ANNUAL', 30, 'S', 'C')).toEqual(['2027-01-31']);
    });

    it('keeps event based days, even years away', () => {
        expect(complinityDueRule('EVENT_BASED', 2586, true, true, 'Dividend unpaid')).toMatchObject({ dueDaysAfterEvent: 2586, event: 'Dividend unpaid' });
        expect(complinityDueRule('EVENT_BASED', -90, true, true, 'Licence expiry')).toMatchObject({ dueDaysAfterEvent: -90 });
    });
});

describe('Complinity library export', () => {
    it('reads every sheet, maps the codes and cleans the text', () => {
        const out = parseComplinityLibrary([
            { name: 'Mapped Compliances-Active', grid: [HEADER, line(base), line({ ...base, 'Compliance ID': '12190', 'State Name': 'Central', 'Periodicity': 'M', 'On Date': '7', 'Financial/Calendar Year': 'F', 'Fin Dueday': '30', 'Compliance Name': 'Additional time to crÃ¨che' })] },
            { name: 'Unmapped-Compliance', grid: [HEADER, line({ ...base, 'Compliance ID': '8434', 'State Name': 'Jammu & kashmir', 'Periodicity': 'V', 'On Date': '-90', 'Event Name': '' })] },
            { name: 'InactivatedBy-Complinity', grid: [HEADER.map((h) => (h === 'Compliance Description' ? 'Description' : h)), line({ ...base, 'Compliance ID': '12461', 'Active Status': 'N' }), line({ ...base, 'Compliance ID': '447' })] },
            { name: 'Internal', grid: [HEADER, line({ ...base, 'Compliance ID': '56959', 'Statutory/Internal': 'I' })] },
        ]);
        expect(out.errors).toEqual([]);
        expect(out.rows.map((r) => [r.data.code, r.mapped, r.data.isActive])).toEqual([
            ['447', true, true],
            ['12190', true, true],
            ['8434', false, true],
            ['12461', false, false],
        ]);
        expect(out.rows[0].data).toMatchObject({
            title: 'Annual return', jurisdiction: 'STATE', state: 'Delhi', reference: 'Section 28; Rule 16 (1)', form: undefined, proofOfCompliance: undefined,
            risk: 'HIGH', attachment: 'MANDATORY', imprisonment: true, alertOwnerDays: 15, alertManagerDays: 7, frequency: 'ANNUAL', dueDay: 31, dueMonthOffset: 1,
        });
        expect(out.rows[1].data).toMatchObject({ jurisdiction: 'CENTRAL', state: undefined, title: 'Additional time to crèche' });
        expect(out.rows[2].data).toMatchObject({ state: 'Jammu and Kashmir', frequency: 'EVENT_BASED', dueDaysAfterEvent: -90, event: 'Date varies (renewal or record keeping)' });
        expect(out.warnings.join(' | ')).toContain('Compliance ID 447 is in Mapped Compliances-Active row 2 and InactivatedBy-Complinity row 3');
        expect(out.warnings.join(' | ')).toContain('1 internal compliance(s) were skipped (ID 56959)');
        expect(out.warnings.join(' | ')).toContain('different due date for the March period in Complinity (ID 12190)');
    });

    it('reports what it cannot read, with the sheet and row', () => {
        const out = parseComplinityLibrary([{ name: 'Mapped', grid: [HEADER, line({ ...base, 'State Name': 'Atlantis', 'Periodicity': 'W' })] }]);
        expect(out.errors.map((e) => `${e.sheet} ${e.row} ${e.field}: ${e.message}`)).toEqual([
            'Mapped 2 State Name: Unknown state "Atlantis"',
            'Mapped 2 Periodicity: Unknown periodicity "W"',
        ]);
    });

    it('repairs twice-encoded text only', () => {
        expect(repairText('crÃ¨che')).toBe('crèche');
        expect(repairText('Contractor’s licence')).toBe('Contractor’s licence');
        expect(repairText('Ã la carte')).toBe('Ã la carte');
    });
});