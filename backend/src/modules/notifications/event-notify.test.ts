import { describe, it, expect } from 'vitest';
import { planEventNotifications, type EventNoticeInput } from './event-notify';

const base: EventNoticeInput = {
    actorId: 'admin',
    actorName: 'Asha Admin',
    event: 'Change of registered office',
    location: 'Pune Plant',
    eventDate: '2026-11-10',
    items: [],
};
const plan = (over: Partial<EventNoticeInput>) => planEventNotifications({ ...base, ...over });

describe('planEventNotifications', () => {
    it('sends one notice per owner with the count and the earliest due date', () => {
        const r = plan({
            items: [
                { ownerId: 'ravi', dueDate: '2026-12-10' },
                { ownerId: 'kiran', dueDate: '2026-11-25' },
                { ownerId: 'ravi', dueDate: '2026-11-30' },
            ],
        });
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({ userId: 'ravi', title: 'New compliance items: Change of registered office' });
        expect(r[0].body).toBe(
            'Asha Admin recorded "Change of registered office" at Pune Plant on 2026-11-10. 2 items were created for you. The first is due 2026-11-30.',
        );
        expect(r[1].userId).toBe('kiran');
    });

    it('uses the singular for one item', () => {
        const r = plan({ items: [{ ownerId: 'ravi', dueDate: '2026-12-10' }] });
        expect(r[0].body).toBe(
            'Asha Admin recorded "Change of registered office" at Pune Plant on 2026-11-10. 1 item was created for you, due 2026-12-10.',
        );
    });

    it('never notifies the person who recorded the event', () => {
        expect(plan({ items: [{ ownerId: 'admin', dueDate: '2026-12-10' }] })).toEqual([]);
    });

    it('keeps the text on one line', () => {
        const r = plan({
            actorName: 'Asha\nAdmin',
            event: 'Change of\nregistered   office',
            location: 'Pune\nPlant',
            items: [{ ownerId: 'ravi', dueDate: '2026-12-10' }],
        });
        expect(r[0].title).toBe('New compliance items: Change of registered office');
        expect(r[0].body).not.toMatch(/[\r\n]/);
    });

    it('says nothing when no items were created', () => {
        expect(plan({ items: [] })).toEqual([]);
    });
});