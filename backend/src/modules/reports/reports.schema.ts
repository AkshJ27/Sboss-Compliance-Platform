import { z } from 'zod';
import { dateOnlyField } from '../../lib/validators';
import { INSTANCE_STATUSES } from '../compliance/compliance.schema';
import { GROUP_BY } from './summary.calc';
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

// The summary report: the dashboard's period and filters, plus how to group the rows
export const summaryQuerySchema = z
    .object({
        ...dimensionShape,
        groupBy: z.enum(GROUP_BY).default('entityId'),
        quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4', 'YTD']).optional(),
        fy: z.coerce.number().int().min(2000).max(2100).optional(),
        dueFrom: dateOnlyField.optional(),
        dueTo: dateOnlyField.optional(),
        format: z.enum(['csv', 'xlsx']).default('csv'),
    })
    .refine((v) => (v.dueFrom === undefined) === (v.dueTo === undefined), {
        message: 'Send both dueFrom and dueTo, or neither',
        path: ['dueTo'],
    })
    .refine((v) => !v.dueFrom || !v.dueTo || v.dueTo >= v.dueFrom, {
        message: 'dueTo must be on or after dueFrom',
        path: ['dueTo'],
    })
    .refine((v) => !(v.quarter && v.dueFrom), {
        message: 'Use either quarter or dueFrom and dueTo, not both',
        path: ['quarter'],
    });
export type SummaryQuery = z.output<typeof summaryQuerySchema>;