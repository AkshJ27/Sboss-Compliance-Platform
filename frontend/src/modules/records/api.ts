import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../core/api/client';
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