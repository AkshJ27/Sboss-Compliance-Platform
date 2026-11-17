import { createHash, randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { changedFields, recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly, toDateOnly, todayInIndia } from '../../lib/dates';
import { HttpError } from '../../lib/errors';
import { checkFile, cleanFileName } from '../../lib/file-types';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { writeZip } from '../../lib/zip';
import type { AuthUser } from '../../middleware/auth';
import { LEGAL_COLUMNS } from './legal.import.parser';
import { planLegalNotices } from './legal.notify';
import type { PublishedUpdate } from './legal.notify';
import type { CreateInput, ListQuery, UpdateInput } from './legal.schema';

const MAX_FILES_PER_UPDATE = 20;
const EXPORT_LIMIT = 20_000;
const insensitive = Prisma.QueryMode.insensitive;
const dateOrNull = (v: string | null | undefined) => (v ? parseDateOnly(v) : null);

const actSelect = {
    select: { id: true, name: true, jurisdiction: true, state: true, lawCategory: { select: { id: true, name: true } } },
} as const;

// ---- Reading ---------------------------------------------------------------------------------

function listWhere(actor: AuthUser, q: Partial<ListQuery>, view: 'mapped' | 'all'): Prisma.LegalUpdateWhereInput {
    const and: Prisma.LegalUpdateWhereInput[] = [];
    if (view === 'mapped') and.push({ act: { subscriptions: { some: { userId: actor.id } } } });
    if (q.region === 'CENTRAL') and.push({ act: { jurisdiction: 'CENTRAL' } });
    else if (q.region) and.push({ act: { state: q.region } });
    if (q.lawCategoryId) and.push({ act: { lawCategoryId: q.lawCategoryId } });
    if (q.actId) and.push({ actId: q.actId });
    if (q.ruleId) and.push({ ruleId: q.ruleId });
    if (q.impact) and.push({ complianceImpact: q.impact === 'yes' });
    if (q.from) and.push({ notificationDate: { gte: parseDateOnly(q.from) } });
    if (q.to) and.push({ notificationDate: { lte: parseDateOnly(q.to) } });
    if (q.search) {
        and.push({
            OR: [
                { title: { contains: q.search, mode: insensitive } },
                { referenceNumber: { contains: q.search, mode: insensitive } },
                { description: { contains: q.search, mode: insensitive } },
                { act: { name: { contains: q.search, mode: insensitive } } },
            ],
        });
    }
    return { AND: and };
}

function orderBy(q: ListQuery): Prisma.LegalUpdateOrderByWithRelationInput[] {
    const first = q.sort === 'referenceNumber' ? { referenceNumber: { sort: q.order, nulls: 'last' as const } } : { [q.sort]: q.order };
    return [first as Prisma.LegalUpdateOrderByWithRelationInput, { publishedDate: 'desc' }, { id: 'asc' }];
}

export async function list(actor: AuthUser, q: ListQuery) {
    const where = listWhere(actor, q, q.view);
    const [total, mappedTotal, allTotal, rows] = await prisma.$transaction([
        prisma.legalUpdate.count({ where }),
        prisma.legalUpdate.count({ where: listWhere(actor, q, 'mapped') }),
        prisma.legalUpdate.count({ where: listWhere(actor, q, 'all') }),
        prisma.legalUpdate.findMany({
            where,
            select: {
                id: true,
                notificationDate: true,
                publishedDate: true,
                effectiveDate: true,
                referenceNumber: true,
                title: true,
                complianceImpact: true,
                act: actSelect,
                rule: { select: { id: true, name: true } },
                _count: { select: { files: true } },
            },
            orderBy: orderBy(q),
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    const items = rows.map(({ _count, ...r }) => ({ ...r, fileCount: _count.files }));
    return { items, total, mappedTotal, allTotal, page: q.page, limit: q.limit };
}

// The choices for the filters: only categories, places and Acts that have updates
export async function filters() {
    const acts = await prisma.act.findMany({
        where: { legalUpdates: { some: {} } },
        select: { id: true, name: true, jurisdiction: true, state: true, lawCategory: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
    });
    const categories = new Map<string, string>();
    const states = new Set<string>();
    for (const a of acts) {
        categories.set(a.lawCategory.id, a.lawCategory.name);
        if (a.state) states.add(a.state);
    }
    return {
        lawCategories: [...categories].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        states: [...states].sort(),
        acts: acts.map((a) => ({ id: a.id, name: a.name, state: a.state, lawCategoryId: a.lawCategory.id })),
    };
}

export async function rulesForAct(actId: string) {
    return prisma.rule.findMany({
        where: { actId, legalUpdates: { some: {} } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });
}

const fileSelect = { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true } as const;

export async function get(id: string) {
    const row = await prisma.legalUpdate.findUnique({
        where: { id },
        include: {
            act: actSelect,
            rule: { select: { id: true, name: true } },
            files: { select: fileSelect, orderBy: { createdAt: 'asc' } },
        },
    });
    if (!row) throw new HttpError(404, 'Legal update not found');
    return row;
}

// ---- Files -------------------------------------------------------------------------------------

export async function downloadFile(fileId: string) {
    const f = await prisma.legalUpdateFile.findUnique({ where: { id: fileId } });
    if (!f) throw new HttpError(404, 'File not found');
    return { fileName: f.fileName, contentType: f.contentType, data: await storage.get(f.storageKey) };
}

// Several attachments of one update as a zip. No ids: all of them.
export async function zipFiles(id: string, ids: string[]) {
    const files = await prisma.legalUpdateFile.findMany({
        where: { legalUpdateId: id, ...(ids.length ? { id: { in: ids } } : {}) },
        orderBy: { createdAt: 'asc' },
    });
    if (!files.length) throw new HttpError(404, 'No files to download');
    const entries = [];
    for (const f of files) entries.push({ name: f.fileName, data: await storage.get(f.storageKey) });
    return writeZip(entries);
}

export async function addFiles(actor: AuthUser, id: string, files: { originalname: string; buffer: Buffer }[]) {
    if (!files.length) throw new HttpError(400, 'Choose at least one file');
    const existing = await prisma.legalUpdateFile.count({ where: { legalUpdateId: id } });
    if (!(await prisma.legalUpdate.count({ where: { id } }))) throw new HttpError(404, 'Legal update not found');
    if (existing + files.length > MAX_FILES_PER_UPDATE) throw new HttpError(400, `At most ${MAX_FILES_PER_UPDATE} files per legal update`);

    const prepared = files.map((f) => {
        const fileName = cleanFileName(f.originalname);
        if (!fileName) throw new HttpError(400, 'Every file needs a name');
        const { contentType } = checkFile(fileName, f.buffer);
        const fileId = randomUUID();
        return {
            id: fileId,
            fileName,
            contentType,
            data: f.buffer,
            sha256: createHash('sha256').update(f.buffer).digest('hex'),
            storageKey: `legal-updates/${id}/${fileId}`,
        };
    });
    const stored: string[] = [];
    try {
        for (const p of prepared) {
            await storage.put(p.storageKey, p.data, p.contentType);
            stored.push(p.storageKey);
        }
        await prisma.$transaction(async (tx) => {
            await tx.legalUpdateFile.createMany({
                data: prepared.map((p) => ({
                    id: p.id,
                    legalUpdateId: id,
                    fileName: p.fileName,
                    contentType: p.contentType,
                    sizeBytes: p.data.length,
                    sha256: p.sha256,
                    storageKey: p.storageKey,
                    uploadedById: actor.id,
                })),
            });
            await recordAudit(tx, actor, 'LEGAL_UPDATE_FILES_ADDED', 'LegalUpdate', id, {
                files: prepared.map((p) => p.fileName),
            });
        });
    } catch (e) {
        await Promise.all(stored.map((k) => storage.remove(k).catch(() => undefined)));
        throw e;
    }
    return get(id);
}

export async function removeFile(actor: AuthUser, id: string, fileId: string) {
    const f = await prisma.legalUpdateFile.findFirst({ where: { id: fileId, legalUpdateId: id } });
    if (!f) throw new HttpError(404, 'File not found');
    await prisma.$transaction(async (tx) => {
        await tx.legalUpdateFile.delete({ where: { id: fileId } });
        await recordAudit(tx, actor, 'LEGAL_UPDATE_FILE_REMOVED', 'LegalUpdate', id, { fileName: f.fileName });
    });
    await storage.remove(f.storageKey).catch(() => undefined);
}

// ---- Writing (platform administrator) -----------------------------------------------------------

async function checkActRule(actId: string, ruleId: string | null | undefined) {
    const act = await prisma.act.findFirst({ where: { id: actId, orgId: null }, select: { id: true } });
    if (!act) throw new HttpError(400, 'That Act was not found in the shared library');
    if (ruleId && !(await prisma.rule.count({ where: { id: ruleId, actId } }))) {
        throw new HttpError(400, 'That rule does not belong to the chosen Act');
    }
}

// Bell notices (and emails for those who asked) for updates just published
export async function notifyFollowers(tx: Prisma.TransactionClient, updates: PublishedUpdate[]) {
    if (!updates.length) return 0;
    const actIds = [...new Set(updates.map((u) => u.actId))];
    const followers = await tx.actSubscription.findMany({
        where: { actId: { in: actIds }, user: { isActive: true } },
        select: { userId: true, orgId: true, actId: true, emailAlerts: true, user: { select: { emailAlerts: true } } },
    });
    const wantsEmail = new Map(followers.map((f) => [f.userId, f.user.emailAlerts]));
    const notices = planLegalNotices(updates, followers, todayInIndia());
    const batch = randomUUID();
    let created = 0;
    for (const part of chunks(notices, 500)) {
        const r = await tx.notification.createMany({
            data: part.map((n) => ({
                orgId: n.orgId,
                userId: n.userId,
                type: 'LEGAL_UPDATE' as const,
                title: n.title.slice(0, 250),
                body: n.body,
                dedupeKey: `legal:${batch}`,
                emailStatus: n.email && wantsEmail.get(n.userId) ? ('PENDING' as const) : ('NONE' as const),
            })),
            skipDuplicates: true,
        });
        created += r.count;
    }
    return created;
}

export async function create(actor: AuthUser, input: CreateInput) {
    await checkActRule(input.actId, input.ruleId);
    return prisma.$transaction(async (tx) => {
        const row = await tx.legalUpdate.create({
            data: {
                actId: input.actId,
                ruleId: input.ruleId ?? null,
                ministry: input.ministry || null,
                notificationDate: parseDateOnly(input.notificationDate),
                effectiveDate: dateOrNull(input.effectiveDate),
                publishedDate: parseDateOnly(input.publishedDate ?? input.notificationDate),
                referenceNumber: input.referenceNumber || null,
                title: input.title,
                description: input.description,
                complianceImpact: input.complianceImpact ?? false,
                isChange: input.isChange ?? false,
                isAddition: input.isAddition ?? false,
                isDeletion: input.isDeletion ?? false,
                isSchedule: input.isSchedule ?? false,
                impactedCompliance: input.impactedCompliance || null,
                createdById: actor.id,
            },
            include: { act: { select: { name: true } } },
        });
        const notified =
            input.notify === false
                ? 0
                : await notifyFollowers(tx, [
                    { id: row.id, actId: row.actId, actName: row.act.name, title: row.title, publishedDate: toDateOnly(row.publishedDate) },
                ]);
        await recordAudit(tx, actor, 'LEGAL_UPDATE_CREATED', 'LegalUpdate', row.id, { title: row.title, notified });
        return { id: row.id, notified };
    });
}

const COMPARED = [
    'actId', 'ruleId', 'ministry', 'notificationDate', 'effectiveDate', 'publishedDate', 'referenceNumber', 'title',
    'description', 'complianceImpact', 'isChange', 'isAddition', 'isDeletion', 'isSchedule', 'impactedCompliance',
];

export async function update(actor: AuthUser, id: string, input: UpdateInput) {
    const before = await prisma.legalUpdate.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, 'Legal update not found');
    const actId = input.actId ?? before.actId;
    // A new Act drops the old rule unless a new one is sent
    const ruleId = input.ruleId !== undefined ? input.ruleId : input.actId && input.actId !== before.actId ? null : before.ruleId;
    await checkActRule(actId, ruleId);

    const data: Prisma.LegalUpdateUncheckedUpdateInput = { actId, ruleId };
    if (input.ministry !== undefined) data.ministry = input.ministry || null;
    if (input.notificationDate !== undefined) data.notificationDate = parseDateOnly(input.notificationDate);
    if (input.effectiveDate !== undefined) data.effectiveDate = dateOrNull(input.effectiveDate);
    if (input.publishedDate !== undefined) data.publishedDate = parseDateOnly(input.publishedDate);
    if (input.referenceNumber !== undefined) data.referenceNumber = input.referenceNumber || null;
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    for (const k of ['complianceImpact', 'isChange', 'isAddition', 'isDeletion', 'isSchedule'] as const) {
        if (input[k] !== undefined) data[k] = input[k];
    }
    if (input.impactedCompliance !== undefined) data.impactedCompliance = input.impactedCompliance || null;

    return prisma.$transaction(async (tx) => {
        const after = await tx.legalUpdate.update({ where: { id }, data });
        const changes = changedFields(before, after, COMPARED);
        if (Object.keys(changes as object).length) await recordAudit(tx, actor, 'LEGAL_UPDATE_UPDATED', 'LegalUpdate', id, changes);
        return { id };
    });
}

export async function remove(actor: AuthUser, id: string) {
    const row = await prisma.legalUpdate.findUnique({ where: { id }, include: { files: { select: { storageKey: true } } } });
    if (!row) throw new HttpError(404, 'Legal update not found');
    await prisma.$transaction(async (tx) => {
        await tx.legalUpdate.delete({ where: { id } }); // its file rows go with it
        await recordAudit(tx, actor, 'LEGAL_UPDATE_DELETED', 'LegalUpdate', id, { title: row.title, files: row.files.length });
    });
    await Promise.all(row.files.map((f) => storage.remove(f.storageKey).catch(() => undefined)));
}

// ---- Excel export: the same layout the upload reads ----------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d: Date | null) => {
    if (!d) return '';
    const s = toDateOnly(d);
    return `${s.slice(8, 10)}-${MONTHS[Number(s.slice(5, 7)) - 1]}-${s.slice(0, 4)}`;
};
const yn = (b: boolean) => (b ? 'Yes' : 'No');
// A spreadsheet runs text that starts with these as a formula
const safe = (v: string | null) => (v && /^[=+\-@\t\r]/.test(v) ? `'${v}` : (v ?? ''));

export async function exportXlsx(actor: AuthUser, q: ListQuery) {
    const [rows, org, me] = await Promise.all([
        prisma.legalUpdate.findMany({
            where: listWhere(actor, q, q.view),
            include: { act: actSelect, rule: { select: { name: true } } },
            orderBy: orderBy(q),
            take: EXPORT_LIMIT + 1,
        }),
        prisma.organization.findUnique({ where: { id: actor.orgId }, select: { name: true } }),
        prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }),
    ]);
    if (rows.length > EXPORT_LIMIT) throw new HttpError(400, `More than ${EXPORT_LIMIT.toLocaleString('en-IN')} updates match. Narrow the filters first.`);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Compliance Platform';
    const ws = wb.addWorksheet('LU-Data', { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.columns = LEGAL_COLUMNS.map((c) => ({ width: c.width }));
    const now = new Date(Date.now() + 330 * 60_000).toISOString().replace('T', ' ').slice(0, 19);
    ws.addRow(['Organisation:', org?.name ?? '', 'Report Name: ', 'Legal Updates Register']);
    ws.addRow(['Generated By:', me?.name ?? '', 'Report Generated On:', `${now} (India time)`]);
    ws.addRow([]);
    const head = ws.addRow(LEGAL_COLUMNS.map((c) => c.header));
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    for (const r of rows) {
        ws.addRow([
            r.act.lawCategory.name,
            safe(r.act.name),
            safe(r.rule?.name ?? 'NA'),
            r.act.state ?? 'Central',
            safe(r.ministry),
            day(r.notificationDate),
            day(r.effectiveDate),
            safe(r.referenceNumber ?? 'NA'),
            safe(r.title),
            safe(r.description),
            yn(r.complianceImpact),
            yn(r.isChange),
            yn(r.isAddition),
            yn(r.isDeletion),
            yn(r.isSchedule),
            safe(r.impactedCompliance),
            day(r.publishedDate),
        ]);
    }
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: LEGAL_COLUMNS.length } };
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `LegalUpdates_Data-${todayInIndia()}.xlsx` };
}