import { z } from 'zod';
import { dateOnlyField } from '../../lib/validators';

const uuid = z.string().uuid();

export const replicateSchema = z
    .object({
        sourceLocationId: uuid,
        targetLocationIds: z.array(uuid).min(1).max(50),
        startDate: dateOnlyField,
        actIds: z.array(uuid).max(200).optional(), // copy only these Acts
        departmentId: uuid.optional(),
        verticalId: uuid.optional(),
        ownerId: uuid.optional(),
        managerId: uuid.optional(),
        approverId: uuid.optional(),
    })
    .strict()
    .refine((v) => !v.targetLocationIds.includes(v.sourceLocationId), {
        message: 'The source location cannot also be a target',
        path: ['targetLocationIds'],
    })
    .refine((v) => new Set(v.targetLocationIds).size === v.targetLocationIds.length, {
        message: 'Each target location can only be chosen once',
        path: ['targetLocationIds'],
    })
    .refine((v) => !v.ownerId || !v.managerId || v.ownerId !== v.managerId, {
        message: 'Owner and manager must be different people',
        path: ['managerId'],
    })
    .refine((v) => !v.approverId || (v.approverId !== v.ownerId && v.approverId !== v.managerId), {
        message: 'The approver must be a different person from the owner and manager',
        path: ['approverId'],
    });
export type ReplicateInput = z.output<typeof replicateSchema>;

export const swapSchema = z
    .object({
        fromUserId: uuid,
        toUserId: uuid,
        roles: z
            .array(z.enum(['OWNER', 'MANAGER', 'APPROVER']))
            .min(1)
            .max(3)
            .transform((a) => [...new Set(a)]),
        entityId: uuid.optional(),
        locationId: uuid.optional(),
        includeOpenItems: z.boolean().default(true),
        note: z.string().trim().max(500).optional(),
    })
    .strict()
    .refine((v) => v.fromUserId !== v.toUserId, {
        message: 'Choose two different people',
        path: ['toUserId'],
    });
export type SwapInput = z.output<typeof swapSchema>;

export const importQuerySchema = z.object({
    dryRun: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
    startDate: dateOnlyField.optional(), // used for rows that have no start date
});