import type { DashStatus } from '../../core/filters';

export type StoredStatus =
    | 'DUE'
    | 'SUBMITTED'
    | 'MANAGER_APPROVED'
    | 'CLOSED'
    | 'RETURNED'
    | 'NOT_APPLICABLE';
export type Person = { id: string; name: string };
export type Level = 'HIGH' | 'MEDIUM' | 'LOW';

export type RecordDetail = {
    id: string;
    status: StoredStatus;
    dashboardStatus: DashStatus;
    overdue: boolean;
    requiresApprover: boolean;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    submissionType: 'APPLICABLE' | 'NOT_APPLICABLE' | null;
    doneDate: string | null;
    refNo: string | null;
    challanNo: string | null;
    actualImprisonment: boolean;
    penaltyPaid: string | null;
    payableAmount: string | null;
    amountPaid: string | null;
    remarks: string | null;
    returnRemarks: string | null;
    isWip: boolean;
    ownerId: string;
    managerId: string;
    approverId: string | null;
    compliance: {
        id: string;
        code: string;
        title: string;
        description: string | null;
        form: string | null;
        event: string | null;
        reference: string | null;
        penalty: string | null;
        imprisonment: boolean;
        risk: Level;
        impact: Level;
        attachment: 'MANDATORY' | 'OPTIONAL' | 'NOT_REQUIRED';
        frequency: string;
        act: {
            id: string;
            name: string;
            jurisdiction: string;
            state: string | null;
            lawCategory: { id: string; name: string };
        };
    };
    entity: { id: string; name: string; code: string };
    location: { id: string; name: string; state: string };
    department: Person | null;
    vertical: Person | null;
    owner: Person;
    manager: Person;
    approver: Person | null;
    _count: { documents: number };
};

export type HistoryEvent = {
    id: string;
    action: 'DRAFT_SAVED' | 'SUBMITTED' | 'MANAGER_APPROVED' | 'APPROVED' | 'RETURNED' | 'REASSIGNED';
    fromStatus: StoredStatus | null;
    toStatus: StoredStatus | null;
    remarks: string | null;
    createdAt: string;
    actor: Person;
};