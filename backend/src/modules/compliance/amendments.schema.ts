import { z } from 'zod';

const uuid = z.string().uuid();
const paging = {
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
};

export const complianceParamSchema = z.object({ complianceId: uuid });

export const listQuerySchema = z.object({
    kind: z.enum(['all', 'decision', 'info']).default('all'),
    search: z.string().trim().max(100).optional(),
    ...paging,
});
export type ListQuery = z.output<typeof listQuerySchema>;

export const historyQuerySchema = z.object({
    decision: z.enum(['APPLIED', 'KEPT', 'ACKNOWLEDGED']).optional(),
    ...paging,
});
export type HistoryQuery = z.output<typeof historyQuerySchema>;

export const decisionSchema = z
    .object({
        decision: z.enum(['APPLY', 'KEEP', 'ACKNOWLEDGE']),
        version: z.number().int().min(1), // the library version the admin reviewed
        note: z.string().trim().max(500).optional(),
    })
    .strict();
export type DecisionInput = z.output<typeof decisionSchema>;