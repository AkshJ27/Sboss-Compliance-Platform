import type { Prisma } from '@prisma/client';
import { z } from 'zod';

// Sorting and per-column text filters for the record list and its exports.
// Everything here is plain logic with no database, so it is easy to test.

export const SORT_KEYS = [
    'dueDate', 'owner', 'manager', 'entity', 'vertical', 'department', 'location', 'act', 'title', 'frequency', 'risk',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

// The text columns that can be filtered with rules
export const FILTER_KEYS = ['owner', 'manager', 'entity', 'vertical', 'department', 'location', 'act', 'title', 'code'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const OPS = ['startsWith', 'contains', 'notContains', 'endsWith', 'equals', 'notEquals'] as const;
export type Op = (typeof OPS)[number];

const ruleSchema = z.object({ op: z.enum(OPS), value: z.string().trim().min(1).max(100) }).strict();
const columnSchema = z
    .object({
        col: z.enum(FILTER_KEYS),
        match: z.enum(['all', 'any']).default('all'),
        rules: z.array(ruleSchema).min(1).max(5),
    })
    .strict();
export type ColumnFilter = z.output<typeof columnSchema>;

// Sent in the address as JSON, such as ?cf=[{"col":"owner","match":"all","rules":[{"op":"contains","value":"amita"}]}]
const parseJson = (v: unknown) => {
    if (v === undefined || v === '') return undefined;
    if (typeof v !== 'string') return v;
    try {
        return JSON.parse(v) as unknown;
    } catch {
        return v; // let validation reject it
    }
};
export const columnFiltersField = z.preprocess(parseJson, z.array(columnSchema).max(FILTER_KEYS.length).optional());

// Ticked rows for an export: "?ids=a,b,c". At most 100, so the address stays a sensible length.
export const MAX_SELECTED = 100;
const toIds = (v: unknown) => {
    if (v === undefined || v === '') return undefined;
    const raw = Array.isArray(v) ? v : [v];
    if (!raw.every((x) => typeof x === 'string')) return raw;
    const parts = (raw as string[]).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
    return parts.length ? [...new Set(parts)] : undefined;
};
export const selectedIdsField = z.preprocess(toIds, z.array(z.string().uuid()).max(MAX_SELECTED).optional());

const insensitive = 'insensitive' as const;

// Where each filterable column lives
const AT: Record<FilterKey, (f: Prisma.StringFilter) => Prisma.ComplianceInstanceWhereInput> = {
    owner: (f) => ({ owner: { name: f } }),
    manager: (f) => ({ manager: { name: f } }),
    entity: (f) => ({ entity: { name: f } }),
    vertical: (f) => ({ vertical: { is: { name: f } } }),
    department: (f) => ({ department: { is: { name: f } } }),
    location: (f) => ({ location: { name: f } }),
    act: (f) => ({ compliance: { act: { name: f } } }),
    title: (f) => ({ compliance: { title: f } }),
    code: (f) => ({ compliance: { code: f } }),
};

function ruleWhere(col: FilterKey, op: Op, value: string): Prisma.ComplianceInstanceWhereInput {
    switch (op) {
        case 'startsWith':
            return AT[col]({ startsWith: value, mode: insensitive });
        case 'endsWith':
            return AT[col]({ endsWith: value, mode: insensitive });
        case 'contains':
            return AT[col]({ contains: value, mode: insensitive });
        case 'equals':
            return AT[col]({ equals: value, mode: insensitive });
        case 'notContains':
            return { NOT: AT[col]({ contains: value, mode: insensitive }) };
        case 'notEquals':
            return { NOT: AT[col]({ equals: value, mode: insensitive }) };
    }
}

// Every column's filter must hold. Within a column, all rules or any rule, as the user chose.
export function columnFilterWhere(filters: readonly ColumnFilter[]): Prisma.ComplianceInstanceWhereInput {
    return {
        AND: filters.map((f) => {
            const parts = f.rules.map((r) => ruleWhere(f.col, r.op, r.value));
            return f.match === 'any' ? { OR: parts } : { AND: parts };
        }),
    };
}

// The list order: the chosen column first, then due date, then id so pages never shuffle
export function orderFor(sort: SortKey | undefined, order: 'asc' | 'desc'): Prisma.ComplianceInstanceOrderByWithRelationInput[] {
    const o = order;
    const first: Record<SortKey, Prisma.ComplianceInstanceOrderByWithRelationInput> = {
        dueDate: { dueDate: o },
        owner: { owner: { name: o } },
        manager: { manager: { name: o } },
        entity: { entity: { name: o } },
        vertical: { vertical: { name: o } },
        department: { department: { name: o } },
        location: { location: { name: o } },
        act: { compliance: { act: { name: o } } },
        title: { compliance: { title: o } },
        frequency: { compliance: { frequency: o } },
        risk: { compliance: { risk: o } },
    };
    const key = sort ?? 'dueDate';
    return key === 'dueDate' ? [first.dueDate, { id: 'asc' }] : [first[key], { dueDate: 'asc' }, { id: 'asc' }];
}