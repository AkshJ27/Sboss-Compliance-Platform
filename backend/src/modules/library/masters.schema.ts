import { z } from 'zod';
import { statusQuery } from '../../lib/active-filter';
import { INDIAN_STATES } from '../../lib/india';

// The shared lookup lists behind the law library
export const LOOKUP_KINDS = ['law-categories', 'statutory-authorities', 'natures', 'types'] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

const uuid = z.string().uuid();
const name = (max: number) => z.string().trim().min(2, 'At least 2 characters').max(max);
const boolQuery = z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true');

export const kindParamSchema = z.object({ kind: z.enum(LOOKUP_KINDS) });
export const kindIdParamSchema = z.object({ kind: z.enum(LOOKUP_KINDS), id: uuid });
export const idParamSchema = z.object({ id: uuid });

export const lookupBodySchema = z.object({ name: name(200) }).strict();

// A central Act has no state. A state Act names its state.
const actFields = {
    name: name(300),
    jurisdiction: z.enum(['CENTRAL', 'STATE']),
    state: z.enum(INDIAN_STATES).nullable().optional(),
    lawCategoryId: uuid,
    statutoryAuthorityId: uuid.nullable().optional(),
};
const stateMatches = (v: { jurisdiction?: string; state?: string | null }) =>
    v.jurisdiction === undefined || (v.jurisdiction === 'STATE' ? !!v.state : !v.state);
const stateMessage = { message: 'A state Act needs its state, and a central Act has none', path: ['state'] };

export const actCreateSchema = z.object(actFields).strict().refine(stateMatches, stateMessage);
export type ActCreateInput = z.infer<typeof actCreateSchema>;

export const actUpdateSchema = z
    .object({
        name: actFields.name.optional(),
        jurisdiction: actFields.jurisdiction.optional(),
        state: actFields.state,
        lawCategoryId: uuid.optional(),
        statutoryAuthorityId: actFields.statutoryAuthorityId,
        isActive: z.boolean().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to change')
    .refine(stateMatches, stateMessage);
export type ActUpdateInput = z.infer<typeof actUpdateSchema>;

export const ruleListQuerySchema = z.object({
    actId: uuid.optional(),
    search: z.string().trim().max(100).optional(),
    includeInactive: boolQuery,
    status: statusQuery,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type RuleListQuery = z.infer<typeof ruleListQuerySchema>;

export const ruleCreateSchema = z.object({ actId: uuid, name: name(300) }).strict();
export type RuleCreateInput = z.infer<typeof ruleCreateSchema>;

export const ruleUpdateSchema = z
    .object({ name: name(300).optional(), isActive: z.boolean().optional() })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type RuleUpdateInput = z.infer<typeof ruleUpdateSchema>;