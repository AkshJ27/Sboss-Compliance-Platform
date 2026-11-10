import type { SessionUser } from '../../core/api/client';
import type { RecordDetail } from './types';

const REASSIGNABLE = ['DUE', 'RETURNED', 'SUBMITTED', 'MANAGER_APPROVED'];

export const RISK_COLOR = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' } as const;

export const STAGE_TEXT: Record<RecordDetail['status'], string> = {
    DUE: 'Waiting for the owner',
    RETURNED: 'Returned to the owner',
    SUBMITTED: 'Waiting for the manager',
    MANAGER_APPROVED: 'Waiting for the approver',
    CLOSED: 'Closed',
    NOT_APPLICABLE: 'Closed as not applicable',
};

// What this person can do with this item. The server decides again on every request.
export function capabilities(r: RecordDetail, user: SessionUser) {
    const open = r.status === 'DUE' || r.status === 'RETURNED';
    const writer = user.role !== 'VIEWER';
    const isOwner = user.id === r.ownerId;

    const reviewStage: 'MANAGER' | 'APPROVER' | null =
        writer && r.status === 'SUBMITTED' && user.id === r.managerId
            ? 'MANAGER'
            : writer && r.status === 'MANAGER_APPROVED' && user.id === r.approverId
                ? 'APPROVER'
                : null;

    return {
        open,
        canEdit: writer && open && isOwner,
        reviewStage,
        canReassign: user.role === 'ORG_ADMIN' && REASSIGNABLE.includes(r.status),
        canRemoveProof: writer && open && (isOwner || user.role === 'ORG_ADMIN'),
    };
}