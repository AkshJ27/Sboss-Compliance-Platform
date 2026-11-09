import { z } from 'zod';
import { dateOnlyField } from '../../lib/validators';

export const auditQuerySchema = z
    .object({
        userId: z.string().uuid().optional(),
        action: z.string().trim().min(1).max(100).optional(),
        entityType: z.string().trim().min(1).max(100).optional(),
        entityId: z.string().trim().min(1).max(100).optional(),
        from: dateOnlyField.optional(),
        to: dateOnlyField.optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .refine((v) => !v.from || !v.to || v.to >= v.from, {
        message: 'to must be on or after from',
        path: ['to'],
    });
export type AuditQuery = z.output<typeof auditQuerySchema>;