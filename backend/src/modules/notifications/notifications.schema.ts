import { z } from 'zod';
import { dateOnlyField } from '../../lib/validators';

export const NOTIFICATION_TYPES = [
    'REVIEW_REQUESTED', 'RETURNED', 'CLOSED', 'ASSIGNED', 'DAILY_DIGEST',
] as const;

const uuid = z.string().uuid();

export const listQuerySchema = z.object({
    unread: z.enum(['true']).optional(),
    type: z.enum(NOTIFICATION_TYPES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.output<typeof listQuerySchema>;

export const idsSchema = z.object({ ids: z.array(uuid).min(1).max(200) }).strict();

export const preferencesSchema = z.object({ emailAlerts: z.boolean() }).strict();

export const digestRunQuerySchema = z.object({
    dryRun: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
    asOf: dateOnlyField.optional(),
    sampleUserId: uuid.optional(),
});