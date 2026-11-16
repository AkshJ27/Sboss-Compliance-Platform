import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../core/api/client';
import type { DashStatus } from '../../core/filters';
import type { HistoryEvent, RecordDetail } from './types';

export const useRecord = (id: string) =>
    useQuery({
        queryKey: ['record', id],
        queryFn: ({ signal }) => api<RecordDetail>(`/compliance/instances/${id}`, { signal }),
    });

export const useHistory = (id: string) =>
    useQuery({
        queryKey: ['record', id, 'history'],
        queryFn: ({ signal }) => api<HistoryEvent[]>(`/compliance/instances/${id}/history`, { signal }),
    });

// After anything changes, refresh every screen that shows this item
export function useRefreshAfterChange() {
    const qc = useQueryClient();
    return (id: string) =>
        Promise.all([
            qc.invalidateQueries({ queryKey: ['record', id] }), // the item and its history
            qc.invalidateQueries({ queryKey: ['records'] }), // the list
            qc.invalidateQueries({ queryKey: ['dashboard'] }),
            qc.invalidateQueries({ queryKey: ['notifications'] }),
            qc.invalidateQueries({ queryKey: ['documents'] }),
        ]);
}


export type PeriodRow = {
    id: string;
    isCurrent: boolean;
    status: string;
    dashboardStatus: DashStatus;
    frequency: string;
    dueDate: string;
    periodStart: string;
    periodEnd: string;
    enteredAt: string | null;
    doneDate: string | null;
    submittedBy: string | null;
    pendingAt: { role: 'owner' | 'manager' | 'approver'; name: string } | null;
    approvedBy: string | null;
    closedAt: string | null;
    remarks: string | null;
    documents: number;
};
export type ScheduleHistory = { total: number; shown: number; items: PeriodRow[] };

// Every period of the same compliance at the same location
export const useScheduleHistory = (id: string) =>
    useQuery({
        queryKey: ['record', id, 'schedule-history'],
        queryFn: ({ signal }) => api<ScheduleHistory>(`/compliance/instances/${id}/schedule-history`, { signal }),
    });