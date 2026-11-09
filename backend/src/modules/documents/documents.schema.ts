import { z } from 'zod';
import { dateOnlyField } from '../../lib/validators';

export const ACCESS_LEVELS = ['PUBLIC', 'PRIVATE', 'PROTECTED', 'RESTRICTED'] as const;

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const paging = {
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
};

export const idParamSchema = z.object({ id: uuid });
export const tokenParamSchema = z.object({ token: z.string().min(20).max(2000) });

export const uploadFieldsSchema = z
    .object({
        instanceId: uuid.optional(),
        title: text(200).min(1).optional(),
        description: text(1000).optional(),
        docNumber: text(100).optional(),
        accessLevel: z.enum(ACCESS_LEVELS).optional(),
        expiresAt: dateOnlyField.optional(),
    })
    .strict();
export type UploadFields = z.infer<typeof uploadFieldsSchema>;

export const updateSchema = z
    .object({
        title: text(200).min(1).optional(),
        description: text(1000).nullable().optional(),
        docNumber: text(100).nullable().optional(),
        accessLevel: z.enum(ACCESS_LEVELS).optional(),
        expiresAt: dateOnlyField.nullable().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateInput = z.infer<typeof updateSchema>;

export const listQuerySchema = z
    .object({
        instanceId: uuid.optional(),
        standalone: z.enum(['true']).optional(),
        entityId: uuid.optional(),
        accessLevel: z.enum(ACCESS_LEVELS).optional(),
        uploadedById: uuid.optional(),
        expired: z.enum(['true']).optional(),
        expiringInDays: z.coerce.number().int().min(1).max(365).optional(),
        search: text(100).optional(),
        ...paging,
    })
    .refine((v) => !(v.instanceId && v.standalone), {
        message: 'Use either instanceId or standalone, not both',
        path: ['standalone'],
    });
export type ListQuery = z.infer<typeof listQuerySchema>;

export const missingQuerySchema = z.object({
    entityId: uuid.optional(),
    locationId: uuid.optional(),
    ownerId: uuid.optional(),
    dueFrom: dateOnlyField.optional(),
    dueTo: dateOnlyField.optional(),
    ...paging,
});
export type MissingQuery = z.infer<typeof missingQuerySchema>;