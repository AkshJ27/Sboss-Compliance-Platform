import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../core/api/client';
import type { SummaryReport } from './types';

export const useSummaryReport = (params: string) =>
    useQuery({
        queryKey: ['reports', 'summary', params],
        queryFn: ({ signal }) => api<SummaryReport>(`/reports/summary?${params}`, { signal }),
        placeholderData: keepPreviousData,
    });