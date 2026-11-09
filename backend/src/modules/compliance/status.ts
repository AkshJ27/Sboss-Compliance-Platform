import { InstanceStatus } from '@prisma/client';
import { toDateOnly } from '../../lib/dates';

export type DashboardStatus =
    | 'DUE'
    | 'PENDING_APPROVAL'
    | 'ON_TIME'
    | 'LATE_CLOSURE'
    | 'NON_COMPLIANCE'
    | 'NOT_APPLICABLE';

// The label shown on the dashboard, worked out from the stored status and the dates
export function dashboardStatus(
    row: { status: InstanceStatus; dueDate: Date; doneDate: Date | null },
    today: string,
): DashboardStatus {
    switch (row.status) {
        case 'NOT_APPLICABLE':
            return 'NOT_APPLICABLE';
        case 'SUBMITTED':
        case 'MANAGER_APPROVED':
            return 'PENDING_APPROVAL';
        case 'CLOSED':
            return row.doneDate && toDateOnly(row.doneDate) > toDateOnly(row.dueDate)
                ? 'LATE_CLOSURE'
                : 'ON_TIME';
        default: // DUE and RETURNED are both still the owner's to do
            return toDateOnly(row.dueDate) < today ? 'NON_COMPLIANCE' : 'DUE';
    }
}