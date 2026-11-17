import { useQuery } from '@tanstack/react-query';
import { api } from '../../core/api/client';
import type { AccessLevel } from '../../shared/documents';

type Named = { id: string; name: string };

export type DocCategory = {
    id: string;
    name: string;
    level: 1 | 2 | 3;
    parentId: string | null;
    parent: Named | null;
    isActive: boolean;
    children: number;
    documents: number;
};

export type RecordFile = { id: string; fileName: string; sizeBytes: number; createdAt: string; uploadedBy: Named };

export type DocRecord = {
    id: string;
    name: string;
    docNumber: string | null;
    accessLevel: AccessLevel;
    storedAt: string | null;
    reviewDate: string | null;
    expiryDate: string | null;
    alertDays: number | null;
    remarks: string | null;
    createdAt: string;
    updatedAt: string;
    entityId: string;
    verticalId: string;
    locationId: string;
    departmentId: string;
    categoryId: string;
    subCategoryId: string | null;
    subSubCategoryId: string | null;
    ownerId: string;
    managerId: string | null;
    entity: Named;
    vertical: Named;
    location: Named;
    department: Named;
    category: Named;
    subCategory: Named | null;
    subSubCategory: Named | null;
    owner: Named;
    manager: Named | null;
    createdBy: Named;
    additionalUsers: Named[];
    files: RecordFile[];
    fileCount: number;
    expired: boolean;
    can: { open: boolean; edit: boolean; delete: boolean };
};
export type RecordPage = { items: DocRecord[]; total: number; page: number; limit: number };

// One level of the category tree. Sub levels load only once their parent is chosen.
export const useDocCategories = (level: 1 | 2 | 3, parentId?: string | null, includeInactive = false) =>
    useQuery({
        queryKey: ['documents', 'categories', level, parentId ?? null, includeInactive],
        queryFn: ({ signal }) => {
            const qs = new URLSearchParams({ level: String(level) });
            if (parentId) qs.set('parentId', parentId);
            if (includeInactive) qs.set('includeInactive', 'true');
            return api<DocCategory[]>(`/documents/categories?${qs.toString()}`, { signal });
        },
        enabled: level === 1 || !!parentId,
        staleTime: 60_000,
    });

export const useRecordSummary = () =>
    useQuery({
        queryKey: ['documents', 'records', 'summary'],
        queryFn: ({ signal }) => api<{ expired: number; withoutFiles: number }>('/documents/records/summary', { signal }),
    });

type LocationOption = { id: string; name: string; isActive: boolean };

// The locations of one entity
export const useEntityLocations = (entityId: string | undefined) =>
    useQuery({
        queryKey: ['masters', 'locations', 'for-entity', entityId],
        queryFn: ({ signal }) =>
            api<{ items: LocationOption[] }>(`/masters/locations?entityId=${entityId}&limit=100`, { signal }),
        enabled: !!entityId,
        staleTime: 60_000,
    });

export const ACCESS_DOT: Record<AccessLevel, string> = {
    PUBLIC: '#52c41a',
    PRIVATE: '#fadb14',
    PROTECTED: '#faad14',
    RESTRICTED: '#f5222d',
};

export const ACCESS_HELP: Record<AccessLevel, string> = {
    PUBLIC: 'Everyone in the company can see it and open its files',
    PROTECTED: 'Everyone sees it in the list; only the named people can open its files',
    PRIVATE: 'Only the owner, manager, the person who added it and the additional users can see it',
    RESTRICTED: 'Only the owner, the person who added it and the additional users (not the manager). Admins only.',
};