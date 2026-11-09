import { z } from 'zod';
import { dateOnlyField } from '../../lib/validators';
import { INSTANCE_STATUSES } from '../compliance/compliance.schema';
import { DASHBOARD_STATUSES, dimensionShape, list } from '../compliance/filters';

// The same filters as the record list, plus the file format
export const exportQuerySchema = z
    .object({
        ...dimensionShape,
        status: list(z.enum(INSTANCE_STATUSES)),
        dashboardStatus: list(z.enum(DASHBOARD_STATUSES)),
        dueFrom: dateOnlyField.optional(),
        dueTo: dateOnlyField.optional(),
        overdue: z.enum(['true']).optional(),
        search: z.string().trim().max(100).optional(),
        order: z.enum(['asc', 'desc']).default('asc'),
        format: z.enum(['csv', 'xlsx']).default('csv'),
    })
    .refine((v) => !v.dueFrom || !v.dueTo || v.dueTo >= v.dueFrom, {
        message: 'dueTo must be on or after dueFrom',
        path: ['dueTo'],
    });
export type ExportQuery = z.output<typeof exportQuerySchema>;