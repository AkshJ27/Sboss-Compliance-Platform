import { describe, it, expect } from 'vitest';
import { planAssigned, planComment, planStatus } from './tasks.notify';

const base = { actorId: 'creator', actorName: 'Asha Admin', taskTitle: 'Send the licence copy' };
const parties = { creatorId: 'creator', assigneeId: 'assignee' };

describe('planAssigned', () => {
    it('tells the new assignee, with the priority and the due date', () => {
        expect(planAssigned({ ...base, assigneeId: 'ravi', priority: 'HIGH', dueDate: '2026-12-01' })).toEqual([
            {
                userId: 'ravi',
                type: 'TASK_ASSIGNED',
                title: 'New task: Send the licence copy',
                body: 'Asha Admin assigned this task to you (High priority, due 2026-12-01).',
            },
        ]);
    });

    it('leaves out the due date when there is none', () => {
        const r = planAssigned({ ...base, assigneeId: 'ravi', priority: 'MEDIUM', dueDate: null });
        expect(r[0].body).toBe('Asha Admin assigned this task to you (Medium priority).');
    });

    it('does not tell the person who gave the task to themselves', () => {
        expect(planAssigned({ ...base, assigneeId: 'creator', priority: 'LOW', dueDate: null })).toEqual([]);
    });

    it('tells the previous assignee that the task moved away', () => {
        const r = planAssigned({ ...base, assigneeId: 'kiran', previousAssigneeId: 'ravi', priority: 'LOW', dueDate: null });
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({ userId: 'kiran', type: 'TASK_ASSIGNED' });
        expect(r[1]).toEqual({
            userId: 'ravi',
            type: 'TASK_UPDATED',
            title: 'Task reassigned: Send the licence copy',
            body: 'Asha Admin reassigned this task to someone else.',
        });
    });

    it('does not tell a previous assignee who did the reassigning', () => {
        const r = planAssigned({ ...base, assigneeId: 'kiran', previousAssigneeId: 'creator', priority: 'LOW', dueDate: null });
        expect(r).toHaveLength(1);
        expect(r[0].userId).toBe('kiran');
    });

    it('keeps the text on one line', () => {
        const r = planAssigned({
            actorId: 'creator',
            actorName: 'Asha\nAdmin',
            taskTitle: 'Send the\n  licence copy',
            assigneeId: 'ravi',
            priority: 'HIGH',
            dueDate: null,
        });
        expect(r[0].title).toBe('New task: Send the licence copy');
        expect(r[0].body).not.toMatch(/[\r\n]/);
        expect(r[0].body.startsWith('Asha Admin assigned')).toBe(true);
    });
});

describe('planStatus', () => {
    const change = { taskTitle: 'T', ...parties };

    it('tells the creator when the assignee finishes a task', () => {
        expect(
            planStatus({ ...change, actorId: 'assignee', actorName: 'Kiran Member', from: 'IN_PROGRESS', to: 'DONE', remarks: null }),
        ).toEqual([
            { userId: 'creator', type: 'TASK_UPDATED', title: 'Task completed: T', body: 'Kiran Member marked this task as done.' },
        ]);
    });

    it('tells the assignee when the creator cancels, with the note', () => {
        expect(
            planStatus({ ...change, actorId: 'creator', actorName: 'Asha Admin', from: 'OPEN', to: 'CANCELLED', remarks: 'No longer needed' }),
        ).toEqual([
            {
                userId: 'assignee',
                type: 'TASK_UPDATED',
                title: 'Task cancelled: T',
                body: 'Asha Admin cancelled this task. Note: No longer needed',
            },
        ]);
    });

    it('tells both people when an admin who is neither of them reopens a task', () => {
        const r = planStatus({ ...change, actorId: 'admin', actorName: 'Asha Admin', from: 'DONE', to: 'OPEN', remarks: 'Missed one item' });
        expect(r.map((n) => n.userId)).toEqual(['creator', 'assignee']);
        expect(r[0].title).toBe('Task reopened: T');
        expect(r[0].body).toBe('Asha Admin reopened this task. Note: Missed one item');
    });

    it('says nothing about moves between open and in progress', () => {
        expect(planStatus({ ...change, actorId: 'assignee', actorName: 'K', from: 'OPEN', to: 'IN_PROGRESS' })).toEqual([]);
        expect(planStatus({ ...change, actorId: 'assignee', actorName: 'K', from: 'IN_PROGRESS', to: 'OPEN' })).toEqual([]);
    });

    it('does not tell the person who made the change, even when they are both parties', () => {
        expect(
            planStatus({
                taskTitle: 'T',
                creatorId: 'same',
                assigneeId: 'same',
                actorId: 'same',
                actorName: 'K',
                from: 'OPEN',
                to: 'DONE',
            }),
        ).toEqual([]);
    });
});

describe('planComment', () => {
    const comment = { taskTitle: 'T', ...parties };

    it('tells the other person, with the comment on one line', () => {
        expect(
            planComment({ ...comment, actorId: 'assignee', actorName: 'Kiran Member', text: 'Please\nlook at\nthis' }),
        ).toEqual([
            {
                userId: 'creator',
                type: 'TASK_UPDATED',
                title: 'New comment: T',
                body: 'Kiran Member commented: Please look at this',
            },
        ]);
    });

    it('cuts a long comment at 300 characters', () => {
        const r = planComment({ ...comment, actorId: 'assignee', actorName: 'Kiran Member', text: 'x'.repeat(400) });
        expect(r[0].body).toBe(`Kiran Member commented: ${'x'.repeat(300)}`);
    });

    it('tells both people when an admin comments, and nobody when the author is the only party', () => {
        expect(planComment({ ...comment, actorId: 'admin', actorName: 'Asha Admin', text: 'Hi' }).map((n) => n.userId)).toEqual([
            'creator',
            'assignee',
        ]);
        expect(
            planComment({ taskTitle: 'T', creatorId: 'same', assigneeId: 'same', actorId: 'same', actorName: 'K', text: 'Note to self' }),
        ).toEqual([]);
    });
});