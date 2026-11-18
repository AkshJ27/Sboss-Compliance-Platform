import { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { HttpError, rethrowUnique } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import { activeWhere } from '../../lib/active-filter';
import type {
    ActCreateInput, ActUpdateInput, LookupKind, RuleCreateInput, RuleListQuery, RuleUpdateInput,
} from './masters.schema';
import { visibleActs } from './library.service';

// The shared masters behind the law library. Every company uses them, so only the platform
// administrator changes them (the routes check that). Companies' own Acts are never touched here.

type LookupRow = { id: string; name: string; createdAt: Date; used: number };

const LABEL: Record<LookupKind, string> = {
    'law-categories': 'law category',
    'statutory-authorities': 'statutory authority',
    natures: 'compliance nature',
    types: 'compliance type',
};

// One set of operations per list. Written out so each keeps its own database types.
const LOOKUPS: Record<
    LookupKind,
    {
        list: () => Promise<LookupRow[]>;
        create: (name: string) => Promise<{ id: string; name: string }>;
        rename: (id: string, name: string) => Promise<{ id: string; name: string }>;
        used: (id: string) => Promise<number | null>; // null when it does not exist
        remove: (id: string) => Promise<unknown>;
    }
> = {
    'law-categories': {
        list: async () =>
            (await prisma.lawCategory.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { acts: true } } } })).map(
                (r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, used: r._count.acts }),
            ),
        create: (name) => prisma.lawCategory.create({ data: { name }, select: { id: true, name: true } }),
        rename: (id, name) => prisma.lawCategory.update({ where: { id }, data: { name }, select: { id: true, name: true } }),
        used: async (id) =>
            (await prisma.lawCategory.findUnique({ where: { id }, include: { _count: { select: { acts: true } } } }))?._count.acts ?? null,
        remove: (id) => prisma.lawCategory.delete({ where: { id } }),
    },
    'statutory-authorities': {
        list: async () =>
            (await prisma.statutoryAuthority.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { acts: true } } } })).map(
                (r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, used: r._count.acts }),
            ),
        create: (name) => prisma.statutoryAuthority.create({ data: { name }, select: { id: true, name: true } }),
        rename: (id, name) => prisma.statutoryAuthority.update({ where: { id }, data: { name }, select: { id: true, name: true } }),
        used: async (id) =>
            (await prisma.statutoryAuthority.findUnique({ where: { id }, include: { _count: { select: { acts: true } } } }))?._count.acts ??
            null,
        remove: (id) => prisma.statutoryAuthority.delete({ where: { id } }),
    },
    natures: {
        list: async () =>
            (await prisma.complianceNature.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { compliances: true } } } })).map(
                (r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, used: r._count.compliances }),
            ),
        create: (name) => prisma.complianceNature.create({ data: { name }, select: { id: true, name: true } }),
        rename: (id, name) => prisma.complianceNature.update({ where: { id }, data: { name }, select: { id: true, name: true } }),
        used: async (id) =>
            (await prisma.complianceNature.findUnique({ where: { id }, include: { _count: { select: { compliances: true } } } }))?._count
                .compliances ?? null,
        remove: (id) => prisma.complianceNature.delete({ where: { id } }),
    },
    types: {
        list: async () =>
            (await prisma.complianceType.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { compliances: true } } } })).map(
                (r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, used: r._count.compliances }),
            ),
        create: (name) => prisma.complianceType.create({ data: { name }, select: { id: true, name: true } }),
        rename: (id, name) => prisma.complianceType.update({ where: { id }, data: { name }, select: { id: true, name: true } }),
        used: async (id) =>
            (await prisma.complianceType.findUnique({ where: { id }, include: { _count: { select: { compliances: true } } } }))?._count
                .compliances ?? null,
        remove: (id) => prisma.complianceType.delete({ where: { id } }),
    },
};

const notFound = (kind: LookupKind) => new HttpError(404, `That ${LABEL[kind]} was not found`);
const isMissing = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';

export const listLookup = (kind: LookupKind) => LOOKUPS[kind].list();

export async function createLookup(actor: AuthUser, kind: LookupKind, name: string) {
    try {
        const row = await LOOKUPS[kind].create(name);
        await recordAudit(prisma, actor, 'LIBRARY_MASTER_CREATED', kind, row.id, { name });
        return row;
    } catch (e) {
        rethrowUnique(e, `A ${LABEL[kind]} with this name already exists`);
    }
}

export async function renameLookup(actor: AuthUser, kind: LookupKind, id: string, name: string) {
    try {
        const row = await LOOKUPS[kind].rename(id, name);
        await recordAudit(prisma, actor, 'LIBRARY_MASTER_RENAMED', kind, id, { name });
        return row;
    } catch (e) {
        if (isMissing(e)) throw notFound(kind);
        rethrowUnique(e, `A ${LABEL[kind]} with this name already exists`);
    }
}

// Only an entry nothing uses can be deleted, so no Act or compliance ever loses its label
export async function deleteLookup(actor: AuthUser, kind: LookupKind, id: string) {
    const used = await LOOKUPS[kind].used(id);
    if (used === null) throw notFound(kind);
    if (used > 0) {
        throw new HttpError(409, `This ${LABEL[kind]} is used by ${used} record(s), so it cannot be deleted. Rename it instead.`);
    }
    await LOOKUPS[kind].remove(id);
    await recordAudit(prisma, actor, 'LIBRARY_MASTER_DELETED', kind, id);
}

// ---- Acts ---------------------------------------------------------------------------

async function checkActLinks(lawCategoryId?: string, statutoryAuthorityId?: string | null) {
    if (lawCategoryId && !(await prisma.lawCategory.count({ where: { id: lawCategoryId } }))) {
        throw new HttpError(400, 'That law category was not found');
    }
    if (statutoryAuthorityId && !(await prisma.statutoryAuthority.count({ where: { id: statutoryAuthorityId } }))) {
        throw new HttpError(400, 'That statutory authority was not found');
    }
}

const ACT_TAKEN = 'An Act with this name already exists for this jurisdiction and state';

export async function createAct(actor: AuthUser, input: ActCreateInput) {
    await checkActLinks(input.lawCategoryId, input.statutoryAuthorityId);
    try {
        const act = await prisma.act.create({
            data: {
                name: input.name,
                jurisdiction: input.jurisdiction,
                state: input.jurisdiction === 'STATE' ? (input.state ?? null) : null,
                lawCategoryId: input.lawCategoryId,
                statutoryAuthorityId: input.statutoryAuthorityId ?? null,
            },
        });
        await recordAudit(prisma, actor, 'LIBRARY_ACT_CREATED', 'Act', act.id, { name: act.name });
        return act;
    } catch (e) {
        rethrowUnique(e, ACT_TAKEN);
    }
}

export async function updateAct(actor: AuthUser, id: string, input: ActUpdateInput) {
    // Shared Acts only. A company's own "Internal Compliance" Acts are managed through its compliances.
    const before = await prisma.act.findFirst({ where: { id, orgId: null } });
    if (!before) throw new HttpError(404, 'Act not found');

    const jurisdiction = input.jurisdiction ?? before.jurisdiction;
    const state = input.state === undefined ? before.state : input.state;
    if (jurisdiction === 'STATE' ? !state : !!state) {
        throw new HttpError(400, 'A state Act needs its state, and a central Act has none');
    }
    await checkActLinks(input.lawCategoryId, input.statutoryAuthorityId);

    try {
        const act = await prisma.act.update({
            where: { id },
            data: {
                ...(input.name !== undefined ? { name: input.name } : {}),
                jurisdiction,
                state: jurisdiction === 'STATE' ? state : null,
                ...(input.lawCategoryId ? { lawCategoryId: input.lawCategoryId } : {}),
                ...(input.statutoryAuthorityId !== undefined ? { statutoryAuthorityId: input.statutoryAuthorityId } : {}),
                ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            },
        });
        await recordAudit(prisma, actor, 'LIBRARY_ACT_UPDATED', 'Act', id, JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue);
        return act;
    } catch (e) {
        rethrowUnique(e, ACT_TAKEN);
    }
}

// ---- Rules --------------------------------------------------------------------------

export async function listAllRules(actor: AuthUser, q: RuleListQuery) {
    const where: Prisma.RuleWhereInput = {
        act: visibleActs(actor.orgId),
        ...activeWhere(q),
        ...(q.actId ? { actId: q.actId } : {}),
        ...(q.search ? { name: { contains: q.search, mode: Prisma.QueryMode.insensitive } } : {}),
    };
    const [total, items] = await prisma.$transaction([
        prisma.rule.count({ where }),
        prisma.rule.findMany({
            where,
            include: {
                act: { select: { id: true, name: true, state: true, orgId: true } },
                _count: { select: { compliances: true } },
            },
            orderBy: [{ act: { name: 'asc' } }, { name: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
}

const RULE_TAKEN = 'This Act already has a rule with this name';

export async function createRule(actor: AuthUser, input: RuleCreateInput) {
    const act = await prisma.act.findFirst({ where: { id: input.actId, orgId: null }, select: { id: true } });
    if (!act) throw new HttpError(400, 'That Act was not found in the shared library');
    try {
        const rule = await prisma.rule.create({ data: { actId: input.actId, name: input.name } });
        await recordAudit(prisma, actor, 'LIBRARY_RULE_CREATED', 'Rule', rule.id, { actId: input.actId, name: input.name });
        return rule;
    } catch (e) {
        rethrowUnique(e, RULE_TAKEN);
    }
}

export async function updateRule(actor: AuthUser, id: string, input: RuleUpdateInput) {
    const before = await prisma.rule.findFirst({ where: { id, act: { orgId: null } }, select: { id: true } });
    if (!before) throw new HttpError(404, 'Rule not found');
    try {
        const rule = await prisma.rule.update({ where: { id }, data: input });
        await recordAudit(prisma, actor, 'LIBRARY_RULE_UPDATED', 'Rule', id, JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue);
        return rule;
    } catch (e) {
        rethrowUnique(e, RULE_TAKEN);
    }
}