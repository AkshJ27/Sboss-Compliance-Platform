import { z } from 'zod';
import { INDIAN_STATES } from '../../lib/india';
import { dateOnlyField } from '../../lib/validators';

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);

export const idParamSchema = z.object({ id: uuid });
export const fileParamSchema = z.object({ id: uuid, fileId: uuid });
export const fileIdParamSchema = z.object({ fileId: uuid });

// "CENTRAL" or one state's name
const region = z.union([z.literal('CENTRAL'), z.enum(INDIAN_STATES)]);

export const SORT_FIELDS = ['notificationDate', 'publishedDate', 'referenceNumber', 'title'] as const;

export const listQuerySchema = z.object({
    view: z.enum(['mapped', 'all']).default('mapped'),
    region: region.optional(),
    lawCategoryId: uuid.optional(),
    actId: uuid.optional(),
    ruleId: uuid.optional(),
    impact: z.enum(['yes', 'no']).optional(),
    from: dateOnlyField.optional(), // notification date on or after
    to: dateOnlyField.optional(),
    search: text(100).optional(),
    sort: z.enum(SORT_FIELDS).default('notificationDate'),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const rulesQuerySchema = z.object({ actId: uuid });

export const zipQuerySchema = z.object({
    ids: z
        .string()
        .max(5000)
        .optional()
        .transform((s) => (s ? s.split(',').filter(Boolean) : []))
        .pipe(z.array(uuid).max(100)),
});

const updateFields = {
    actId: uuid,
    ruleId: uuid.nullable().optional(),
    ministry: text(200).nullable().optional(),
    notificationDate: dateOnlyField,
    effectiveDate: dateOnlyField.nullable().optional(),
    publishedDate: dateOnlyField.optional(), // left out: the notification date
    referenceNumber: text(200).nullable().optional(),
    title: text(500).min(3, 'Enter the title'),
    description: text(20000).min(3, 'Enter the description'),
    complianceImpact: z.boolean().optional(),
    isChange: z.boolean().optional(),
    isAddition: z.boolean().optional(),
    isDeletion: z.boolean().optional(),
    isSchedule: z.boolean().optional(),
    impactedCompliance: text(5000).nullable().optional(),
};

// notify: tell the people who follow this Act (new updates only)
export const createSchema = z.object({ ...updateFields, notify: z.boolean().optional() }).strict();
export type CreateInput = z.infer<typeof createSchema>;

export const updateSchema = z
    .object({
        ...updateFields,
        actId: uuid.optional(),
        notificationDate: dateOnlyField.optional(),
        title: updateFields.title.optional(),
        description: updateFields.description.optional(),
        publishedDate: dateOnlyField.optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateInput = z.infer<typeof updateSchema>;

export const importQuerySchema = z.object({
    dryRun: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    notify: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});

// ---- Configure LU Page --------------------------------------------------------------------

export const actsQuerySchema = z.object({
    userId: uuid.optional(), // admins can look at someone else's choices
    region: region.optional(),
    lawCategoryId: uuid.optional(),
    search: text(100).optional(),
    mapped: z.enum(['yes', 'no']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ActsQuery = z.infer<typeof actsQuerySchema>;

export const subscriptionSchema = z
    .object({
        userId: uuid.optional(),
        actId: uuid,
        display: z.boolean(),
        emailAlerts: z.boolean(),
    })
    .strict();
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;

export const bulkSubscriptionSchema = z
    .object({
        userId: uuid.optional(),
        actIds: z.array(uuid).min(1).max(1000).optional(),
        // Instead of a list: every Act matching these filters
        allMatching: z
            .object({ region: region.optional(), lawCategoryId: uuid.optional(), search: text(100).optional() })
            .strict()
            .optional(),
        display: z.boolean(),
        emailAlerts: z.boolean().optional(), // left out: kept as it is
    })
    .strict()
    .refine((v) => !!v.actIds !== !!v.allMatching, 'Send either actIds or allMatching');
export type BulkSubscriptionInput = z.infer<typeof bulkSubscriptionSchema>;