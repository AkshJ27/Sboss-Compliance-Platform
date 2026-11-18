import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit, changedFields } from '../../lib/audit';
import type { AuthUser } from '../../middleware/auth';
import { activeWhere } from '../../lib/active-filter';
import type { StatusFilter } from '../../lib/active-filter';
import { COMPARE_KEYS, scheduleProblem } from './library.schema';

const complianceInclude = {
    act: {
        select: {
            id: true,
            name: true,
            jurisdiction: true,
            state: true,
            lawCategory: { select: { id: true, name: true } },
        },
    },
    rule: { select: { id: true, name: true } },
    nature: { select: { id: true, name: true } },
    type: { select: { id: true, name: true } },
} as const;

// The shared library plus the company's own internal compliances. Never another company's.
export const visibleCompliances = (orgId: string): Prisma.ComplianceWhereInput => ({
    OR: [{ orgId: null }, { orgId }],
});
export const visibleActs = (orgId: string): Prisma.ActWhereInput => ({ OR: [{ orgId: null }, { orgId }] });

const insensitive = Prisma.QueryMode.insensitive;

export async function lookups() {
    const byName = { orderBy: { name: 'asc' as const } };
    const [lawCategories, statutoryAuthorities, natures, types] = await Promise.all([
        prisma.lawCategory.findMany(byName),
        prisma.statutoryAuthority.findMany(byName),
        prisma.complianceNature.findMany(byName),
        prisma.complianceType.findMany(byName),
    ]);
    return { lawCategories, statutoryAuthorities, natures, types };
}

type ActQuery = {
    lawCategoryId?: string;
    jurisdiction?: 'CENTRAL' | 'STATE';
    state?: string;
    search?: string;
    includeInactive: boolean;
    status?: StatusFilter;
    page: number;
    limit: number;
};

export async function listActs(actor: AuthUser, q: ActQuery) {
    const where: Prisma.ActWhereInput = {
        AND: [visibleActs(actor.orgId)],
        ...activeWhere(q),
        ...(q.lawCategoryId ? { lawCategoryId: q.lawCategoryId } : {}),
        ...(q.jurisdiction ? { jurisdiction: q.jurisdiction } : {}),
        ...(q.state ? { state: q.state } : {}),
        ...(q.search ? { name: { contains: q.search, mode: insensitive } } : {}),
    };
    const [total, items] = await prisma.$transaction([
        prisma.act.count({ where }),
        prisma.act.findMany({
            where,
            include: {
                lawCategory: { select: { id: true, name: true } },
                statutoryAuthority: { select: { id: true, name: true } },
                _count: { select: { compliances: true, rules: true } },
            },
            orderBy: { name: 'asc' },
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
}

export const listRules = (actor: AuthUser, actId: string) =>
    prisma.rule.findMany({
        where: { actId, isActive: true, act: visibleActs(actor.orgId) },
        orderBy: { name: 'asc' },
    });

type ComplianceQuery = {
    actId?: string;
    lawCategoryId?: string;
    jurisdiction?: 'CENTRAL' | 'STATE';
    state?: string;
    natureId?: string;
    frequency?: Prisma.ComplianceWhereInput['frequency'];
    risk?: Prisma.ComplianceWhereInput['risk'];
    search?: string;
    includeInactive: boolean;
    status?: StatusFilter;
    type?: 'STATUTORY' | 'INTERNAL';
    mapping?: 'MAPPED' | 'UNMAPPED';
    page: number;
    limit: number;
};

export async function listCompliances(actor: AuthUser, q: ComplianceQuery) {
    const { orgId } = actor;
    const mapped: Prisma.ComplianceScheduleListRelationFilter = { some: { orgId, isActive: true } };
    const actFilter: Prisma.ActWhereInput = {
        ...(q.lawCategoryId ? { lawCategoryId: q.lawCategoryId } : {}),
        ...(q.jurisdiction ? { jurisdiction: q.jurisdiction } : {}),
        ...(q.state ? { state: q.state } : {}),
    };
    const where: Prisma.ComplianceWhereInput = {
        AND: [
            visibleCompliances(orgId),
            ...(q.type === 'STATUTORY' ? [{ orgId: null }] : q.type === 'INTERNAL' ? [{ orgId }] : []),
            ...(q.mapping === 'MAPPED' ? [{ schedules: mapped }] : []),
            ...(q.mapping === 'UNMAPPED' ? [{ schedules: { none: { orgId, isActive: true } } }] : []),
        ],
        ...activeWhere(q),
        ...(q.actId ? { actId: q.actId } : {}),
        ...(q.natureId ? { natureId: q.natureId } : {}),
        ...(q.frequency ? { frequency: q.frequency } : {}),
        ...(q.risk ? { risk: q.risk } : {}),
        ...(Object.keys(actFilter).length ? { act: actFilter } : {}),
        ...(q.search
            ? {
                OR: [
                    { title: { contains: q.search, mode: insensitive } },
                    { code: { contains: q.search, mode: insensitive } },
                    { act: { name: { contains: q.search, mode: insensitive } } },
                ],
            }
            : {}),
    };
    const [total, items] = await prisma.$transaction([
        prisma.compliance.count({ where }),
        prisma.compliance.findMany({
            where,
            include: complianceInclude,
            orderBy: [{ act: { name: 'asc' } }, { title: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
}

export async function getCompliance(actor: AuthUser, id: string) {
    const row = await prisma.compliance.findFirst({
        where: { id, ...visibleCompliances(actor.orgId) },
        include: { ...complianceInclude, revisions: { orderBy: { version: 'desc' }, take: 50 } },
    });
    if (!row) throw new HttpError(404, 'Compliance not found');
    return row;
}

export async function updateCompliance(
    actor: AuthUser,
    id: string,
    input: Prisma.ComplianceUncheckedUpdateInput,
) {
    return prisma.$transaction(async (tx) => {
        // The shared library only. A company's internal compliances are changed by that company.
        const before = await tx.compliance.findFirst({ where: { id, orgId: null } });
        if (!before) throw new HttpError(404, 'Compliance not found');

        const merged = { ...before, ...input } as typeof before;
        const problem = scheduleProblem(merged);
        if (problem) throw new HttpError(400, problem);

        const changes = changedFields(before, merged, COMPARE_KEYS);
        if (Object.keys(changes as object).length === 0) return before;

        const version = before.version + 1;
        const after = await tx.compliance.update({
            where: { id },
            data: { ...input, version },
            include: complianceInclude,
        });
        await tx.complianceRevision.create({
            data: { complianceId: id, version, changes, changedById: actor.id },
        });
        await recordAudit(tx, actor, 'LIBRARY_COMPLIANCE_UPDATED', 'Compliance', id, changes);
        return after;
    });
}