import { z } from 'zod';
import { emailField, passwordField } from '../../lib/validators';

const tokenField = z.string().min(20).max(200);

export const forgotSchema = z.object({ email: emailField }).strict();

export const checkTokenSchema = z
    .object({ token: tokenField, purpose: z.enum(['reset', 'invite']) })
    .strict();

export const setPasswordSchema = z.object({ token: tokenField, password: passwordField }).strict();

export const changePasswordSchema = z
    .object({ currentPassword: z.string().min(1).max(72), newPassword: passwordField })
    .strict();