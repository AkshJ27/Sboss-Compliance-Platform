import { z } from 'zod';
import { emailField, nameField, passwordField } from '../../lib/validators';

export const registerSchema = z.object({
    orgName: nameField,
    name: nameField,
    email: emailField,
    password: passwordField,
});

export const loginSchema = z.object({
    email: emailField,
    password: z.string().min(1).max(72),
});