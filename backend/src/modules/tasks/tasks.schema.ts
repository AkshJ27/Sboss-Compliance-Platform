import { z } from 'zod';
import { dateOnlyField } from '../../lib/validators';
import { list } from '../compliance/filters';

const uuid = z.string().uuid();

export const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;

export const idParamSchema = z.object({ id: uuid });

const title = z.string().trim().min(3, 'Give the task a title of at least 3 characters').max(200);
const description = z.string().trim().max(5000);

export const createSchema = z
    .object({
        title,
        description: description.optional(),
        priority: z.enum(PRIORITIES).default('MEDIUM'),
        assigneeId: uuid,
        entityId: uuid.optional(),
        dueDate: dateOnlyField.optional(),
    })
    .strict();
export type CreateInput = z.output<typeof createSchema>;

export const updateSchema = z
    .object({
        title: title.optional(),
        description: description.nullable().optional(),
        priority: z.enum(PRIORITIES).optional(),
        entityId: uuid.nullable().optional(),
        dueDate: dateOnlyField.nullable().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateInput = z.output<typeof updateSchema>;

export const reassignSchema = z
    .object({ assigneeId: uuid, remarks: z.string().trim().max(500).optional() })
    .strict();
export type ReassignInput = z.output<typeof reassignSchema>;

export const statusSchema = z
    .object({ status: z.enum(STATUSES), remarks: z.string().trim().max(500).optional() })
    .strict();
export type StatusInput = z.output<typeof statusSchema>;

export const commentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(2000) }).strict();

// The filters shared by the list and the summary
const common = {
    priority: list(z.enum(PRIORITIES)),
    assigneeId: list(uuid),
    createdById: list(uuid),
    entityId: list(uuid),
    dueFrom: dateOnlyField.optional(),
    dueTo: dateOnlyField.optional(),
    overdue: z.enum(['true']).optional(),
    search: z.string().trim().max(100).optional(),
};
const rangeOk = (v: { dueFrom?: string; dueTo?: string }) => !v.dueFrom || !v.dueTo || v.dueTo >= v.dueFrom;
const rangeIssue = { message: 'dueTo must be on or after dueFrom', path: ['dueTo'] };

// The summary counts every status, so it takes no status filter
export const summaryQuerySchema = z.object(common).refine(rangeOk, rangeIssue);
export type SummaryQuery = z.output<typeof summaryQuerySchema>;

export const listQuerySchema = z
    .object({
        ...common,
        status: list(z.enum(STATUSES)),
        sortBy: z.enum(['due', 'created', 'priority']).default('due'),
        order: z.enum(['asc', 'desc']).default('asc'),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .refine(rangeOk, rangeIssue);
export type ListQuery = z.output<typeof listQuerySchema>;