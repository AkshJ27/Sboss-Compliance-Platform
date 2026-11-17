import { describe, it, expect } from 'vitest';
import { expiryStage, planExpiryNotices } from './expiry';

describe('document expiry reminders', () => {
    it('reminds at the start of the window, 7 days, 1 day, the day itself and just after', () => {
        expect(expiryStage('2027-03-06', 150, '2026-10-06')).toBeNull(); // 151 days left
        expect(expiryStage('2027-03-06', 150, '2026-10-07')).toEqual({ stage: 'd150', daysLeft: 150 });
        expect(expiryStage('2027-03-06', 150, '2027-01-01')).toEqual({ stage: 'd150', daysLeft: 64 });
        expect(expiryStage('2027-03-06', 150, '2027-02-27')).toEqual({ stage: 'd7', daysLeft: 7 });
        expect(expiryStage('2027-03-06', 150, '2027-03-05')).toEqual({ stage: 'd1', daysLeft: 1 });
        expect(expiryStage('2027-03-06', 150, '2027-03-06')).toEqual({ stage: 'd0', daysLeft: 0 });
        expect(expiryStage('2027-03-06', 150, '2027-03-08')).toEqual({ stage: 'expired', daysLeft: -2 });
        expect(expiryStage('2027-03-06', 150, '2027-03-20')).toBeNull();
    });

    it('skips points beyond the alert days', () => {
        expect(expiryStage('2027-03-06', 3, '2027-03-02')).toBeNull();
        expect(expiryStage('2027-03-06', 3, '2027-03-03')).toEqual({ stage: 'd3', daysLeft: 3 });
        expect(expiryStage('2027-03-06', 0, '2027-03-05')).toBeNull();
        expect(expiryStage('2027-03-06', 0, '2027-03-06')).toEqual({ stage: 'd0', daysLeft: 0 });
    });

    it('tells the owner and manager once each, keyed so a rerun adds nothing', () => {
        const rec = { id: 'r1', orgId: 'o', name: 'Complinity  Agreement', expiryDate: '2027-03-06', alertDays: 150, location: 'New Delhi', category: 'Agreements', ownerId: 'u1', managerId: 'u2' };
        const out = planExpiryNotices([rec, { ...rec, id: 'r2', managerId: 'u1' }], '2027-02-27');
        expect(out.map((n) => n.userId)).toEqual(['u1', 'u2', 'u1']);
        expect(out[0].title).toBe('Document expiring in 7 days: Complinity Agreement');
        expect(out[0].body).toContain('expires on 06-Mar-2027, in 7 days');
        expect(out[0].dedupeKey).toBe('doc-expiry:r1:2027-03-06:d7');
    });
});