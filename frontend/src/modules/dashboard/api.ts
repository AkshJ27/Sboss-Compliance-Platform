import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../core/api/client';
import type { Charts, Counts, Summary } from './types';

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


export type DayCounts = { date: string; counts: Counts; total: number };
export type MonthDays = { asOf: string; month: string; from: string; to: string; totals: Counts; days: DayCounts[] };

// Counts per due date for one month, for the Data tab's day strip
export const useMonthDays = (params: string) =>
    useQuery({
        queryKey: ['dashboard', 'days', params],
        queryFn: ({ signal }) => api<MonthDays>(`/compliance/dashboard/days?${params}`, { signal }),
        placeholderData: keepPreviousData,
    });