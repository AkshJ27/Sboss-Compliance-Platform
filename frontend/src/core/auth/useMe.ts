import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export type Me = {
    id: string;
    name: string;
    email: string;
    role: string;
    isPlatformAdmin: boolean;
    organization: { id: string; name: string };
};

export const useMe = () =>
    useQuery({
        queryKey: ['me'],
        queryFn: ({ signal }) => api<Me>('/auth/me', { signal }),
        staleTime: 5 * 60_000,
    });