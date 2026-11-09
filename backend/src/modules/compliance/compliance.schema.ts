import { z } from 'zod';
import { INDIAN_STATES } from '../../lib/india';
import { parseDateOnly } from '../../lib/dates';
import { dateOnlyField } from '../../lib/validators';
import { FREQUENCIES, RISKS } from '../library/library.schema';

const uuid = z.string().uuid();

export const INSTANCE_STATUSES = [
    'DUE', 'SUBMITTED', 'MANAGER_APPROVED', 'CLOSED', 'RETURNED', 'NOT_APPLICABLE',
] as const;

const paging = {
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
};

export const idParamSchema = z.object({ id: uuid });

export const dryRunQuerySchema = z.object({
    dryRun: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
});

// Activation
export const activateSchema = z
    .object({
        entityId: uuid,
        locationId: uuid,
        departmentId: uuid.optional(),
        verticalId: uuid.optional(),
        ownerId: uuid,
        managerId: uuid,
        approverId: uuid.optional(),
        startDate: dateOnlyField,
        actIds: z.array(uuid).max(200).default([]),
        complianceIds: z.array(uuid).max(2000).default([]),
        excludeComplianceIds: z.array(uuid).max(2000).default([]),
    })
    .strict()
    .refine((v) => v.actIds.length + v.complianceIds.length > 0, {
        message: 'Choose at least one Act or compliance',
        path: ['actIds'],
    })
    .refine((v) => v.ownerId !== v.managerId, {
        message: 'Owner and manager must be different people',
        path: ['managerId'],
    })
    .refine((v) => !v.approverId || (v.approverId !== v.ownerId && v.approverId !== v.managerId), {
        message: 'The approver must be a different person from the owner and manager',
        path: ['approverId'],
    });
export type ActivateInput = z.infer<typeof activateSchema>;

export const scheduleUpdateSchema = z
    .object({
        ownerId: uuid.optional(),
        managerId: uuid.optional(),
        approverId: uuid.nullable().optional(),
        isActive: z.boolean().optional(),
        applyToOpenInstances: z.boolean().default(true),
    })
    .strict()
    .refine(
        (v) =>
            v.ownerId !== undefined ||
            v.managerId !== undefined ||
            v.approverId !== undefined ||
            v.isActive !== undefined,
        'Nothing to update',
    );
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>;

export const scheduleListQuerySchema = z.object({
    entityId: uuid.optional(),
    locationId: uuid.optional(),
    departmentId: uuid.optional(),
    verticalId: uuid.optional(),
    actId: uuid.optional(),
    ownerId: uuid.optional(),
    managerId: uuid.optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
    search: z.string().trim().max(100).optional(),
    ...paging,
});
export type ScheduleListQuery = z.infer<typeof scheduleListQuerySchema>;

// Generation
export const generateSchema = z
    .object({
        from: dateOnlyField,
        to: dateOnlyField,
        entityId: uuid.optional(),
        locationId: uuid.optional(),
        scheduleIds: z.array(uuid).max(500).optional(),
    })
    .strict()
    .refine((v) => v.to >= v.from, {
        message: 'To date must be on or after the from date',
        path: ['to'],
    })
    .refine(
        (v) => (parseDateOnly(v.to).getTime() - parseDateOnly(v.from).getTime()) / 86_400_000 <= 740,
        { message: 'The range can be at most 2 years', path: ['to'] },
    );
export type GenerateInput = z.infer<typeof generateSchema>;
