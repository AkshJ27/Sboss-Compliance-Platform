export type Role = 'ORG_ADMIN' | 'MEMBER' | 'VIEWER';
export type SessionUser = { id: string; orgId: string; name: string; email: string; role: Role };

export class ApiError extends Error {
    status: number;
    details: unknown;
    constructor(status: number, message: string, details?: unknown) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.details = details;
    }
}

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export const setAccessToken = (token: string | null) => {
    accessToken = token;
};
export const setSessionLostHandler = (fn: (() => void) | null) => {
    onSessionLost = fn;
};

export type RefreshResult =
    | { kind: 'ok'; user: SessionUser }
    | { kind: 'denied' }
    | { kind: 'unavailable' };

async function doRefresh(): Promise<RefreshResult> {
    try {
        const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
            // A hung request must not hold the lock for other tabs forever
            signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15_000) : undefined,
        });
        if (res.status === 401 || res.status === 403) {
            accessToken = null;
            return { kind: 'denied' };
        }
        if (!res.ok) return { kind: 'unavailable' };
        const data = (await res.json()) as { accessToken: string; user: SessionUser };
        accessToken = data.accessToken;
        return { kind: 'ok', user: data.user };
    } catch {
        return { kind: 'unavailable' };
    }
}

// Separate browser tabs take turns, so two tabs never rotate the same refresh cookie at once.
// Awaiting the lock's result gives a plain RefreshResult whichever way TypeScript types the call.
async function refreshExclusively(): Promise<RefreshResult> {
    if ('locks' in navigator) {
        const result: RefreshResult = await navigator.locks.request('compliance-session-refresh', () => doRefresh());
        return result;
    }
    return doRefresh();
}

// Everyone who asks while a refresh is running gets the same answer
let refreshing: Promise<RefreshResult> | null = null;
export function refreshSession(): Promise<RefreshResult> {
    if (!refreshing) {
        refreshing = refreshExclusively().finally(() => {
            refreshing = null;
        });
    }
    return refreshing;
}

export type Options = {
    method?: string;
    body?: unknown;
    form?: FormData;
    auth?: boolean; // false for login and logout
    signal?: AbortSignal;
};

async function send(path: string, o: Options): Promise<Response> {
    const headers: Record<string, string> = {};
    if (o.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let body: BodyInit | undefined;
    if (o.form) {
        body = o.form;
    } else if (o.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(o.body);
    }

    try {
        return await fetch(`/api${path}`, {
            method: o.method ?? 'GET',
            headers,
            body,
            credentials: 'include',
            signal: o.signal,
        });
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        throw new ApiError(0, 'Cannot reach the server');
    }
}

async function request(path: string, o: Options): Promise<Response> {
    let res = await send(path, o);
    if (res.status === 401 && o.auth !== false) {
        const r = await refreshSession();
        if (r.kind === 'ok') res = await send(path, o);
        else if (r.kind === 'denied') onSessionLost?.();
        else throw new ApiError(503, 'The service is temporarily unavailable');
    }
    return res;
}

async function fail(res: Response): Promise<never> {
    let message = `Request failed (${res.status})`;
    let details: unknown;
    try {
        const data = (await res.json()) as { error?: string; details?: unknown };
        if (data.error) message = data.error;
        details = data.details;
    } catch {
        // The body was not JSON
    }
    throw new ApiError(res.status, message, details);
}

export async function api<T = unknown>(path: string, o: Options = {}): Promise<T> {
    const res = await request(path, o);
    if (!res.ok) return fail(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

// Downloads a file the server generates (exports), using the name the server gives it
// Pass options for a download that needs a POST, such as one that sends the ticked rows
export async function apiDownload(path: string, o: Options = {}): Promise<void> {
    const res = await request(path, o);
    if (!res.ok) return fail(res);

    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// For callers that need the raw response, such as the library import's row-by-row errors
export const apiRaw = request;