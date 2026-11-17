import { z } from 'zod';
import { INDIAN_STATES } from '../../lib/india';

export const FREQUENCIES = [
    'ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'EVENT_BASED',
] as const;
export const RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const ATTACHMENTS = ['MANDATORY', 'OPTIONAL', 'NOT_REQUIRED'] as const;
export const PERIOD_BASES = ['FINANCIAL_YEAR', 'CALENDAR_YEAR'] as const;

// Fields compared when deciding if an item changed, and recorded in revisions
export const COMPARE_KEYS = [
    'title', 'description', 'form', 'reference', 'risk', 'impact', 'attachment',
    'frequency', 'periodBasis', 'dueDay', 'dueMonthOffset', 'event',
    'dueDaysAfterEvent', 'penalty', 'imprisonment', 'isActive',
];

const uuid = z.string().uuid();
const nonEmpty = (v: object) => Object.keys(v).length > 0;
const boolQuery = z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true');
const paging = {
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
};

export const idParamSchema = z.object({ id: uuid });

export const importQuerySchema = z.object({
    dryRun: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
});

export const actListQuerySchema = z.object({
    lawCategoryId: uuid.optional(),
    jurisdiction: z.enum(['CENTRAL', 'STATE']).optional(),
    state: z.enum(INDIAN_STATES).optional(),
    search: z.string().trim().max(100).optional(),
    includeInactive: boolQuery,
    ...paging,
});

export const complianceListQuerySchema = z.object({
    actId: uuid.optional(),
    lawCategoryId: uuid.optional(),
    jurisdiction: z.enum(['CENTRAL', 'STATE']).optional(),
    state: z.enum(INDIAN_STATES).optional(),
    natureId: uuid.optional(),
    frequency: z.enum(FREQUENCIES).optional(),
    risk: z.enum(RISKS).optional(),
    search: z.string().trim().max(100).optional(),
    includeInactive: boolQuery,
    // STATUTORY: the shared library. INTERNAL: the company's own compliances.
    type: z.enum(['STATUTORY', 'INTERNAL']).optional(),
    // MAPPED: scheduled at one or more of the company's locations. UNMAPPED: not scheduled anywhere.
    mapping: z.enum(['MAPPED', 'UNMAPPED']).optional(),
    ...paging,
});

export const complianceUpdateSchema = z
    .object({
        title: z.string().trim().min(3).max(500).optional(),
        description: z.string().trim().max(5000).nullable().optional(),
        form: z.string().trim().max(200).nullable().optional(),
        reference: z.string().trim().max(200).nullable().optional(),
        risk: z.enum(RISKS).optional(),
        impact: z.enum(RISKS).optional(),
        attachment: z.enum(ATTACHMENTS).optional(),
        frequency: z.enum(FREQUENCIES).optional(),
        periodBasis: z.enum(PERIOD_BASES).optional(),
        dueDay: z.number().int().min(1).max(31).nullable().optional(),
        dueMonthOffset: z.number().int().min(-24).max(24).optional(),
        event: z.string().trim().max(300).nullable().optional(),
        dueDaysAfterEvent: z.number().int().min(-3650).max(3650).nullable().optional(),
        penalty: z.string().trim().max(2000).nullable().optional(),
        imprisonment: z.boolean().optional(),
        isActive: z.boolean().optional(),
    })
    .strict()
    .refine(nonEmpty, 'Nothing to update');

// One rule for both the importer and single edits
export function scheduleProblem(c: {
    frequency: string;
    dueDay?: number | null;
    event?: string | null;
    dueDaysAfterEvent?: number | null;
}): string | null {
    if (c.frequency === 'EVENT_BASED') {
        if (!c.event) return 'Event is required for event-based compliances';
        if (c.dueDaysAfterEvent == null) return 'Due days after event is required for event-based compliances';
        return null;
    }
    if (c.frequency !== 'ONE_TIME' && c.dueDay == null) {
        return 'Due day is required for recurring compliances';
    }
    return null;
}