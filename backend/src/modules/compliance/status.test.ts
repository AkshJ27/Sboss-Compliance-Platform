import { describe, it, expect } from 'vitest';
import { InstanceStatus } from '@prisma/client';
import { dashboardStatus } from './status';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const row = (status: InstanceStatus, due: string, done: string | null = null) => ({
    status,
    dueDate: d(due),
    doneDate: done ? d(done) : null,
});
const TODAY = '2026-11-09';

describe('dashboardStatus', () => {
    it('closed on the due date is on time', () => {
        expect(dashboardStatus(row('CLOSED', '2026-04-30', '2026-04-30'), TODAY)).toBe('ON_TIME');
    });
    it('closed after the due date is a late closure', () => {
        expect(dashboardStatus(row('CLOSED', '2026-04-30', '2026-05-01'), TODAY)).toBe('LATE_CLOSURE');
    });
    it('open and not yet due is due', () => {
        expect(dashboardStatus(row('DUE', '2026-12-01'), TODAY)).toBe('DUE');
    });
    it('open and due today is still due, not overdue', () => {
        expect(dashboardStatus(row('DUE', TODAY), TODAY)).toBe('DUE');
    });
    it('open and past due is non compliance, including returned items', () => {
        expect(dashboardStatus(row('DUE', '2026-11-08'), TODAY)).toBe('NON_COMPLIANCE');
        expect(dashboardStatus(row('RETURNED', '2026-11-08'), TODAY)).toBe('NON_COMPLIANCE');
    });
    it('submitted and manager approved are pending approval, even when overdue', () => {
        expect(dashboardStatus(row('SUBMITTED', '2026-01-01'), TODAY)).toBe('PENDING_APPROVAL');
        expect(dashboardStatus(row('MANAGER_APPROVED', '2026-01-01'), TODAY)).toBe('PENDING_APPROVAL');
    });
    it('not applicable stays not applicable', () => {
        expect(dashboardStatus(row('NOT_APPLICABLE', '2026-01-01'), TODAY)).toBe('NOT_APPLICABLE');
    });
});