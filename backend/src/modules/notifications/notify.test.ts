import { describe, it, expect } from 'vitest';
import { planWorkflowNotifications, type WorkflowEvent } from './notify';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const base: WorkflowEvent = {
    orgId: 'o1',
    actorId: 'actor',
    action: 'SUBMITTED',
    toStatus: 'SUBMITTED',
    instanceId: 'i1',
    code: 'SAMPLE-001',
    title: 'Pay monthly wages',
    dueDate: d('2026-11-07'),
    before: { ownerId: 'owner', managerId: 'manager', approverId: 'approver' },
    after: { ownerId: 'owner', managerId: 'manager', approverId: 'approver' },
};
const plan = (over: Partial<WorkflowEvent>) => planWorkflowNotifications({ ...base, ...over }, 'Kiran');

describe('planWorkflowNotifications', () => {
    it('tells the manager that a review is waiting', () => {
        const result = plan({ actorId: 'owner' });
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ userId: 'manager', type: 'REVIEW_REQUESTED' });
        expect(result[0].title).toBe('Review requested: SAMPLE-001: Pay monthly wages');
        expect(result[0].body).toContain('Kiran submitted this item (due 2026-11-07)');
    });

    it('tells the approver after the manager approves a high-risk item', () => {
        expect(plan({ actorId: 'manager', action: 'MANAGER_APPROVED', toStatus: 'MANAGER_APPROVED' })).toEqual([
            expect.objectContaining({
                userId: 'approver',
                type: 'REVIEW_REQUESTED',
                title: 'Approval requested: SAMPLE-001: Pay monthly wages',
            }),
        ]);
    });

    it('tells nobody when there is no approver to tell', () => {
        expect(
            plan({
                actorId: 'manager',
                action: 'MANAGER_APPROVED',
                toStatus: 'MANAGER_APPROVED',
                after: { ...base.after, approverId: null },
            }),
        ).toEqual([]);
    });

    it('tells the owner when the item is closed', () => {
        const result = plan({ actorId: 'approver', action: 'APPROVED', toStatus: 'CLOSED' });
        expect(result).toEqual([
            expect.objectContaining({
                userId: 'owner',
                type: 'CLOSED',
                title: 'Closed: SAMPLE-001: Pay monthly wages',
                body: 'Kiran approved this item. It is now closed.',
            }),
        ]);
    });

    it('says so when the item was approved as not applicable', () => {
        const result = plan({ actorId: 'approver', action: 'APPROVED', toStatus: 'NOT_APPLICABLE' });
        expect(result[0].body).toBe('Kiran approved this item as not applicable.');
    });

    it('includes the reason when returning, on one line and cut at 500 characters', () => {
        const result = plan({
            actorId: 'manager',
            action: 'RETURNED',
            toStatus: 'RETURNED',
            remarks: 'Please fix\nthe challan ' + 'x'.repeat(600),
        });
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ userId: 'owner', type: 'RETURNED' });
        expect(result[0].body).toContain('Reason: Please fix the challan');
        expect(result[0].body).not.toContain('\n');
        expect(result[0].body.length).toBeLessThanOrEqual(600);
    });

    it('tells only the people whose role changed when reassigning', () => {
        const owner = plan({
            actorId: 'admin',
            action: 'REASSIGNED',
            after: { ...base.after, ownerId: 'newOwner' },
        });
        expect(owner).toEqual([
            expect.objectContaining({ userId: 'newOwner', type: 'ASSIGNED', title: 'You are now the owner: SAMPLE-001: Pay monthly wages' }),
        ]);

        const all = plan({
            actorId: 'admin',
            action: 'REASSIGNED',
            after: { ownerId: 'newOwner', managerId: 'newManager', approverId: 'newApprover' },
        });
        expect(all.map((n) => n.userId)).toEqual(['newOwner', 'newManager', 'newApprover']);
    });

    it('tells nobody when an approver is removed', () => {
        expect(
            plan({ actorId: 'admin', action: 'REASSIGNED', after: { ...base.after, approverId: null } }),
        ).toEqual([]);
    });

    it('saving a draft tells nobody', () => {
        expect(plan({ actorId: 'owner', action: 'DRAFT_SAVED' })).toEqual([]);
    });

    it('never notifies the person who acted', () => {
        expect(plan({ actorId: 'manager' })).toEqual([]);
    });
});