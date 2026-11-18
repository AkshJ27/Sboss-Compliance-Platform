import { describe, it, expect } from 'vitest';
import { dueRuleText } from './due-text';

const rule = (o: Partial<Parameters<typeof dueRuleText>[0]>) => ({ frequency: 'MONTHLY', dueDay: 7, dueMonthOffset: 1, event: null, dueDaysAfterEvent: null, ...o });

describe('the due rule in words', () => {
    it('describes calendar rules', () => {
        expect(dueRuleText(rule({}))).toBe('Day 7, 1 month after the period');
        expect(dueRuleText(rule({ frequency: 'ANNUAL', dueDay: 30, dueMonthOffset: -11 }))).toBe('Day 30, in the first month of the period');
        expect(dueRuleText(rule({ frequency: 'QUARTERLY', dueDay: 15, dueMonthOffset: 0 }))).toBe('Day 15, in the last month of the period');
    });
    it('describes event-based and one-time rules', () => {
        expect(dueRuleText(rule({ frequency: 'EVENT_BASED', dueDay: null, event: 'Acceptance of Deposits', dueDaysAfterEvent: 30 }))).toBe(
            '30 days after: Acceptance of Deposits',
        );
        expect(dueRuleText(rule({ frequency: 'ONE_TIME', dueDay: null }))).toBe('On the start date');
    });
});