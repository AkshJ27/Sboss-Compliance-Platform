import { useQuery } from '@tanstack/react-query';
import { api, apiDownload } from '../../core/api/client';

type Named = { id: string; name: string };
export type LegalAct = Named & { jurisdiction: 'CENTRAL' | 'STATE'; state: string | null; lawCategory: Named };

export type LegalRow = {
    id: string;
    notificationDate: string;
    publishedDate: string;
    effectiveDate: string | null;
    referenceNumber: string | null;
    title: string;
    complianceImpact: boolean;
    act: LegalAct;
    rule: Named | null;
    fileCount: number;
};
export type LegalPage = { items: LegalRow[]; total: number; mappedTotal: number; allTotal: number; page: number; limit: number };

export type LegalFile = { id: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string };
export type LegalDetail = Omit<LegalRow, 'fileCount'> & {
    actId: string;
    ruleId: string | null;
    ministry: string | null;
    description: string;
    isChange: boolean;
    isAddition: boolean;
    isDeletion: boolean;
    isSchedule: boolean;
    impactedCompliance: string | null;
    createdAt: string;
    updatedAt: string;
    files: LegalFile[];
};

export type LegalFilters = {
    lawCategories: Named[];
    states: string[];
    acts: { id: string; name: string; state: string | null; lawCategoryId: string }[];
};

export const useLegalFilters = () =>
    useQuery({
        queryKey: ['legal', 'filters'],
        queryFn: ({ signal }) => api<LegalFilters>('/legal-updates/filters', { signal }),
        staleTime: 5 * 60_000,
    });

export const useLegalRules = (actId: string | undefined) =>
    useQuery({
        queryKey: ['legal', 'rules', actId],
        queryFn: ({ signal }) => api<Named[]>(`/legal-updates/rules?actId=${actId}`, { signal }),
        enabled: !!actId,
        staleTime: 5 * 60_000,
    });

export const useLegalDetail = (id: string | null) =>
    useQuery({
        queryKey: ['legal', 'detail', id],
        queryFn: ({ signal }) => api<LegalDetail>(`/legal-updates/${id}`, { signal }),
        enabled: !!id,
    });

export const downloadLegalFile = (fileId: string) => apiDownload(`/legal-updates/files/${fileId}`);
export const downloadLegalZip = (id: string, fileIds: string[]) =>
    apiDownload(`/legal-updates/${id}/files.zip${fileIds.length ? `?ids=${fileIds.join(',')}` : ''}`);

export const regionLabel = (a: { state: string | null }) => a.state ?? 'Central';
export const kb = (bytes: number) => `${(bytes / 1024).toFixed(3)} KB`;