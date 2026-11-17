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
        managerId: z.string().uuid().nullable().optional(), // reporting manager
        defaultApproverId: z.string().uuid().nullable().optional(), // approves their compliance items by default
        employeeCode: z.string().trim().max(50).nullable().optional(),
        mobile: z
            .string()
            .trim()
            .regex(/^[+\d][\d\s-]{6,19}$/, 'Enter a valid phone number')
            .nullable()
            .optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const idParamSchema = z.object({ id: z.string().uuid() });
export const importQuerySchema = z.object({
    dryRun: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    invite: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});