import { ApiError } from '../core/api/client';

// Turns any failure into one readable line, including the field details of a validation error
export function errorText(e: unknown): string {
    if (e instanceof ApiError) {
        const d = e.details;
        if (Array.isArray(d) && d.length) {
            const parts = d.flatMap((x) => {
                const o = x as { field?: unknown; message?: unknown };
                if (typeof o.message !== 'string') return [];
                return [typeof o.field === 'string' && o.field ? `${o.field}: ${o.message}` : o.message];
            });
            if (parts.length) return `${e.message}. ${parts.join('; ')}`;
        }
        return e.message;
    }
    return 'Something went wrong. Try again.';
}