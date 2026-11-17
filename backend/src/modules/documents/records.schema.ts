import { z } from 'zod';
import { dateOnlyField } from '../../lib/validators';
import { ACCESS_LEVELS } from './documents.schema';

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable().optional();
const boolQuery = z.enum(['true', 'false']).optional().transform((v) => v === 'true');

export const idParamSchema = z.object({ id: uuid });
export const fileParamSchema = z.object({ id: uuid, fileId: uuid });

// ---- Categories (category, sub category, sub sub category) --------------------------

export const categoryListQuerySchema = z.object({
    level: z.coerce.number().int().min(1).max(3).optional(),
    parentId: uuid.optional(),
    includeInactive: boolQuery,
});
export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;

export const categoryCreateSchema = z
    .object({ name: text(200).min(2, 'At least 2 characters'), parentId: uuid.nullable().optional() })
    .strict();
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z
    .object({ name: text(200).min(2, 'At least 2 characters').optional(), isActive: z.boolean().optional() })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

// ---- Documents ----------------------------------------------------------------------

const recordFields = {
    entityId: uuid,
    verticalId: uuid,
    locationId: uuid,
    departmentId: uuid,
    categoryId: uuid,
    subCategoryId: uuid.nullable().optional(),
    subSubCategoryId: uuid.nullable().optional(),
    name: text(500).min(1, 'Enter the document name'),
    docNumber: optionalText(100),
    accessLevel: z.enum(ACCESS_LEVELS),
    storedAt: optionalText(200),
    ownerId: uuid.optional(), // left out: the person adding it
    managerId: uuid.nullable().optional(),
    reviewDate: dateOnlyField.nullable().optional(),
    expiryDate: dateOnlyField.nullable().optional(),
    alertDays: z.number().int().min(0).max(999).nullable().optional(),
    remarks: optionalText(1000),
    additionalUserIds: z.array(uuid).max(50).optional(),
};

// A sub sub category needs its sub category
const levelsInOrder = (v: { subCategoryId?: string | null; subSubCategoryId?: string | null }) =>
    !v.subSubCategoryId || !!v.subCategoryId;
const levelsMessage = { message: 'Choose the sub category before the sub sub category', path: ['subSubCategoryId'] };

export const recordCreateSchema = z.object(recordFields).strict().refine(levelsInOrder, levelsMessage);
export type RecordCreateInput = z.infer<typeof recordCreateSchema>;

export const recordUpdateSchema = z
    .object({
        ...recordFields,
        entityId: uuid.optional(),
        verticalId: uuid.optional(),
        locationId: uuid.optional(),
        departmentId: uuid.optional(),
        categoryId: uuid.optional(),
        name: recordFields.name.optional(),
        accessLevel: recordFields.accessLevel.optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to change')
    .refine(levelsInOrder, levelsMessage);
export type RecordUpdateInput = z.infer<typeof recordUpdateSchema>;

export const SORT_FIELDS = ['name', 'docNumber', 'createdAt', 'expiryDate', 'reviewDate'] as const;

export const recordListQuerySchema = z.object({
    entityId: uuid.optional(),
    locationId: uuid.optional(),
    departmentId: uuid.optional(),
    accessLevel: z.enum(ACCESS_LEVELS).optional(),
    categoryId: uuid.optional(),
    subCategoryId: uuid.optional(),
    subSubCategoryId: uuid.optional(),
    ownerId: uuid.optional(),
    from: dateOnlyField.optional(), // created on or after
    to: dateOnlyField.optional(), // created on or before
    expired: z.enum(['true']).optional(),
    withoutFiles: z.enum(['true']).optional(),
    search: text(100).optional(),
    sort: z.enum(SORT_FIELDS).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type RecordListQuery = z.infer<typeof recordListQuerySchema>;

export const ownerSwapSchema = z
    .object({
        fromUserId: uuid,
        toUserId: uuid,
        recordIds: z.array(uuid).min(1).max(500).optional(), // left out: all of that person's documents
    })
    .strict()
    .refine((v) => v.fromUserId !== v.toUserId, { message: 'Choose two different people', path: ['toUserId'] });
export type OwnerSwapInput = z.infer<typeof ownerSwapSchema>;