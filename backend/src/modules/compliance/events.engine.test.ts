import { describe, it, expect } from 'vitest';
import { dueAfterEvent, groupEvents, normalizeEvent, planTrigger, type PlanSchedule } from './events.engine';

const KEY = 'change of registered office';
const sched = (o: Partial<PlanSchedule> & { id: string }): PlanSchedule => ({
    event: 'Change of registered office',
    dueDaysAfterEvent: 30,
    startDate: '2026-01-01',
    ...o,
});

describe('normalizeEvent', () => {
    it('ignores capitals and extra spaces', () => {
        expect(normalizeEvent('  Change   of REGISTERED office ')).toBe('change of registered office');
    });
});

describe('dueAfterEvent', () => {
    it('adds days across month and year ends', () => {
        expect(dueAfterEvent('2026-11-10', 30)).toBe('2026-12-10');
        expect(dueAfterEvent('2026-12-20', 30)).toBe('2027-01-19');
    });

    it('handles the leap day', () => {
        expect(dueAfterEvent('2028-02-10', 20)).toBe('2028-03-01');
        expect(dueAfterEvent('2027-02-10', 20)).toBe('2027-03-02');
    });

    it('zero days is the event date itself', () => {
        expect(dueAfterEvent('2026-11-10', 0)).toBe('2026-11-10');
    });
});

describe('groupEvents', () => {
    it('merges wordings, counts them and uses the most common one as the label', () => {
        expect(
            groupEvents([
                'Change of registered office',
                'Change of registered office',
                'change of registered office',
                'Appointment of director',
            ]),
        ).toEqual([
            { key: 'appointment of director', label: 'Appointment of director', count: 1 },
            { key: 'change of registered office', label: 'Change of registered office', count: 3 },
        ]);
    });

    it('breaks a tie the same way every time', () => {
        expect(groupEvents(['b event', 'B event'])).toEqual([{ key: 'b event', label: 'B event', count: 2 }]);
    });
});

describe('planTrigger', () => {
    it('creates an item per matching schedule, due the right number of days later', () => {
        const plan = planTrigger(
            [sched({ id: 'a' }), sched({ id: 'b', event: 'change  of Registered office', dueDaysAfterEvent: 15 })],
            KEY,
            '2026-11-10',
            new Set(),
        );
        expect(plan.matched).toBe(2);
        expect(plan.toCreate).toEqual([
            { scheduleId: 'a', dueDate: '2026-12-10' },
            { scheduleId: 'b', dueDate: '2026-11-25' },
        ]);
    });

    it('counts what already exists and what is skipped, and ignores other events', () => {
        const plan = planTrigger(
            [
                sched({ id: 'c' }),
                sched({ id: 'd', startDate: '2026-12-01' }),
                sched({ id: 'e', dueDaysAfterEvent: null }),
                sched({ id: 'f', event: 'Appointment of director' }),
                sched({ id: 'g', event: null }),
            ],
            KEY,
            '2026-11-10',
            new Set(['c']),
        );
        expect(plan).toEqual({
            matched: 3,
            toCreate: [],
            alreadyExist: 1,
            skippedBeforeStart: 1,
            skippedNoDueDays: 1,
        });
    });

    it('a schedule that starts on the event date still applies', () => {
        const plan = planTrigger([sched({ id: 'h', startDate: '2026-11-10' })], KEY, '2026-11-10', new Set());
        expect(plan.toCreate).toHaveLength(1);
    });
});