import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../core/api/client';
import type { TaskDetail, TaskSummary } from './types';

export const useTask = (id: string) =>
    useQuery({
        queryKey: ['task', id],
        queryFn: ({ signal }) => api<TaskDetail>(`/tasks/${id}`, { signal }),
    });

export const useTaskSummary = (params: string) =>
    useQuery({
        queryKey: ['tasks', 'summary', params],
        queryFn: ({ signal }) => api<TaskSummary>(`/tasks/summary?${params}`, { signal }),
        placeholderData: keepPreviousData,
    });

// For the menu badge: how many of your own open tasks are overdue
export const useMyOverdueTasks = (userId: string | undefined, enabled: boolean) =>
    useQuery({
        queryKey: ['tasks', 'badge', userId],
        enabled: enabled && !!userId,
        queryFn: ({ signal }) => api<TaskSummary>(`/tasks/summary?assigneeId=${userId}`, { signal }),
        staleTime: 60_000,
        refetchInterval: 5 * 60_000,
    });

// After any change, every screen that shows tasks, counts or notifications is out of date
export function useRefreshAfterTaskChange() {
    const qc = useQueryClient();
    return () =>
        Promise.all(['tasks', 'task', 'notifications'].map((key) => qc.invalidateQueries({ queryKey: [key] })));
}