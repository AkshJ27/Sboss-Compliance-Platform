import { z } from 'zod';
import { dateOnlyField } from '../../lib/validators';

const uuid = z.string().uuid();

export const optionsQuerySchema = z.object({ locationId: uuid });

export const triggerSchema = z
    .object({
        entityId: uuid,
        locationId: uuid,
        event: z.string().trim().min(2).max(300),
        eventDate: dateOnlyField,
        note: z.string().trim().max(500).optional(),
    })
    .strict();
export type TriggerInput = z.output<typeof triggerSchema>;

export const triggerListQuerySchema = z.object({
    entityId: uuid.optional(),
    locationId: uuid.optional(),
    status: z.enum(['active', 'cancelled', 'all']).default('active'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type TriggerListQuery = z.output<typeof triggerListQuerySchema>;