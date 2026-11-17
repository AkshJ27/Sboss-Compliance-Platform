import { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { HttpError, rethrowUnique } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import type { CategoryCreateInput, CategoryListQuery, CategoryUpdateInput } from './records.schema';

// A company's document categories: level 1 category, level 2 sub category, level 3 sub sub category.
// Each level hangs under one entry of the level above.

export const LEVEL_LABEL: Record<number, string> = { 1: 'category', 2: 'sub category', 3: 'sub sub category' };
const TAKEN = 'This name is already used at this level';

export async function list(actor: AuthUser, q: CategoryListQuery) {
    const rows = await prisma.docCategory.findMany({
        where: {
            orgId: actor.orgId,
            ...(q.level ? { level: q.level } : {}),
            ...(q.parentId ? { parentId: q.parentId } : {}),
            ...(q.includeInactive ? {} : { isActive: true }),
        },
        include: {
            parent: { select: { id: true, name: true } },
            _count: { select: { children: true, asCategory: true, asSubCategory: true, asSubSubCategory: true } },
        },
        orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });
    return rows.map(({ _count, ...r }) => ({
        ...r,
        children: _count.children,
        documents: _count.asCategory + _count.asSubCategory + _count.asSubSubCategory,
    }));
}

// Postgres treats empty parents as all different, so top-level names are checked here too
async function assertNameFree(orgId: string, parentId: string | null, name: string, exceptId?: string) {
    const clash = await prisma.docCategory.findFirst({
        where: { orgId, parentId, name: { equals: name, mode: Prisma.QueryMode.insensitive }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
        select: { id: true },
    });
    if (clash) throw new HttpError(409, TAKEN);
}

export async function create(actor: AuthUser, input: CategoryCreateInput) {
    let level = 1;
    if (input.parentId) {
        const parent = await prisma.docCategory.findFirst({
            where: { id: input.parentId, orgId: actor.orgId },
            select: { level: true },
        });
        if (!parent) throw new HttpError(400, 'The parent category was not found');
        if (parent.level >= 3) throw new HttpError(400, 'A sub sub category cannot have entries under it');
        level = parent.level + 1;
    }
    await assertNameFree(actor.orgId, input.parentId ?? null, input.name);
    try {
        const row = await prisma.docCategory.create({
            data: { orgId: actor.orgId, parentId: input.parentId ?? null, level, name: input.name },
        });
        await recordAudit(prisma, actor, 'DOC_CATEGORY_CREATED', 'DocCategory', row.id, { name: row.name, level });
        return row;
    } catch (e) {
        rethrowUnique(e, TAKEN);
    }
}

export async function update(actor: AuthUser, id: string, input: CategoryUpdateInput) {
    const before = await prisma.docCategory.findFirst({ where: { id, orgId: actor.orgId } });
    if (!before) throw new HttpError(404, 'Category not found');
    if (input.name !== undefined) await assertNameFree(actor.orgId, before.parentId, input.name, id);
    try {
        const row = await prisma.docCategory.update({ where: { id }, data: input });
        await recordAudit(prisma, actor, 'DOC_CATEGORY_UPDATED', 'DocCategory', id, JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue);
        return row;
    } catch (e) {
        rethrowUnique(e, TAKEN);
    }
}

// Only an entry with nothing under it and no documents can go. Otherwise deactivate it.
export async function remove(actor: AuthUser, id: string) {
    const row = await prisma.docCategory.findFirst({
        where: { id, orgId: actor.orgId },
        include: { _count: { select: { children: true, asCategory: true, asSubCategory: true, asSubSubCategory: true } } },
    });
    if (!row) throw new HttpError(404, 'Category not found');
    const c = row._count;
    if (c.children) throw new HttpError(409, `It has ${c.children} entr${c.children === 1 ? 'y' : 'ies'} under it. Remove those first, or deactivate it.`);
    const used = c.asCategory + c.asSubCategory + c.asSubSubCategory;
    if (used) throw new HttpError(409, `It is used by ${used} document(s), so it cannot be deleted. Deactivate it instead.`);
    await prisma.docCategory.delete({ where: { id } });
    await recordAudit(prisma, actor, 'DOC_CATEGORY_DELETED', 'DocCategory', id, { name: row.name, level: row.level });
}

// Checks that a document's three levels exist, are active, belong to this company and fit together
export async function checkChain(
    orgId: string,
    categoryId: string,
    subCategoryId: string | null | undefined,
    subSubCategoryId: string | null | undefined,
) {
    const ids = [categoryId, subCategoryId, subSubCategoryId].filter((v): v is string => !!v);
    const rows = await prisma.docCategory.findMany({
        where: { orgId, id: { in: ids } },
        select: { id: true, level: true, parentId: true, isActive: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const cat = byId.get(categoryId);
    if (!cat || cat.level !== 1) throw new HttpError(400, 'That category was not found');
    if (subCategoryId) {
        const sub = byId.get(subCategoryId);
        if (!sub || sub.level !== 2 || sub.parentId !== categoryId) {
            throw new HttpError(400, 'That sub category does not belong to the chosen category');
        }
    }
    if (subSubCategoryId) {
        const subSub = byId.get(subSubCategoryId);
        if (!subSub || subSub.level !== 3 || subSub.parentId !== subCategoryId) {
            throw new HttpError(400, 'That sub sub category does not belong to the chosen sub category');
        }
    }
    return rows; // the caller decides whether inactive entries are acceptable
}