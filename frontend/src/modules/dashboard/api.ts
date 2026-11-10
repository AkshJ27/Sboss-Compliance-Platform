import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../core/api/client';
import type { Charts, Summary } from './types';

export const useSummary = (params: string) =>
    useQuery({
        queryKey: ['dashboard', 'summary', params],
        queryFn: ({ signal }) => api<Summary>(`/compliance/dashboard/summary?${params}`, { signal }),
        placeholderData: keepPreviousData,
    });

export const useCharts = (params: string) =>
    useQuery({
        queryKey: ['dashboard', 'charts', params],
        queryFn: ({ signal }) => api<Charts>(`/compliance/dashboard/charts?${params}`, { signal }),
        placeholderData: keepPreviousData,
    });