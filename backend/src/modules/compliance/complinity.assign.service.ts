import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly } from '../../lib/dates';
import { HttpError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import { planComplinityAssignments, readDashboardData } from './complinity.assign';
import type { ComplianceRef, RowError, Sheet } from './complinity.assign';
import { removeUnstartedItems } from './schedules.service';

const MAX_ERRORS_SHOWN = 200;
export const TX = { timeout: 10 * 60 * 1000, maxWait: 10_000 };
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export async function readFirstSheet(name: string, buffer: Buffer): Promise<Sheet> {
    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
        throw new HttpError(400, `Could not read ${name}. Save it as an Excel workbook (.xlsx) and try again.`);
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new HttpError(400, `${name} is empty`);
    const width = ws.columnCount;
    const grid: unknown[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        grid.push(Array.from({ length: width }, (_, i) => row.getCell(i + 1).value as unknown));
    }
    return { name, grid };
}

export const failure = (errors: RowError[], fileErrors: string[], warnings: string[]) => ({
    ok: false as const,
    fileErrors,
    errorCount: errors.length,
    errors: errors.slice(0, MAX_ERRORS_SHOWN),
    warnings,
});

export async function lookups(orgId: string, codes: string[]) {
    const named = { where: { orgId }, select: { id: true, name: true } };
    const [entities, departments, verticals, locationTypes, locations, users, compliances] = await Promise.all([
        prisma.entity.findMany({ where: { orgId }, select: { id: true, name: true, code: true } }),
        prisma.department.findMany(named),
        prisma.vertical.findMany(named),
        prisma.locationType.findMany(named),
        prisma.location.findMany({ where: { orgId }, select: { id: true, entityId: true, name: true } }),
        prisma.user.findMany({ where: { orgId }, select: { id: true, email: true, name: true, isActive: true, role: true, defaultApproverId: true } }),
        prisma.compliance.findMany({
            // The shared library and this company's own items, never another company's
            where: { code: { in: codes }, OR: [{ orgId: null }, { orgId }] },
            select: {
                id: true, code: true, isActive: true, version: true, frequency: true, periodBasis: true, dueDay: true,
                dueMonthOffset: true, event: true, dueDaysAfterEvent: true, act: { select: { jurisdiction: true, state: true, isActive: true } },
            },
        }),
    ]);
    const byCode = new Map<string, ComplianceRef>(
        compliances.map((c) => [
            c.code,
            {
                id: c.id, code: c.code, isActive: c.isActive && c.act.isActive, jurisdiction: c.act.jurisdiction, actState: c.act.state,
                version: c.version, frequency: c.frequency, periodBasis: c.periodBasis, dueDay: c.dueDay, dueMonthOffset: c.dueMonthOffset,
                event: c.event, dueDaysAfterEvent: c.dueDaysAfterEvent,
            },
        ]),
    );
    const schedules = await prisma.complianceSchedule.findMany({
        where: { orgId, complianceId: { in: compliances.map((c) => c.id) } },
        select: { id: true, locationId: true, complianceId: true, ownerId: true, managerId: true, approverId: true, departmentId: true, verticalId: true, isActive: true },
    });
    return { entities, departments, verticals, locationTypes, locations, users, compliances: byCode, schedules };
}

type Plan = ReturnType<typeof planComplinityAssignments>;
type Tx = Prisma.TransactionClient;

// Adds the masters a plan needs, then its new assignments, and updates the changed ones
export async function saveAssignmentPlan(
    tx: Tx,
    orgId: string,
    plan: Plan,
    toCreate: Plan['planned'],
    toUpdate: Plan['planned'],
    startDateText: string,
) {
    const m = plan.masters;
    if (m.entities.length) await tx.entity.createMany({ data: m.entities.map((e) => ({ orgId, name: e.name, code: e.code })) });
    if (m.departments.length) await tx.department.createMany({ data: m.departments.map((name) => ({ orgId, name })) });
    if (m.verticals.length) await tx.vertical.createMany({ data: m.verticals.map((name) => ({ orgId, name })) });
    if (m.locationTypes.length) await tx.locationType.createMany({ data: m.locationTypes.map((name) => ({ orgId, name })) });

    const idMap = async () => {
        const named = { where: { orgId }, select: { id: true, name: true } };
        const [e, d, v, t] = await Promise.all([
            tx.entity.findMany(named),
            tx.department.findMany(named),
            tx.vertical.findMany(named),
            tx.locationType.findMany(named),
        ]);
        const map = (list: { id: string; name: string }[]) => new Map(list.map((x) => [key(x.name), x.id]));
        return { entity: map(e), department: map(d), vertical: map(v), locationType: map(t) };
    };
    const ids = await idMap();
    const must = (map: Map<string, string>, name: string) => {
        const id = map.get(key(name));
        if (!id) throw new HttpError(409, `"${name}" changed while uploading. Check again.`);
        return id;
    };

    for (const part of chunks(m.locations, 500)) {
        await tx.location.createMany({
            data: part.map((l) => ({
                orgId,
                entityId: must(ids.entity, l.entity),
                name: l.name,
                state: l.state,
                locationTypeId: l.locationType ? must(ids.locationType, l.locationType) : null,
            })),
        });
    }
    const locations = await tx.location.findMany({ where: { orgId }, select: { id: true, entityId: true, name: true } });
    const locationId = new Map(locations.map((l) => [`${l.entityId}|${key(l.name)}`, l.id]));
    const where = (p: (typeof plan.planned)[number]) => {
        const entityId = must(ids.entity, p.entity);
        const id = locationId.get(`${entityId}|${key(p.location.name)}`);
        if (!id) throw new HttpError(409, `Location "${p.location.name}" changed while uploading. Check again.`);
        return { entityId, locationId: id };
    };
    const people = (p: (typeof plan.planned)[number]) => ({
        departmentId: p.department ? must(ids.department, p.department) : null,
        verticalId: p.vertical ? must(ids.vertical, p.vertical) : null,
        ownerId: p.ownerId,
        managerId: p.managerId,
        approverId: p.approverId,
        isActive: p.isActive,
    });

    const startDate = parseDateOnly(startDateText);
    let created = 0;
    for (const part of chunks(toCreate, 1000)) {
        const r = await tx.complianceSchedule.createMany({
            data: part.map((p) => {
                const c = p.compliance;
                return {
                    orgId,
                    complianceId: c.id,
                    ...where(p),
                    ...people(p),
                    startDate,
                    // The assignment follows the library as it is today
                    libraryVersion: c.version,
                    frequency: c.frequency,
                    periodBasis: c.periodBasis,
                    dueDay: c.dueDay,
                    dueMonthOffset: c.dueMonthOffset,
                    event: c.event,
                    dueDaysAfterEvent: c.dueDaysAfterEvent,
                };
            }),
            skipDuplicates: true,
        });
        created += r.count;
    }
    if (created !== toCreate.length) {
        throw new HttpError(409, 'Some of these assignments were added by someone else while uploading. Nothing was saved. Check again.');
    }
    for (const p of toUpdate) {
        await tx.complianceSchedule.update({ where: { id: p.existingId as string }, data: people(p) });
    }

    // Assignments Complinity has stopped lose their future items that nobody has started
    const stopped = toUpdate.filter((p) => p.changes.includes('stopped')).map((p) => p.existingId as string);
    if (stopped.length) await removeUnstartedItems(tx, orgId, stopped);

    return created;
}

/**
 * Complinity's Dashboard Data exports as they are: creates the entities, departments, verticals, location types and
 * locations they mention, and one assignment per Complinity assignment. Upload again to update people. Checked first with dryRun.
 */
export async function importComplinityAssignments(
    actor: AuthUser,
    files: { name: string; buffer: Buffer }[],
    opts: { dryRun: boolean; startDate: string },
) {
    const { orgId } = actor;
    const sheets: Sheet[] = [];
    for (const f of files) sheets.push(await readFirstSheet(f.name, f.buffer));

    const read = readDashboardData(sheets);
    if (read.fileErrors.length || read.errors.length) return failure(read.errors, read.fileErrors, []);

    const lk = await lookups(orgId, [...new Set(read.assignments.map((a) => a.code))]);
    const plan = planComplinityAssignments(read.assignments, read.latest, lk);
    if (plan.errors.length) return failure(plan.errors, [], plan.warnings);

    const names = new Map(lk.users.map((u) => [u.id, u.name]));
    const toCreate = plan.planned.filter((p) => !p.existingId);
    const toUpdate = plan.planned.filter((p) => p.existingId && p.changes.length);
    const summary = {
        ok: true as const,
        dryRun: opts.dryRun,
        startDate: opts.startDate,
        rows: read.rows,
        files: sheets.length,
        assignments: plan.planned.length,
        active: plan.planned.filter((p) => p.isActive).length,
        inactive: plan.planned.filter((p) => !p.isActive).length,
        toCreate: toCreate.length,
        toUpdate: toUpdate.length,
        unchanged: plan.planned.length - toCreate.length - toUpdate.length,
        withApprover: plan.planned.filter((p) => p.approverId).length,
        newMasters: {
            entities: plan.masters.entities.map((e) => `${e.name} (${e.code})`),
            departments: plan.masters.departments,
            verticals: plan.masters.verticals,
            locationTypes: plan.masters.locationTypes,
            locations: plan.masters.locations.length,
        },
        warnings: plan.warnings,
        sample: plan.planned.slice(0, 100).map((p) => ({
            id: p.assignmentId,
            code: p.compliance.code,
            location: `${p.location.entity} / ${p.location.name}`,
            owner: names.get(p.ownerId) ?? '',
            manager: names.get(p.managerId) ?? '',
            status: p.isActive ? 'Active' : 'Stopped',
            action: !p.existingId ? 'New' : p.changes.length ? `Update: ${p.changes.join(', ')}` : 'No change',
        })),
    };
    if (opts.dryRun) return summary;

    await prisma.$transaction(async (tx) => {
        const created = await saveAssignmentPlan(tx, orgId, plan, toCreate, toUpdate, opts.startDate);
        await recordAudit(tx, actor, 'SCHEDULES_IMPORTED', 'Schedule', 'complinity', {
            source: 'Complinity Dashboard Data',
            files: files.map((f) => f.name),
            created,
            updated: toUpdate.length,
            startDate: opts.startDate,
            newMasters: summary.newMasters,
        });
    }, TX);
    return summary;
}