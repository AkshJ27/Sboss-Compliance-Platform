import { useQueryClient } from '@tanstack/react-query';
import { api, apiRaw } from '../../../core/api/client';

export type RowError = { row: number; field?: string; message: string };

export type Failure = {
    ok: false;
    fileErrors: string[];
    errorCount: number;
    errors: RowError[];
    warnings: string[];
};

export type CreateSample = {
    row: number;
    code: string | null;
    title: string;
    location: string;
    frequency: string;
    risk: 'HIGH' | 'MEDIUM' | 'LOW';
    owner: string;
    manager: string;
    effectiveDate: string;
};
export type CreateSummary = {
    ok: true;
    dryRun: boolean;
    totalRows: number;
    toCreate: number;
    locations: number;
    highRisk: number;
    warnings: string[];
    created: number;
    sample: CreateSample[];
};

export type UpdateSummary = {
    ok: true;
    dryRun: boolean;
    totalRows: number;
    changed: number;
    unchanged: number;
    sample: { code: string; fields: string[] }[];
};

export const isFailure = (o: { ok: boolean }): o is Failure => o.ok === false;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

// A checked file comes back as 422 with the row problems. Anything else that is not ok is an error.
async function readOutcome<T>(res: Response): Promise<T | Failure> {
    let data: unknown = null;
    try {
        data = await res.json();
    } catch {
        // The reply was not JSON
    }
    if (res.status === 422 && isObject(data) && data.ok === false) return data as unknown as Failure;
    if (res.ok && isObject(data) && data.ok === true) return data as unknown as T;
    throw new Error(isObject(data) && typeof data.error === 'string' ? data.error : `The request failed (${res.status})`);
}

export async function sendFile<T>(kind: 'upload' | 'update', file: File, dryRun: boolean): Promise<T | Failure> {
    const form = new FormData();
    form.append('file', file);
    return readOutcome<T>(await apiRaw(`/library/internal/${kind}?dryRun=${dryRun}`, { method: 'POST', form }));
}

// The add form sends the same values a spreadsheet row holds
export type InternalValues = Partial<
    Record<
        | 'title' | 'description' | 'periodicity' | 'event' | 'onDay' | 'startEnd' | 'yearBasis' | 'effectiveDate'
        | 'attachment' | 'proof' | 'risk' | 'entity' | 'department' | 'location' | 'owner' | 'alertOwner'
        | 'manager' | 'alertManager' | 'approver' | 'vertical' | 'lawCategory' | 'nature' | 'penalty',
        string
    >
>;

export async function addInternal(values: InternalValues): Promise<CreateSummary | Failure> {
    return readOutcome<CreateSummary>(await apiRaw('/library/internal', { method: 'POST', body: values }));
}

export type EditValues = {
    title: string;
    description: string;
    attachment: string;
    proofOfCompliance: string;
    risk: string;
    applicability: string;
    penalty: string;
    alertOwnerDays: string;
    alertManagerDays: string;
    isActive: string;
};

export const editInternal = (id: string, values: EditValues) =>
    api<{ id: string; code: string; changed: string[] }>(`/library/internal/${id}`, { method: 'PATCH', body: values });

// After a change, every list that shows library items is out of date
export function useRefreshLibrary() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: ['library'] });
}