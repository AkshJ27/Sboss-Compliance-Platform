import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from '../api/client';
import type { SessionUser } from '../api/client';

type Status = 'loading' | 'authenticated' | 'anonymous' | 'unavailable';

type AuthValue = {
    status: Status;
    user: SessionUser | null;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    retry: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();
    const [status, setStatus] = useState<Status>('loading');
    const [user, setUser] = useState<SessionUser | null>(null);
    const [attempt, setAttempt] = useState(0);

    // On every page load, the refresh cookie decides whether you are still signed in
    useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        void refreshSession().then((r) => {
            if (cancelled) return;
            if (r.kind === 'ok') {
                setUser(r.user);
                setStatus('authenticated');
            } else if (r.kind === 'denied') {
                setUser(null);
                setStatus('anonymous');
            } else {
                setStatus('unavailable'); // the server did not answer: not the same as signed out
            }
        });
        return () => {
            cancelled = true;
        };
    }, [attempt]);

    useEffect(() => {
        setSessionLostHandler(() => {
            setAccessToken(null);
            setUser(null);
            setStatus('anonymous');
            queryClient.clear();
        });
        return () => setSessionLostHandler(null);
    }, [queryClient]);

    const login = useCallback(
        async (email: string, password: string) => {
            const data = await api<{ accessToken: string; user: SessionUser }>('/auth/login', {
                method: 'POST',
                body: { email, password },
                auth: false,
            });
            setAccessToken(data.accessToken);
            queryClient.clear();
            setUser(data.user);
            setStatus('authenticated');
        },
        [queryClient],
    );

    const logout = useCallback(async () => {
        try {
            await api('/auth/logout', { method: 'POST', auth: false });
        } catch {
            // Sign out here even if the server could not be told
        }
        setAccessToken(null);
        queryClient.clear();
        setUser(null);
        setStatus('anonymous');
    }, [queryClient]);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);

    const value = useMemo(
        () => ({ status, user, login, logout, retry }),
        [status, user, login, logout, retry],
    );
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
}