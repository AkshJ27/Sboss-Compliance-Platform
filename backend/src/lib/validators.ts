import { z } from 'zod';

export const emailField = z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email')
    .max(254);

// bcrypt only uses the first 72 bytes, so cap the length there
export const passwordField = z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(72, 'Password must be at most 72 characters');

export const nameField = z.string().trim().min(2, 'Too short').max(120);

export const dateOnlyField = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine((s) => {
        const d = new Date(`${s}T00:00:00.000Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, 'Invalid date');