import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import type { Summary } from './types';

export const useLawSummary = (enabled = true) =>
    useQuery({
        queryKey: ['lawchanges', 'summary'],
        enabled,
        queryFn: ({ signal }) => api<Summary>('/compliance/amendments/summary', { signal }),
        staleTime: 60_000,
        refetchInterval: 5 * 60_000,
    });

// After a decision, every screen that shows records, dates or counts is out of date
export function useRefreshAfterLawDecision() {
    const qc = useQueryClient();
    return () =>
        Promise.all(
            ['lawchanges', 'records', 'record', 'dashboard', 'facets', 'notifications', 'documents'].map((key) =>
                qc.invalidateQueries({ queryKey: [key] }),
            ),
        );
}