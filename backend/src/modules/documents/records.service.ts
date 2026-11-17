import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { changedFields, recordAudit } from '../../lib/audit';
import { parseDateOnly, toDateOnly, todayInIndia } from '../../lib/dates';
import { HttpError } from '../../lib/errors';
import { checkFile, cleanFileName } from '../../lib/file-types';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import type { AuthUser } from '../../middleware/auth';
import { toXlsx } from '../reports/export.xlsx';
import type { Column } from '../reports/export.format';
import { checkChain } from './categories.service';
import { canDelete, canEdit, canOpenFiles, visibleRecords } from './records.access';
import type { OwnerSwapInput, RecordCreateInput, RecordListQuery, RecordUpdateInput } from './records.schema';

const MAX_FILES_PER_RECORD = 25;
const EXPORT_LIMIT = 10_000;
const DAY = 86_400_000;
const insensitive = Prisma.QueryMode.insensitive;

const named = { select: { id: true, name: true } } as const;
const recordInclude = {
    entity: named,
    vertical: named,
    location: named,
    department: named,
    category: named,
    subCategory: named,
    subSubCategory: named,
    owner: named,
    manager: named,
    createdBy: named,
    files: {
        where: { deletedAt: null },
        select: { id: true, fileName: true, sizeBytes: true, createdAt: true, uploadedBy: named },
        orderBy: { createdAt: 'asc' },
    },
    additionalUsers: { select: { user: named } },
} satisfies Prisma.DocumentRecordInclude;

type RecordRow = Prisma.DocumentRecordGetPayload<{ include: typeof recordInclude }>;

const people = (r: RecordRow) => ({
    accessLevel: r.accessLevel,
    ownerId: r.ownerId,
    managerId: r.managerId,
    createdById: r.createdById,
    additionalUserIds: r.additionalUsers.map((a) => a.user.id),
});

// What the screen gets: no storage keys or hashes, plus what this person may do
function present(actor: AuthUser, r: RecordRow) {
    const p = people(r);
    const open = canOpenFiles(actor, p);
    const { additionalUsers, files, ...rest } = r;
    return {
        ...rest,
        additionalUsers: additionalUsers.map((a) => a.user),
        // Protected documents show in the list, but the file names stay hidden from people who cannot open them
        files: open ? files : [],
        fileCount: files.length,
        expired: !!r.expiryDate && toDateOnly(r.expiryDate) < todayInIndia(),
        can: { open, edit: canEdit(actor, p), delete: canDelete(actor, p) },
    };
}

// Midnight in India, as a moment in time
const indiaMidnight = (day: string) => new Date(`${day}T00:00:00+05:30`);

function listWhere(actor: AuthUser, q: Partial<RecordListQuery>): Prisma.DocumentRecordWhereInput {
    const and: Prisma.DocumentRecordWhereInput[] = [visibleRecords(actor)];
    if (q.entityId) and.push({ entityId: q.entityId });
    if (q.locationId) and.push({ locationId: q.locationId });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.accessLevel) and.push({ accessLevel: q.accessLevel });
    if (q.categoryId) and.push({ categoryId: q.categoryId });
    if (q.subCategoryId) and.push({ subCategoryId: q.subCategoryId });
    if (q.subSubCategoryId) and.push({ subSubCategoryId: q.subSubCategoryId });
    if (q.ownerId) and.push({ ownerId: q.ownerId });
    if (q.from) and.push({ createdAt: { gte: indiaMidnight(q.from) } });
    if (q.to) and.push({ createdAt: { lt: new Date(indiaMidnight(q.to).getTime() + DAY) } });
    if (q.expired) and.push({ expiryDate: { lt: parseDateOnly(todayInIndia()) } });
    if (q.withoutFiles) and.push({ files: { none: { deletedAt: null } } });
    if (q.search) {
        and.push({
            OR: [
                { name: { contains: q.search, mode: insensitive } },
                { docNumber: { contains: q.search, mode: insensitive } },
                { remarks: { contains: q.search, mode: insensitive } },
                { files: { some: { deletedAt: null, fileName: { contains: q.search, mode: insensitive } } } },
            ],
        });
    }
    return { AND: and };
}

function orderBy(q: RecordListQuery): Prisma.DocumentRecordOrderByWithRelationInput[] {
    const nullable = q.sort === 'docNumber' || q.sort === 'expiryDate' || q.sort === 'reviewDate';
    const first = nullable ? { [q.sort]: { sort: q.order, nulls: 'last' } } : { [q.sort]: q.order };
    return [first as Prisma.DocumentRecordOrderByWithRelationInput, { id: 'asc' }];
}

export async function list(actor: AuthUser, q: RecordListQuery) {
    const where = listWhere(actor, q);
    const [total, rows] = await prisma.$transaction([
        prisma.documentRecord.count({ where }),
        prisma.documentRecord.findMany({
            where,
            include: recordInclude,
            orderBy: orderBy(q),
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    return { items: rows.map((r) => present(actor, r)), total, page: q.page, limit: q.limit };
}

// The two counts on the red buttons
export async function summary(actor: AuthUser) {
    const [expired, withoutFiles] = await prisma.$transaction([
        prisma.documentRecord.count({ where: listWhere(actor, { expired: 'true' }) }),
        prisma.documentRecord.count({ where: listWhere(actor, { withoutFiles: 'true' }) }),
    ]);
    return { expired, withoutFiles };
}

export async function get(actor: AuthUser, id: string) {
    const row = await prisma.documentRecord.findFirst({
        where: { AND: [visibleRecords(actor), { id }] },
        include: recordInclude,
    });
    if (!row) throw new HttpError(404, 'Document not found');
    return present(actor, row);
}

// ---- Checks on what a document points to ------------------------------------------

async function checkPlace(orgId: string, v: { entityId: string; verticalId: string; locationId: string; departmentId: string }, changed: (k: string) => boolean) {
    const [entity, vertical, location, department] = await Promise.all([
        prisma.entity.findFirst({ where: { id: v.entityId, orgId }, select: { isActive: true } }),
        prisma.vertical.findFirst({ where: { id: v.verticalId, orgId }, select: { isActive: true } }),
        prisma.location.findFirst({ where: { id: v.locationId, orgId }, select: { isActive: true, entityId: true } }),
        prisma.department.findFirst({ where: { id: v.departmentId, orgId }, select: { isActive: true } }),
    ]);
    const check = (key: string, row: { isActive: boolean } | null, label: string) => {
        if (!row) throw new HttpError(400, `That ${label} was not found`);
        if (!row.isActive && changed(key)) throw new HttpError(400, `That ${label} is inactive`);
    };
    check('entityId', entity, 'entity');
    check('verticalId', vertical, 'vertical');
    check('locationId', location, 'location');
    check('departmentId', department, 'department');
    if (location!.entityId !== v.entityId) throw new HttpError(400, 'That location belongs to a different entity');
}

// Only the people being set now are checked, so an edit never fails because of someone who left later
async function checkPeople(orgId: string, v: { ownerId?: string; managerId?: string | null; additional?: string[] }) {
    const ids = [...new Set([v.ownerId, v.managerId, ...(v.additional ?? [])].filter((x): x is string => !!x))];
    if (!ids.length) return;
    const users = await prisma.user.findMany({
        where: { orgId, id: { in: ids } },
        select: { id: true, isActive: true, role: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const person = (id: string, label: string) => {
        const u = byId.get(id);
        if (!u || !u.isActive) throw new HttpError(400, `The ${label} must be an active user of your company`);
        return u;
    };
    if (v.ownerId && person(v.ownerId, 'owner').role === 'VIEWER') {
        throw new HttpError(400, 'A view-only user cannot own a document');
    }
    if (v.managerId && person(v.managerId, 'manager').role === 'VIEWER') {
        throw new HttpError(400, 'A view-only user cannot be the manager');
    }
    for (const id of v.additional ?? []) person(id, 'additional user');
}

async function checkCategories(orgId: string, v: { categoryId: string; subCategoryId?: string | null; subSubCategoryId?: string | null }, changed: (k: string) => boolean) {
    const rows = await checkChain(orgId, v.categoryId, v.subCategoryId, v.subSubCategoryId);
    const keys: Record<string, string> = {};
    if (v.categoryId) keys[v.categoryId] = 'categoryId';
    if (v.subCategoryId) keys[v.subCategoryId] = 'subCategoryId';
    if (v.subSubCategoryId) keys[v.subSubCategoryId] = 'subSubCategoryId';
    for (const r of rows) {
        if (!r.isActive && changed(keys[r.id])) throw new HttpError(400, 'One of the chosen categories is inactive');
    }
}

const dateOrNull = (v: string | null | undefined) => (v ? parseDateOnly(v) : null);

// ---- Create, change, delete ---------------------------------------------------------

export async function create(actor: AuthUser, input: RecordCreateInput) {
    if (actor.role === 'VIEWER') throw new HttpError(403, 'View-only users cannot add documents');
    const ownerId = input.ownerId ?? actor.id;
    if (ownerId !== actor.id && actor.role !== 'ORG_ADMIN') {
        throw new HttpError(403, 'Only an admin can add a document on behalf of someone else');
    }
    if (input.accessLevel === 'RESTRICTED' && actor.role !== 'ORG_ADMIN') {
        throw new HttpError(403, 'Only an admin can mark a document as restricted');
    }
    const additional = [...new Set(input.additionalUserIds ?? [])].filter((id) => id !== ownerId);

    await checkPlace(actor.orgId, input, () => true);
    await checkCategories(actor.orgId, input, () => true);
    await checkPeople(actor.orgId, { ownerId, managerId: input.managerId ?? null, additional });

    const row = await prisma.$transaction(async (tx) => {
        const created = await tx.documentRecord.create({
            data: {
                orgId: actor.orgId,
                entityId: input.entityId,
                verticalId: input.verticalId,
                locationId: input.locationId,
                departmentId: input.departmentId,
                categoryId: input.categoryId,
                subCategoryId: input.subCategoryId ?? null,
                subSubCategoryId: input.subSubCategoryId ?? null,
                name: input.name,
                docNumber: input.docNumber || null,
                accessLevel: input.accessLevel,
                storedAt: input.storedAt || null,
                ownerId,
                managerId: input.managerId ?? null,
                reviewDate: dateOrNull(input.reviewDate),
                expiryDate: dateOrNull(input.expiryDate),
                alertDays: input.alertDays ?? null,
                remarks: input.remarks || null,
                createdById: actor.id,
                additionalUsers: { create: additional.map((userId) => ({ userId })) },
            },
            include: recordInclude,
        });
        await recordAudit(tx, actor, 'DOC_RECORD_CREATED', 'DocumentRecord', created.id, {
            name: created.name,
            accessLevel: created.accessLevel,
            ownerId,
        });
        return created;
    });
    return present(actor, row);
}

async function loadForChange(actor: AuthUser, id: string) {
    const row = await prisma.documentRecord.findFirst({
        where: { AND: [visibleRecords(actor), { id }] },
        include: recordInclude,
    });
    if (!row) throw new HttpError(404, 'Document not found');
    return row;
}

const COMPARED = [
    'entityId', 'verticalId', 'locationId', 'departmentId', 'categoryId', 'subCategoryId', 'subSubCategoryId',
    'name', 'docNumber', 'accessLevel', 'storedAt', 'ownerId', 'managerId', 'reviewDate', 'expiryDate',
    'alertDays', 'remarks',
];

export async function update(actor: AuthUser, id: string, input: RecordUpdateInput) {
    const before = await loadForChange(actor, id);
    if (!canEdit(actor, people(before))) throw new HttpError(403, 'You cannot change this document');

    const changed = (k: string) => k in input && (input as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k];
    if (changed('ownerId') && actor.role !== 'ORG_ADMIN') {
        throw new HttpError(403, 'Only an admin can change the owner. Use Document Owner Swap.');
    }
    if (changed('accessLevel') && input.accessLevel === 'RESTRICTED' && actor.role !== 'ORG_ADMIN') {
        throw new HttpError(403, 'Only an admin can mark a document as restricted');
    }

    const next = {
        entityId: input.entityId ?? before.entityId,
        verticalId: input.verticalId ?? before.verticalId,
        locationId: input.locationId ?? before.locationId,
        departmentId: input.departmentId ?? before.departmentId,
        categoryId: input.categoryId ?? before.categoryId,
        // A new category clears the lower levels unless new ones are sent too
        subCategoryId: input.subCategoryId !== undefined ? input.subCategoryId : input.categoryId ? null : before.subCategoryId,
        subSubCategoryId:
            input.subSubCategoryId !== undefined
                ? input.subSubCategoryId
                : input.categoryId || input.subCategoryId !== undefined
                    ? null
                    : before.subSubCategoryId,
        ownerId: input.ownerId ?? before.ownerId,
        managerId: input.managerId !== undefined ? input.managerId : before.managerId,
    };
    if (next.subSubCategoryId && !next.subCategoryId) {
        throw new HttpError(400, 'Choose the sub category before the sub sub category');
    }
    const additional =
        input.additionalUserIds !== undefined
            ? [...new Set(input.additionalUserIds)].filter((u) => u !== next.ownerId)
            : people(before).additionalUserIds.filter((u) => u !== next.ownerId);

    await checkPlace(actor.orgId, next, changed);
    await checkCategories(actor.orgId, next, (k) => (next as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k]);
    await checkPeople(actor.orgId, {
        ownerId: next.ownerId !== before.ownerId ? next.ownerId : undefined,
        managerId: next.managerId !== before.managerId ? next.managerId : undefined,
        additional: input.additionalUserIds !== undefined ? additional : undefined,
    });

    const row = await prisma.$transaction(async (tx) => {
        const data: Prisma.DocumentRecordUncheckedUpdateInput = { ...next };
        if (input.name !== undefined) data.name = input.name;
        if (input.docNumber !== undefined) data.docNumber = input.docNumber || null;
        if (input.accessLevel !== undefined) data.accessLevel = input.accessLevel;
        if (input.storedAt !== undefined) data.storedAt = input.storedAt || null;
        if (input.reviewDate !== undefined) data.reviewDate = dateOrNull(input.reviewDate);
        if (input.expiryDate !== undefined) data.expiryDate = dateOrNull(input.expiryDate);
        if (input.alertDays !== undefined) data.alertDays = input.alertDays;
        if (input.remarks !== undefined) data.remarks = input.remarks || null;

        if (input.additionalUserIds !== undefined || next.ownerId !== before.ownerId) {
            await tx.documentRecordUser.deleteMany({ where: { recordId: id } });
            if (additional.length) {
                await tx.documentRecordUser.createMany({ data: additional.map((userId) => ({ recordId: id, userId })) });
            }
        }

        const after = await tx.documentRecord.update({ where: { id }, data, include: recordInclude });

        // Its files carry the same name, access level and expiry, for the older document screens
        await tx.document.updateMany({
            where: { recordId: id, deletedAt: null },
            data: { title: after.name.slice(0, 200), accessLevel: after.accessLevel, expiresAt: after.expiryDate },
        });

        const changes = changedFields(before, after, COMPARED) as Record<string, unknown>;
        const usersBefore = people(before).additionalUserIds.sort().join(',');
        const usersAfter = people(after).additionalUserIds.sort().join(',');
        if (usersBefore !== usersAfter) changes.additionalUsers = { from: usersBefore.split(',').filter(Boolean), to: usersAfter.split(',').filter(Boolean) };
        if (Object.keys(changes).length) {
            await recordAudit(tx, actor, 'DOC_RECORD_UPDATED', 'DocumentRecord', id, changes as Prisma.InputJsonValue);
        }
        return after;
    });
    return present(actor, row);
}

// A soft delete of the document and its files. The files stay in storage for the audit trail.
export async function remove(actor: AuthUser, id: string) {
    const row = await loadForChange(actor, id);
    if (!canDelete(actor, people(row))) throw new HttpError(403, 'Only an admin or the owner can delete this document');
    const now = new Date();
    await prisma.$transaction(async (tx) => {
        await tx.documentRecord.update({ where: { id }, data: { deletedAt: now, deletedById: actor.id } });
        await tx.document.updateMany({ where: { recordId: id, deletedAt: null }, data: { deletedAt: now, deletedById: actor.id } });
        await recordAudit(tx, actor, 'DOC_RECORD_DELETED', 'DocumentRecord', id, { name: row.name, files: row.files.length });
    });
}

// ---- Files ----------------------------------------------------------------------------

export async function addFiles(actor: AuthUser, id: string, files: { originalname: string; buffer: Buffer }[]) {
    if (!files.length) throw new HttpError(400, 'Choose at least one file');
    const record = await loadForChange(actor, id);
    if (!canEdit(actor, people(record))) throw new HttpError(403, 'You cannot add files to this document');
    if (record.files.length + files.length > MAX_FILES_PER_RECORD) {
        throw new HttpError(400, `A document can have at most ${MAX_FILES_PER_RECORD} files`);
    }

    // Check every file before storing any of them
    const prepared = files.map((f) => {
        const fileName = cleanFileName(f.originalname);
        if (!fileName) throw new HttpError(400, 'Every file needs a name');
        const { contentType } = checkFile(fileName, f.buffer);
        const docId = randomUUID();
        return {
            docId,
            fileName,
            contentType,
            buffer: f.buffer,
            sha256: createHash('sha256').update(f.buffer).digest('hex'),
            storageKey: `${actor.orgId}/${docId}`,
        };
    });
    const hashes = new Set<string>();
    for (const p of prepared) {
        if (hashes.has(p.sha256)) throw new HttpError(400, `"${p.fileName}" was chosen twice`);
        hashes.add(p.sha256);
    }

    const stored: string[] = [];
    try {
        for (const p of prepared) {
            await storage.put(p.storageKey, p.buffer, p.contentType);
            stored.push(p.storageKey);
        }
        await prisma.$transaction(async (tx) => {
            const dup = await tx.document.findFirst({
                where: { recordId: id, deletedAt: null, sha256: { in: [...hashes] } },
                select: { fileName: true },
            });
            if (dup) throw new HttpError(409, `This document already has that file ("${dup.fileName}")`);
            await tx.document.createMany({
                data: prepared.map((p) => ({
                    id: p.docId,
                    orgId: actor.orgId,
                    recordId: id,
                    title: record.name.slice(0, 200),
                    accessLevel: record.accessLevel,
                    expiresAt: record.expiryDate,
                    fileName: p.fileName,
                    contentType: p.contentType,
                    sizeBytes: p.buffer.length,
                    sha256: p.sha256,
                    storageKey: p.storageKey,
                    uploadedById: actor.id,
                })),
            });
            await recordAudit(tx, actor, 'DOC_RECORD_FILES_ADDED', 'DocumentRecord', id, {
                files: prepared.map((p) => ({ id: p.docId, fileName: p.fileName, sizeBytes: p.buffer.length })),
            });
        });
    } catch (e) {
        await Promise.all(stored.map((k) => storage.remove(k).catch(() => undefined)));
        throw e;
    }
    return get(actor, id);
}

export async function removeFile(actor: AuthUser, id: string, fileId: string) {
    const record = await loadForChange(actor, id);
    if (!canEdit(actor, people(record))) throw new HttpError(403, 'You cannot remove files from this document');
    const file = record.files.find((f) => f.id === fileId);
    if (!file) throw new HttpError(404, 'File not found');
    await prisma.$transaction(async (tx) => {
        await tx.document.update({ where: { id: fileId }, data: { deletedAt: new Date(), deletedById: actor.id } });
        await recordAudit(tx, actor, 'DOC_RECORD_FILE_REMOVED', 'DocumentRecord', id, { fileId, fileName: file.fileName });
    });
}

// ---- Document Owner Swap (admins) ------------------------------------------------------

export async function ownerSwap(actor: AuthUser, input: OwnerSwapInput) {
    const to = await prisma.user.findFirst({
        where: { id: input.toUserId, orgId: actor.orgId },
        select: { isActive: true, role: true },
    });
    if (!to || !to.isActive) throw new HttpError(400, 'The new owner must be an active user of your company');
    if (to.role === 'VIEWER') throw new HttpError(400, 'A view-only user cannot own documents');

    const where: Prisma.DocumentRecordWhereInput = {
        orgId: actor.orgId,
        deletedAt: null,
        ownerId: input.fromUserId,
        ...(input.recordIds ? { id: { in: input.recordIds } } : {}),
    };
    return prisma.$transaction(async (tx) => {
        const ids = (await tx.documentRecord.findMany({ where, select: { id: true } })).map((r) => r.id);
        if (!ids.length) throw new HttpError(400, 'That person owns none of the chosen documents');
        await tx.documentRecord.updateMany({ where: { id: { in: ids } }, data: { ownerId: input.toUserId } });
        // The new owner no longer needs to be listed as an additional user
        await tx.documentRecordUser.deleteMany({ where: { recordId: { in: ids }, userId: input.toUserId } });
        await recordAudit(tx, actor, 'DOC_RECORD_OWNER_SWAPPED', 'User', input.fromUserId, {
            toUserId: input.toUserId,
            count: ids.length,
            recordIds: ids.slice(0, 200),
        });
        return { moved: ids.length };
    });
}

// ---- Excel export ------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d: Date | null) => {
    if (!d) return '';
    const s = toDateOnly(d);
    return `${s.slice(8, 10)}-${MONTHS[Number(s.slice(5, 7)) - 1]}-${s.slice(0, 4)}`;
};
const createdDay = (d: Date) => day(new Date(d.getTime() + 330 * 60_000)); // the day in India

type Presented = ReturnType<typeof present>;
const LEVEL: Record<string, string> = { PUBLIC: 'Public', PRIVATE: 'Private', PROTECTED: 'Protected', RESTRICTED: 'Restricted' };

const EXPORT_COLUMNS: Column<Presented>[] = [
    { header: 'Document Type', width: 12, get: (r) => LEVEL[r.accessLevel] },
    { header: 'Entity', width: 24, get: (r) => r.entity.name },
    { header: 'Vertical', width: 16, get: (r) => r.vertical.name },
    { header: 'Location', width: 18, get: (r) => r.location.name },
    { header: 'Department', width: 20, get: (r) => r.department.name },
    { header: 'Category', width: 18, get: (r) => r.category.name },
    { header: 'Sub Category', width: 18, get: (r) => r.subCategory?.name },
    { header: 'Sub Sub Category', width: 18, get: (r) => r.subSubCategory?.name },
    { header: 'Doc Number', width: 16, get: (r) => r.docNumber },
    { header: 'Doc Name', width: 32, get: (r) => r.name },
    { header: 'File Names', width: 40, get: (r) => (r.can.open ? r.files.map((f) => f.fileName).join(', ') : `${r.fileCount} file(s)`) },
    { header: 'Document Location', width: 22, get: (r) => r.storedAt },
    { header: 'Owner', width: 20, get: (r) => r.owner.name },
    { header: 'Manager', width: 20, get: (r) => r.manager?.name },
    { header: 'Additional Users', width: 28, get: (r) => r.additionalUsers.map((u) => u.name).join(', ') },
    { header: 'Review Date', width: 13, get: (r) => day(r.reviewDate) },
    { header: 'Expiry Date', width: 13, get: (r) => day(r.expiryDate) },
    { header: 'Alert Days', width: 10, get: (r) => r.alertDays },
    { header: 'Remarks', width: 30, get: (r) => r.remarks },
    { header: 'Created Date', width: 13, get: (r) => createdDay(r.createdAt) },
];

export async function exportXlsx(actor: AuthUser, q: RecordListQuery) {
    const rows = await prisma.documentRecord.findMany({
        where: listWhere(actor, q),
        include: recordInclude,
        orderBy: orderBy(q),
        take: EXPORT_LIMIT + 1,
    });
    if (rows.length > EXPORT_LIMIT) {
        throw new HttpError(400, `More than ${EXPORT_LIMIT.toLocaleString('en-IN')} documents match. Narrow the filters first.`);
    }
    await recordAudit(prisma, actor, 'DOC_RECORD_EXPORTED', 'DocumentRecord', actor.orgId, { rows: rows.length });
    const buffer = await toXlsx(rows.map((r) => present(actor, r)), EXPORT_COLUMNS, 'Documents');
    return { buffer, fileName: `documents-${todayInIndia()}.xlsx` };
}