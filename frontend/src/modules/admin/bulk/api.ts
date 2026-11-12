import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import type { Opt } from '../RemoteSelect';

type LocationHit = { id: string; name: string; state: string; entity: { code: string } };

// Locations of the company, searched on the server as the person types
export async function loadLocationOptions(
    search: string,
    signal: AbortSignal,
    opts: { entityId?: string; excludeId?: string; includeInactive?: boolean } = {},
): Promise<Opt[]> {
    const params = new URLSearchParams({ limit: '50' });
    if (search) params.set('search', search);
    if (opts.entityId) params.set('entityId', opts.entityId);
    if (opts.includeInactive) params.set('includeInactive', 'true');
    const res = await api<{ items: LocationHit[] }>(`/masters/locations?${params.toString()}`, { signal });
    return res.items
        .filter((l) => l.id !== opts.excludeId)
        .map((l) => ({ value: l.id, label: `${l.entity.code} / ${l.name}, ${l.state}` }));
}

export async function loadActOptions(search: string, signal: AbortSignal): Promise<Opt[]> {
    const params = new URLSearchParams({ limit: '50' });
    if (search) params.set('search', search);
    const res = await api<{ items: { id: string; name: string; state: string | null }[] }>(
        `/library/acts?${params.toString()}`,
        { signal },
    );
    return res.items.map((a) => ({ value: a.id, label: a.state ? `${a.name} (${a.state})` : a.name }));
}

// After a bulk change, every screen that shows schedules, records or counts is out of date
export function useRefreshAfterBulk() {
    const qc = useQueryClient();
    return () =>
        Promise.all(
            ['schedules', 'records', 'record', 'dashboard', 'facets', 'notifications', 'documents'].map((key) =>
                qc.invalidateQueries({ queryKey: [key] }),
            ),
        );
}