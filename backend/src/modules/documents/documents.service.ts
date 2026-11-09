import { createHash, randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { InstanceStatus, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { changedFields, recordAudit } from '../../lib/audit';
import { checkFile, cleanFileName } from '../../lib/file-types';
import { storage } from '../../lib/storage';
import { DOWNLOAD_TTL_SECONDS, signDownloadToken, verifyDownloadToken } from '../../lib/tokens';
import { parseDateOnly, toDateOnly, todayInIndia } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import { visibleTo } from '../compliance/instances.service';
import type { ListQuery, MissingQuery, UpdateInput, UploadFields } from './documents.schema';

type Tx = Prisma.TransactionClient;

const OPEN: InstanceStatus[] = ['DUE', 'RETURNED'];
const MAX_PER_INSTANCE = 20;
const FROZEN = 'Proof can only be changed while the item is due or returned';
const DAY = 86_400_000;
const insensitive = Prisma.QueryMode.insensitive;

// Never includes the storage key or the file hash
const publicSelect = {
    id: true,
    instanceId: true,
    title: true,
    description: true,
    docNumber: true,
    accessLevel: true,
    expiresAt: true,
    fileName: true,
    contentType: true,
    sizeBytes: true,
    createdAt: true,
    uploadedBy: { select: { id: true, name: true } },
} as const;

function present<T extends { expiresAt: Date | null }>(d: T) {
    return { ...d, expired: !!d.expiresAt && toDateOnly(d.expiresAt) < todayInIndia() };
}

// The one place that decides who may see which document
export function visibleDocs(actor: AuthUser): Prisma.DocumentWhereInput {
    const base: Prisma.DocumentWhereInput = { orgId: actor.orgId, deletedAt: null };
    if (actor.role === 'ORG_ADMIN') return base;
    if (actor.role === 'VIEWER') return { ...base, accessLevel: 'PUBLIC' };
    return {
        ...base,
        OR: [
            { accessLevel: 'PUBLIC' },
            { accessLevel: { in: ['PRIVATE', 'PROTECTED'] }, uploadedById: actor.id },
            {
                accessLevel: 'PROTECTED',
                instance: {
                    OR: [{ ownerId: actor.id }, { managerId: actor.id }, { approverId: actor.id }],
                },
            },
        ],
    };
}

// Holds a lock on the item until the transaction ends, and fails if it is no longer open
async function lockOpenInstance(tx: Tx, orgId: string, instanceId: string, ownerId?: string) {
    const r = await tx.complianceInstance.updateMany({
        where: { id: instanceId, orgId, status: { in: OPEN }, ...(ownerId ? { ownerId } : {}) },
        data: { updatedAt: new Date() },
    });
    if (r.count !== 1) throw new HttpError(409, FROZEN);
}

function assertCanManage(
    actor: AuthUser,
    doc: { uploadedById: string; instance: { ownerId: string } | null },
) {
    const ok =
        actor.role === 'ORG_ADMIN' ||
        doc.uploadedById === actor.id ||
        doc.instance?.ownerId === actor.id;
    if (!ok) throw new HttpError(403, 'You cannot change this document');
}

export async function upload(
    actor: AuthUser,
    file: { originalname: string; buffer: Buffer },
    f: UploadFields,
) {
    const fileName = cleanFileName(file.originalname);
    if (!fileName) throw new HttpError(400, 'The file needs a name');
    const { contentType } = checkFile(fileName, file.buffer);

    const accessLevel = f.accessLevel ?? 'PROTECTED';
    if (accessLevel === 'RESTRICTED' && actor.role !== 'ORG_ADMIN') {
        throw new HttpError(403, 'Only an admin can mark a document as restricted');
    }

    if (f.instanceId) {
        const inst = await prisma.complianceInstance.findFirst({
            where: { id: f.instanceId, orgId: actor.orgId },
            select: { ownerId: true, managerId: true, approverId: true, status: true },
        });
        const involved =
            !!inst &&
            (inst.ownerId === actor.id || inst.managerId === actor.id || inst.approverId === actor.id);
        if (!inst || (actor.role === 'MEMBER' && !involved)) {
            throw new HttpError(404, 'Compliance item not found');
        }
        if (inst.ownerId !== actor.id) {
            throw new HttpError(403, 'Only the owner can attach proof to this item');
        }
        if (!OPEN.includes(inst.status)) throw new HttpError(409, FROZEN);
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const id = randomUUID();
    const storageKey = `${actor.orgId}/${id}`;

    await storage.put(storageKey, file.buffer, contentType);
    try {
        const row = await prisma.$transaction(async (tx) => {
            if (f.instanceId) {
                await lockOpenInstance(tx, actor.orgId, f.instanceId, actor.id);

                const count = await tx.document.count({ where: { instanceId: f.instanceId, deletedAt: null } });
                if (count >= MAX_PER_INSTANCE) {
                    throw new HttpError(400, `An item can have at most ${MAX_PER_INSTANCE} documents`);
                }
                const dup = await tx.document.findFirst({
                    where: { instanceId: f.instanceId, sha256, deletedAt: null },
                    select: { id: true },
                });
                if (dup) throw new HttpError(409, 'This file is already attached to this item');
            }

            const created = await tx.document.create({
                data: {
                    id,
                    orgId: actor.orgId,
                    instanceId: f.instanceId ?? null,
                    title: f.title ?? fileName,
                    description: f.description || null,
                    docNumber: f.docNumber || null,
                    accessLevel,
                    expiresAt: f.expiresAt ? parseDateOnly(f.expiresAt) : null,
                    fileName,
                    contentType,
                    sizeBytes: file.buffer.length,
                    sha256,
                    storageKey,
                    uploadedById: actor.id,
                },
                select: publicSelect,
            });
            await recordAudit(tx, actor, 'DOCUMENT_UPLOADED', 'Document', id, {
                instanceId: f.instanceId ?? null,
                fileName,
                sizeBytes: file.buffer.length,
                accessLevel,
            });
            return created;
        });
        return present(row);
    } catch (e) {
        await storage.remove(storageKey).catch(() => undefined);
        throw e;
    }
}

export async function list(actor: AuthUser, q: ListQuery) {
    const today = parseDateOnly(todayInIndia());
    const and: Prisma.DocumentWhereInput[] = [visibleDocs(actor)];

    if (q.instanceId) and.push({ instanceId: q.instanceId });
    if (q.standalone) and.push({ instanceId: null });
    if (q.entityId) and.push({ instance: { entityId: q.entityId } });
    if (q.accessLevel) and.push({ accessLevel: q.accessLevel });
    if (q.uploadedById) and.push({ uploadedById: q.uploadedById });
    if (q.expired) and.push({ expiresAt: { lt: today } });
    if (q.expiringInDays) {
        and.push({ expiresAt: { gte: today, lte: new Date(today.getTime() + q.expiringInDays * DAY) } });
    }
    if (q.search) {
        and.push({
            OR: [
                { title: { contains: q.search, mode: insensitive } },
                { fileName: { contains: q.search, mode: insensitive } },
                { docNumber: { contains: q.search, mode: insensitive } },
            ],
        });
    }

    const where: Prisma.DocumentWhereInput = { AND: and };
    const [total, items] = await prisma.$transaction([
        prisma.document.count({ where }),
        prisma.document.findMany({
            where,
            select: publicSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    return { items: items.map(present), total, page: q.page, limit: q.limit };
}

export async function get(actor: AuthUser, id: string) {
    const row = await prisma.document.findFirst({
        where: { AND: [visibleDocs(actor), { id }] },
        select: publicSelect,
    });
    if (!row) throw new HttpError(404, 'Document not found');
    return present(row);
}

export async function update(actor: AuthUser, id: string, input: UpdateInput) {
    const row = await prisma.$transaction(async (tx) => {
        const doc = await tx.document.findFirst({
            where: { AND: [visibleDocs(actor), { id }] },
            include: { instance: { select: { ownerId: true } } },
        });
        if (!doc) throw new HttpError(404, 'Document not found');
        assertCanManage(actor, doc);

        if (input.accessLevel === 'RESTRICTED' && actor.role !== 'ORG_ADMIN') {
            throw new HttpError(403, 'Only an admin can mark a document as restricted');
        }
        if (doc.instanceId) await lockOpenInstance(tx, actor.orgId, doc.instanceId);

        const data: Prisma.DocumentUncheckedUpdateInput = {};
        if (input.title !== undefined) data.title = input.title;
        if (input.description !== undefined) data.description = input.description || null;
        if (input.docNumber !== undefined) data.docNumber = input.docNumber || null;
        if (input.accessLevel !== undefined) data.accessLevel = input.accessLevel;
        if (input.expiresAt !== undefined) {
            data.expiresAt = input.expiresAt ? parseDateOnly(input.expiresAt) : null;
        }

        const after = await tx.document.update({ where: { id }, data, select: publicSelect });
        const changes = changedFields(doc, after, [
            'title', 'description', 'docNumber', 'accessLevel', 'expiresAt',
        ]);
        if (Object.keys(changes as object).length) {
            await recordAudit(tx, actor, 'DOCUMENT_UPDATED', 'Document', id, changes);
        }
        return after;
    });
    return present(row);
}

// A soft delete: the file stays in storage, and the audit log keeps the history
export async function remove(actor: AuthUser, id: string) {
    await prisma.$transaction(async (tx) => {
        const doc = await tx.document.findFirst({
            where: { AND: [visibleDocs(actor), { id }] },
            include: { instance: { select: { ownerId: true } } },
        });
        if (!doc) throw new HttpError(404, 'Document not found');
        assertCanManage(actor, doc);
        if (doc.instanceId) await lockOpenInstance(tx, actor.orgId, doc.instanceId);

        await tx.document.update({
            where: { id },
            data: { deletedAt: new Date(), deletedById: actor.id },
        });
        await recordAudit(tx, actor, 'DOCUMENT_DELETED', 'Document', id, {
            fileName: doc.fileName,
            instanceId: doc.instanceId,
        });
    });
}

export async function downloadUrl(actor: AuthUser, id: string) {
    const doc = await prisma.document.findFirst({
        where: { AND: [visibleDocs(actor), { id }] },
        select: { id: true, fileName: true, contentType: true, storageKey: true },
    });
    if (!doc) throw new HttpError(404, 'Document not found');

    await recordAudit(prisma, actor, 'DOCUMENT_DOWNLOADED', 'Document', doc.id, { fileName: doc.fileName });

    const direct = await storage.signedUrl(doc.storageKey, doc.fileName, doc.contentType, DOWNLOAD_TTL_SECONDS);
    return {
        url: direct ?? `/api/documents/files/${signDownloadToken(doc.id, actor.orgId)}`,
        fileName: doc.fileName,
        expiresInSeconds: DOWNLOAD_TTL_SECONDS,
    };
}

// Local disk only: serves a file for a valid, unexpired link
export async function openLocalFile(token: string): Promise<{
    doc: { fileName: string; contentType: string };
    stream: Readable;
}> {
    if (env.STORAGE_DRIVER !== 'local') throw new HttpError(404, 'Not found');

    let claims: { documentId: string; orgId: string };
    try {
        claims = verifyDownloadToken(token);
    } catch {
        throw new HttpError(401, 'Invalid or expired link');
    }

    const doc = await prisma.document.findFirst({
        where: { id: claims.documentId, orgId: claims.orgId, deletedAt: null },
        select: { fileName: true, contentType: true, storageKey: true },
    });
    if (!doc) throw new HttpError(404, 'Document not found');
    return { doc, stream: storage.read(doc.storageKey) };
}

// Items that still need proof: mandatory, open, and with no valid document attached
function missingWhere(actor: AuthUser, q: Partial<MissingQuery>): Prisma.ComplianceInstanceWhereInput {
    const today = parseDateOnly(todayInIndia());
    return {
        orgId: actor.orgId,
        status: { in: OPEN },
        compliance: { attachment: 'MANDATORY' },
        documents: {
            none: { deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gte: today } }] },
        },
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.locationId ? { locationId: q.locationId } : {}),
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.dueFrom || q.dueTo
            ? {
                dueDate: {
                    ...(q.dueFrom ? { gte: parseDateOnly(q.dueFrom) } : {}),
                    ...(q.dueTo ? { lte: parseDateOnly(q.dueTo) } : {}),
                },
            }
            : {}),
        AND: [visibleTo(actor)],
    };
}

export async function missing(actor: AuthUser, q: MissingQuery) {
    const where = missingWhere(actor, q);
    const today = todayInIndia();

    const [total, rows] = await prisma.$transaction([
        prisma.complianceInstance.count({ where }),
        prisma.complianceInstance.findMany({
            where,
            select: {
                id: true,
                dueDate: true,
                periodStart: true,
                periodEnd: true,
                status: true,
                compliance: { select: { code: true, title: true } },
                entity: { select: { id: true, name: true } },
                location: { select: { id: true, name: true } },
                owner: { select: { id: true, name: true } },
                manager: { select: { id: true, name: true } },
            },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);

    const items = rows.map((r) => ({ ...r, overdue: toDateOnly(r.dueDate) < today }));
    return { items, total, page: q.page, limit: q.limit };
}

export async function summary(actor: AuthUser) {
    const today = parseDateOnly(todayInIndia());
    const in30 = new Date(today.getTime() + 30 * DAY);
    const visible = visibleDocs(actor);

    const [total, expired, expiringSoon, missingProof] = await prisma.$transaction([
        prisma.document.count({ where: visible }),
        prisma.document.count({ where: { AND: [visible, { expiresAt: { lt: today } }] } }),
        prisma.document.count({ where: { AND: [visible, { expiresAt: { gte: today, lte: in30 } }] } }),
        prisma.complianceInstance.count({ where: missingWhere(actor, {}) }),
    ]);
    return { total, expired, expiringIn30Days: expiringSoon, itemsMissingProof: missingProof };
}