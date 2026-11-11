import { z } from 'zod';
import { emailField, nameField, passwordField } from '../../lib/validators';

const roleField = z.enum(['ORG_ADMIN', 'MEMBER', 'VIEWER']);

// Without a password, the person is invited by email and chooses their own
export const createUserSchema = z
    .object({
        name: nameField,
        email: emailField,
        password: passwordField.optional(),
        role: roleField.default('MEMBER'),
    })
    .strict();

export const updateUserSchema = z
    .object({
        name: nameField.optional(),
        role: roleField.optional(),
        isActive: z.boolean().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const idParamSchema = z.object({ id: z.string().uuid() });