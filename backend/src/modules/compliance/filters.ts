import { InstanceStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { INDIAN_STATES } from '../../lib/india';
import { parseDateOnly } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { dateOnlyField } from '../../lib/validators';
import type { AuthUser } from '../../middleware/auth';
import { ATTACHMENTS, FREQUENCIES, RISKS } from '../library/library.schema';
import { INSTANCE_STATUSES } from './compliance.schema';
import { visibleTo } from './instances.service';
import type { DashboardStatus } from './status';
import { SORT_KEYS, columnFiltersField } from './column-filters';


export const DASHBOARD_STATUSES = [
    'NON_COMPLIANCE', 'LATE_CLOSURE', 'ON_TIME', 'DUE', 'NOT_APPLICABLE', 'PENDING_APPROVAL',
] as const satisfies readonly DashboardStatus[];

const uuid = z.string().uuid();

// "?risk=HIGH,MEDIUM" and "?risk=HIGH&risk=MEDIUM" both give ['HIGH', 'MEDIUM'].
// An empty value means "not set".
function toList(v: unknown): unknown {
    if (v === undefined) return undefined;
    const raw: unknown[] = Array.isArray(v) ? v : [v];
    const strings = raw.filter((x): x is string => typeof x === 'string');
    if (strings.length !== raw.length) return raw; // let validation reject it
    const parts = strings
        .flatMap((s) => s.split(','))
        .map((s) => s.trim())
        .filter(Boolean);
    return parts.length ? [...new Set(parts)] : undefined;
}

export const list = <T extends z.ZodType>(item: T) =>
    z.preprocess(toList, z.array(item).max(50).optional());

// The sixteen filters of the filter panel
export const dimensionShape = {
    entityId: list(uuid),
    locationId: list(uuid),
    departmentId: list(uuid),
    verticalId: list(uuid),
    locationTypeId: list(uuid),
    state: list(z.enum(INDIAN_STATES)),
    lawCategoryId: list(uuid),
    actId: list(uuid),
    ruleId: list(uuid),
    natureId: list(uuid),
    typeId: list(uuid),
    risk: list(z.enum(RISKS)),
    frequency: list(z.enum(FREQUENCIES)),
    attachment: list(z.enum(ATTACHMENTS)),
    ownerId: list(uuid),
    managerId: list(uuid),
};

export const DIMENSIONS = Object.keys(dimensionShape) as (keyof typeof dimensionShape)[];

export const dimensionSchema = z.object(dimensionShape);
export type DimensionFilters = z.output<typeof dimensionSchema>;

export const dashboardQuerySchema = z
    .object({
        ...dimensionShape,
        quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4', 'YTD']).optional(),
        fy: z.coerce.number().int().min(2000).max(2100).optional(),
        dueFrom: dateOnlyField.optional(),
        dueTo: dateOnlyField.optional(),
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
export type DashboardQuery = z.output<typeof dashboardQuerySchema>;

export const instanceListSchema = z
    .object({
        ...dimensionShape,
        status: list(z.enum(INSTANCE_STATUSES)),
        dashboardStatus: list(z.enum(DASHBOARD_STATUSES)),
        dueFrom: dateOnlyField.optional(),
        dueTo: dateOnlyField.optional(),
        overdue: z.enum(['true']).optional(),
        search: z.string().trim().max(100).optional(),
        sort: z.enum(SORT_KEYS).optional(),
        cf: columnFiltersField,
        order: z.enum(['asc', 'desc']).default('asc'),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .refine((v) => !v.dueFrom || !v.dueTo || v.dueTo >= v.dueFrom, {
        message: 'dueTo must be on or after dueFrom',
        path: ['dueTo'],
    });
export type InstanceListQuery = z.output<typeof instanceListSchema>;

// Turns the filter panel and the user's visibility into a database filter
export function buildInstanceWhere(
    actor: AuthUser,
    f: DimensionFilters,
): Prisma.ComplianceInstanceWhereInput {
    const compliance: Prisma.ComplianceWhereInput = {
        ...(f.actId ? { actId: { in: f.actId } } : {}),
        ...(f.ruleId ? { ruleId: { in: f.ruleId } } : {}),
        ...(f.natureId ? { natureId: { in: f.natureId } } : {}),
        ...(f.typeId ? { typeId: { in: f.typeId } } : {}),
        ...(f.risk ? { risk: { in: f.risk } } : {}),
        ...(f.frequency ? { frequency: { in: f.frequency } } : {}),
        ...(f.attachment ? { attachment: { in: f.attachment } } : {}),
        ...(f.lawCategoryId ? { act: { lawCategoryId: { in: f.lawCategoryId } } } : {}),
    };
    const location: Prisma.LocationWhereInput = {
        ...(f.state ? { state: { in: f.state } } : {}),
        ...(f.locationTypeId ? { locationTypeId: { in: f.locationTypeId } } : {}),
    };

    return {
        orgId: actor.orgId,
        ...(f.entityId ? { entityId: { in: f.entityId } } : {}),
        ...(f.locationId ? { locationId: { in: f.locationId } } : {}),
        ...(f.departmentId ? { departmentId: { in: f.departmentId } } : {}),
        ...(f.verticalId ? { verticalId: { in: f.verticalId } } : {}),
        ...(f.ownerId ? { ownerId: { in: f.ownerId } } : {}),
        ...(f.managerId ? { managerId: { in: f.managerId } } : {}),
        ...(Object.keys(compliance).length ? { compliance } : {}),
        ...(Object.keys(location).length ? { location } : {}),
        AND: [visibleTo(actor)],
    };
}

export function dueRange(from?: string, to?: string): Prisma.ComplianceInstanceWhereInput {
    if (!from && !to) return {};
    return {
        dueDate: {
            ...(from ? { gte: parseDateOnly(from) } : {}),
            ...(to ? { lte: parseDateOnly(to) } : {}),
        },
    };
}

const OPEN: InstanceStatus[] = ['DUE', 'RETURNED'];

// The same rules as dashboardStatus() in status.ts, written as a database filter.
// This is the only place two columns are compared with each other (done date and due date).
export function dashboardStatusWhere(
    statuses: readonly DashboardStatus[],
    today: string,
): Prisma.ComplianceInstanceWhereInput {
    const todayDate = parseDateOnly(today);
    const due = prisma.complianceInstance.fields.dueDate;

    const clause = (s: DashboardStatus): Prisma.ComplianceInstanceWhereInput => {
        switch (s) {
            case 'NOT_APPLICABLE':
                return { status: 'NOT_APPLICABLE' };
            case 'PENDING_APPROVAL':
                return { status: { in: ['SUBMITTED', 'MANAGER_APPROVED'] } };
            case 'LATE_CLOSURE':
                return { status: 'CLOSED', doneDate: { gt: due } };
            case 'ON_TIME':
                return { status: 'CLOSED', OR: [{ doneDate: null }, { doneDate: { lte: due } }] };
            case 'DUE':
                return { status: { in: OPEN }, dueDate: { gte: todayDate } };
            case 'NON_COMPLIANCE':
                return { status: { in: OPEN }, dueDate: { lt: todayDate } };
        }
    };

    return { OR: statuses.map(clause) };
}