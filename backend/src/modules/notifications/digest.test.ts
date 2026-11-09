import { describe, it, expect } from 'vitest';
import {
    addDays, buildDigests, daysUntil, renderDigest,
    type DigestItem, type DigestUser,
} from './digest';

const TODAY = '2026-11-09';
const users: DigestUser[] = [
    { id: 'owner', name: 'Kiran Member', role: 'MEMBER' },
    { id: 'manager', name: 'Meera Manager', role: 'MEMBER' },
    { id: 'approver', name: 'Asha Admin', role: 'ORG_ADMIN' },
];

let counter = 0;
const item = (o: Partial<DigestItem> & { dueDate: string }): DigestItem => ({
    id: `i${++counter}`,
    code: 'C-1',
    title: 'Pay wages',
    location: 'Pune',
    status: 'DUE',
    ownerId: 'owner',
    managerId: 'manager',
    approverId: 'approver',
    ...o,
});
const ago = (days: number) => addDays(TODAY, -days);
const digestFor = (items: DigestItem[], id: string) => buildDigests(items, users, TODAY).get(id);

describe('date helpers', () => {
    it('counts days between dates', () => {
        expect(daysUntil('2026-11-09', TODAY)).toBe(0);
        expect(daysUntil('2026-12-01', TODAY)).toBe(22);
        expect(daysUntil('2026-11-01', TODAY)).toBe(-8);
        expect(daysUntil('2028-03-01', '2028-02-27')).toBe(3);
    });

    it('adds days across month, year and leap day', () => {
        expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
        expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
        expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    });
});

describe('buildDigests', () => {
    it('reminds the owner only 7, 3 and 1 days ahead, and on the day', () => {
        const items = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => item({ dueDate: addDays(TODAY, n) }));
        const owner = digestFor(items, 'owner');
        expect(owner?.dueSoon.map((i) => i.dueDate)).toEqual([0, 1, 3, 7].map((n) => addDays(TODAY, n)));
        expect(owner?.overdue).toHaveLength(0);
        expect(digestFor(items, 'manager')).toBeUndefined();
    });

    it('lists overdue items for the owner, including returned ones', () => {
        const items = [item({ dueDate: ago(1) }), item({ status: 'RETURNED', dueDate: ago(4) })];
        expect(digestFor(items, 'owner')?.overdue).toHaveLength(2);
    });

    it('escalates to the manager only after 3 days overdue', () => {
        const items = [item({ dueDate: ago(2) }), item({ dueDate: ago(3) })];
        expect(digestFor(items, 'manager')?.escalated.map((i) => i.dueDate)).toEqual([ago(3)]);
        expect(digestFor(items, 'owner')?.overdue).toHaveLength(2);
    });

    it('counts items 15 or more days overdue for admins only', () => {
        const items = [14, 15, 40].map((d) => item({ dueDate: ago(d) }));
        expect(digestFor(items, 'approver')?.adminEscalated).toBe(2);
        expect(digestFor(items, 'owner')?.adminEscalated).toBe(0);
        expect(digestFor([item({ dueDate: ago(14) })], 'approver')).toBeUndefined();
    });

    it('shows submitted items to the manager and manager-approved items to the approver', () => {
        const submitted = item({ status: 'SUBMITTED', dueDate: ago(1) });
        const approved = item({ status: 'MANAGER_APPROVED', dueDate: ago(1) });
        expect(digestFor([submitted, approved], 'manager')?.awaitingReview.map((i) => i.id)).toEqual([submitted.id]);
        expect(digestFor([submitted, approved], 'approver')?.awaitingReview.map((i) => i.id)).toEqual([approved.id]);

        const orphan = item({ status: 'MANAGER_APPROVED', approverId: null, dueDate: ago(1) });
        expect(buildDigests([orphan], users, TODAY).size).toBe(0);
    });

    it('ignores people who are not in the user list', () => {
        const result = buildDigests([item({ dueDate: ago(30) })], users.slice(0, 1), TODAY);
        expect([...result.keys()]).toEqual(['owner']);
    });

    it('sorts the oldest due date first', () => {
        const items = [1, 30, 10].map((d) => item({ dueDate: ago(d) }));
        expect(digestFor(items, 'owner')?.overdue.map((i) => i.dueDate)).toEqual([ago(30), ago(10), ago(1)]);
    });
});

describe('renderDigest', () => {
    it('writes a title and sections', () => {
        const d = digestFor([item({ dueDate: ago(5) }), item({ dueDate: TODAY })], 'owner')!;
        const { title, body } = renderDigest(d, 'Kiran Member', TODAY);
        expect(title).toBe('Compliance summary: 1 overdue, 1 due soon');
        expect(body).toContain('Hello Kiran,');
        expect(body).toContain('Overdue (1)');
        expect(body).toContain('- C-1: Pay wages (Pune), 5 days overdue (due 2026-11-04)');
        expect(body).toContain('Due soon (1)');
        expect(body).toContain('due today');
    });

    it('shows ten items and says how many more there are', () => {
        const items = Array.from({ length: 12 }, (_, i) => item({ dueDate: ago(i + 1) }));
        const { title, body } = renderDigest(digestFor(items, 'owner')!, 'Kiran Member', TODAY);
        expect(title).toBe('Compliance summary: 12 overdue');
        expect(body.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(10);
        expect(body).toContain('...and 2 more');
    });

    it('uses the singular for one day', () => {
        const d = digestFor([item({ dueDate: addDays(TODAY, 1) }), item({ dueDate: ago(1) })], 'owner')!;
        const { body } = renderDigest(d, 'Kiran Member', TODAY);
        expect(body).toContain('due in 1 day (2026-11-10)');
        expect(body).toContain('1 day overdue (due 2026-11-08)');
    });
});