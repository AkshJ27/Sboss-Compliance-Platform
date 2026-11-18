import { useQuery } from '@tanstack/react-query';
import { api } from '../../core/api/client';
import type { Role } from '../../core/api/client';

export type Level = 'HIGH' | 'MEDIUM' | 'LOW';
export const RISK_COLOR: Record<Level, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' };

export type Entity = { id: string; name: string; code: string; isActive: boolean };
export type Simple = { id: string; name: string; isActive: boolean };
export type SimpleKind = 'verticals' | 'departments' | 'location-types';

export type LocationRow = {
    id: string;
    name: string;
    state: string;
    city: string | null;
    address: string | null;
    isActive: boolean;
    entityId: string;
    locationTypeId: string | null;
    entity: { id: string; name: string; code: string };
    locationType: { id: string; name: string } | null;
};
export type LocationPage = { items: LocationRow[]; total: number };

export type FinancialYear = {
    id: string;
    label: string;
    startDate: string;
    endDate: string;
    isCurrent: boolean;
};

export type UserRow = {
    id: string;
    name: string;
    email: string;
    role: Role;
    isActive: boolean;
    lastLoginAt: string | null;
    createdAt: string;
    passwordSetAt: string | null;
    lockedUntil: string | null;
    managerId: string | null;
    manager: { id: string; name: string } | null;
    defaultApproverId: string | null;
    defaultApprover: { id: string; name: string } | null;
    employeeCode: string | null;
    mobile: string | null;
    emailAlerts: boolean;
    verticals: { id: string; name: string }[]; // limited to these; empty for no limit
};

export const useEntities = (includeInactive: boolean) =>
    useQuery({
        queryKey: ['masters', 'entities', includeInactive],
        queryFn: ({ signal }) => api<Entity[]>(`/masters/entities?includeInactive=${includeInactive}`, { signal }),
    });

export const useSimple = (kind: SimpleKind, includeInactive: boolean) =>
    useQuery({
        queryKey: ['masters', kind, includeInactive],
        queryFn: ({ signal }) => api<Simple[]>(`/masters/${kind}?includeInactive=${includeInactive}`, { signal }),
    });

export const useFinancialYears = () =>
    useQuery({
        queryKey: ['masters', 'financial-years'],
        queryFn: ({ signal }) => api<FinancialYear[]>('/masters/financial-years', { signal }),
    });

export const useStates = () =>
    useQuery({
        queryKey: ['masters', 'states'],
        queryFn: ({ signal }) => api<string[]>('/masters/states', { signal }),
        staleTime: Infinity,
    });

export const useUsers = () =>
    useQuery({
        queryKey: ['users'],
        queryFn: ({ signal }) => api<UserRow[]>('/users', { signal }),
    });

// People who can be an owner, manager or approver
export const userOptions = (users: UserRow[] | undefined) =>
    (users ?? [])
        .filter((u) => u.isActive && u.role !== 'VIEWER')
        .map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }));