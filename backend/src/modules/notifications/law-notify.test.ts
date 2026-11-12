import { describe, it, expect } from 'vitest';
import { planDueDateNotices, type DueDateNoticeInput } from './law-notify';

const base: DueDateNoticeInput = {
    actorId: 'admin',
    actorName: 'Asha Admin',
    code: 'LC-1',
    title: 'Pay wages',
    moves: [],
};
const plan = (over: Partial<DueDateNoticeInput>) => planDueDateNotices({ ...base, ...over });

describe('planDueDateNotices', () => {
    it('sends one notice per owner with the count and the earliest new date', () => {
        const r = plan({
            moves: [
                { ownerId: 'ravi', dueDate: '2026-05-10' },
                { ownerId: 'kiran', dueDate: '2026-06-10' },
                { ownerId: 'ravi', dueDate: '2026-05-12' },
            ],
        });
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({ userId: 'ravi', title: 'Due dates changed: LC-1' });
        expect(r[0].body).toBe(
            'Asha Admin applied a change in the law to LC-1: Pay wages. 2 of your items now fall due on different dates. The earliest is 2026-05-10.',
        );
        expect(r[1].userId).toBe('kiran');
    });

    it('uses the singular for one item', () => {
        const r = plan({ moves: [{ ownerId: 'ravi', dueDate: '2026-05-10' }] });
        expect(r[0].body).toBe(
            'Asha Admin applied a change in the law to LC-1: Pay wages. 1 of your items now falls due on 2026-05-10.',
        );
    });

    it('never notifies the person who applied the change', () => {
        expect(plan({ moves: [{ ownerId: 'admin', dueDate: '2026-05-10' }] })).toEqual([]);
    });

    it('keeps the text on one line', () => {
        const r = plan({
            actorName: 'Asha\nAdmin',
            code: 'LC\n1',
            title: 'Pay\n  wages',
            moves: [{ ownerId: 'ravi', dueDate: '2026-05-10' }],
        });
        expect(r[0].title).toBe('Due dates changed: LC 1');
        expect(r[0].body).not.toMatch(/[\r\n]/);
    });

    it('says nothing when nothing moved', () => {
        expect(plan({ moves: [] })).toEqual([]);
    });
});