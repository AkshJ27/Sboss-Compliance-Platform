import { describe, it, expect } from 'vitest';
import { planBulkNotice, type BulkNoticeInput } from './bulk-notify';

const base: BulkNoticeInput = {
    actorId: 'admin',
    actorName: 'Asha Admin',
    fromName: 'Kiran Member',
    toUserId: 'ravi',
    schedules: 0,
    items: 0,
};
const plan = (over: Partial<BulkNoticeInput>) => planBulkNotice({ ...base, ...over });

describe('planBulkNotice', () => {
    it('tells the new person how much work moved', () => {
        expect(plan({ items: 12, schedules: 3 })).toEqual({
            title: 'Work was assigned to you',
            body: 'Asha Admin moved 12 open items and 3 schedules from Kiran Member to you.',
        });
    });

    it('uses the singular for one of each', () => {
        expect(plan({ items: 1, schedules: 1 })?.body).toBe(
            'Asha Admin moved 1 open item and 1 schedule from Kiran Member to you.',
        );
    });

    it('mentions only what moved', () => {
        expect(plan({ schedules: 2 })?.body).toBe('Asha Admin moved 2 schedules from Kiran Member to you.');
    });

    it('does not tell the admin who did it', () => {
        expect(plan({ items: 5, toUserId: 'admin' })).toBeNull();
    });

    it('says nothing when nothing moved', () => {
        expect(plan({})).toBeNull();
    });

    it('keeps the text on one line', () => {
        const n = plan({ items: 2, actorName: 'Asha\nAdmin', fromName: 'Kiran\n  Member' });
        expect(n?.body).toBe('Asha Admin moved 2 open items from Kiran Member to you.');
        expect(n?.body).not.toMatch(/[\r\n]/);
    });
});