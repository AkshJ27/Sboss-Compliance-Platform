import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import { parseScheduleCsv } from './bulk.import.parser';
import type { RowError } from './bulk.import.parser';
import { entityFinder, existingKey, lowerKey, resolveRows, splitExisting } from './bulk.import.resolve';
import type { ComplianceRef, Lookups, NamedRef, ResolvedRow, UserRef } from './bulk.import.resolve';

type Db = Prisma.TransactionClient;
type ParsedFile = ReturnType<typeof parseScheduleCsv>;
type Plan = { errors: RowError[]; toCreate: ResolvedRow[]; alreadyActive: number; alreadyInactive: number };

const MAX_LOCATIONS = 100_000;
const MAX_ERRORS_SHOWN = 200;

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Loads only what the file refers to. Every query is limited to the signed-in company,
// except the library, which is shared.
async function loadLookups(db: Db, orgId: string, parsed: ParsedFile): Promise<Lookups> {
    const rows = parsed.rows;

    const entities = await db.entity.findMany({
        where: { orgId },
        select: { id: true, code: true, name: true, isActive: true },
    });
    const departments = await db.department.findMany({ where: { orgId }, select: { id: true, name: true, isActive: true } });
    const verticals = await db.vertical.findMany({ where: { orgId }, select: { id: true, name: true, isActive: true } });

    const findEntity = entityFinder(entities);
    const entityIds = new Set<string>();
    for (const r of rows) {
        const e = findEntity(r.entity);
        if (e) entityIds.add(e.id);
    }
    const locations =
        entityIds.size === 0
            ? []
            : await db.location.findMany({
                where: { orgId, entityId: { in: [...entityIds] } },
                select: { id: true, entityId: true, name: true, state: true, isActive: true },
                take: MAX_LOCATIONS + 1,
            });
    if (locations.length > MAX_LOCATIONS) {
        throw new HttpError(400, `The entities in this file have more than ${MAX_LOCATIONS} locations.`);
    }

    const compliances = new Map<string, ComplianceRef>();
    for (const part of chunks([...new Set(rows.map((r) => r.code))], 5000)) {
        const found = await db.compliance.findMany({
            where: { code: { in: part }, OR: [{ orgId: null }, { orgId }] },
            select: {
                id: true,
                code: true,
                title: true,
                risk: true,
                isActive: true,
                version: true,
                frequency: true,
                periodBasis: true,
                dueDay: true,
                dueMonthOffset: true,
                event: true,
                dueDaysAfterEvent: true,
                act: { select: { name: true, state: true, jurisdiction: true, isActive: true } },
            },
        });
        for (const c of found) {
            compliances.set(c.code.toUpperCase(), {
                id: c.id,
                code: c.code,
                title: c.title,
                risk: c.risk,
                isActive: c.isActive,
                version: c.version,
                frequency: c.frequency,
                periodBasis: c.periodBasis,
                dueDay: c.dueDay,
                dueMonthOffset: c.dueMonthOffset,
                event: c.event,
                dueDaysAfterEvent: c.dueDaysAfterEvent,
                actName: c.act.name,
                actState: c.act.state,
                jurisdiction: c.act.jurisdiction,
                actActive: c.act.isActive,
            });
        }
    }

    const emails = new Set<string>();
    for (const r of rows) {
        emails.add(r.owner);
        emails.add(r.manager);
        if (r.approver) emails.add(r.approver);
    }
    const users = new Map<string, UserRef>();
    for (const part of chunks([...emails], 5000)) {
        const found = await db.user.findMany({
            where: { orgId, email: { in: part } },
            select: { id: true, email: true, name: true, isActive: true, role: true },
        });
        for (const u of found) users.set(u.email.toLowerCase(), { id: u.id, name: u.name, isActive: u.isActive, role: u.role });
    }

    const departmentMap = new Map<string, NamedRef>();
    for (const d of departments) departmentMap.set(lowerKey(d.name), { id: d.id, isActive: d.isActive });
    const verticalMap = new Map<string, NamedRef>();
    for (const v of verticals) verticalMap.set(lowerKey(v.name), { id: v.id, isActive: v.isActive });

    return { entities, locations, compliances, users, departments: departmentMap, verticals: verticalMap };
}

async function loadExisting(db: Db, orgId: string, resolved: ResolvedRow[]): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    if (resolved.length === 0) return out;

    const complianceIds = [...new Set(resolved.map((r) => r.compliance.id))];
    for (const part of chunks([...new Set(resolved.map((r) => r.locationId))], 2000)) {
        const found = await db.complianceSchedule.findMany({
            where: { orgId, locationId: { in: part }, complianceId: { in: complianceIds } },
            select: { locationId: true, complianceId: true, isActive: true },
        });
        for (const e of found) out.set(existingKey(e.locationId, e.complianceId), e.isActive);
    }
    return out;
}

async function buildPlan(db: Db, orgId: string, parsed: ParsedFile, defaultStart: string | null): Promise<Plan> {
    const lookups = await loadLookups(db, orgId, parsed);
    const { resolved, errors: resolveErrors } = resolveRows(parsed.rows, lookups, defaultStart);
    const errors = [...parsed.errors, ...resolveErrors].sort((a, b) => a.row - b.row);
    if (errors.length > 0) return { errors, toCreate: [], alreadyActive: 0, alreadyInactive: 0 };

    const existing = await loadExisting(db, orgId, resolved);
    return { errors, ...splitExisting(resolved, existing) };
}

function failure(plan: Plan, parsed: ParsedFile) {
    return {
        ok: false as const,
        errorCount: plan.errors.length,
        errors: plan.errors.slice(0, MAX_ERRORS_SHOWN),
        ignoredColumns: parsed.ignoredColumns,
    };
}

function summarize(plan: Plan, parsed: ParsedFile, dryRun: boolean, created: number) {
    const byLocation = new Map<string, number>();
    for (const r of plan.toCreate) byLocation.set(r.locationLabel, (byLocation.get(r.locationLabel) ?? 0) + 1);

    return {
        ok: true as const,
        dryRun,
        ignoredColumns: parsed.ignoredColumns,
        totalRows: parsed.totalRows,
        toCreate: plan.toCreate.length,
        alreadyActive: plan.alreadyActive,
        alreadyInactive: plan.alreadyInactive,
        locations: byLocation.size,
        compliances: new Set(plan.toCreate.map((r) => r.compliance.id)).size,
        highRisk: plan.toCreate.filter((r) => r.compliance.risk === 'HIGH').length,
        byLocation: [...byLocation]
            .map(([location, count]) => ({ location, toCreate: count }))
            .sort((a, b) => b.toCreate - a.toCreate || byCodeUnits(a.location, b.location))
            .slice(0, 50),
        sample: plan.toCreate.slice(0, 20).map((r) => ({
            row: r.row,
            location: r.locationLabel,
            code: r.compliance.code,
            title: r.compliance.title,
            risk: r.compliance.risk,
            owner: r.ownerName,
            manager: r.managerName,
            startDate: r.startDate,
        })),
        created,
    };
}

export async function importSchedules(
    actor: AuthUser,
    buffer: Buffer,
    opts: { dryRun: boolean; defaultStart?: string },
) {
    const parsed = parseScheduleCsv(buffer);
    const defaultStart = opts.defaultStart ?? null;
    const { orgId } = actor;

    if (opts.dryRun) {
        const plan = await buildPlan(prisma, orgId, parsed, defaultStart);
        return plan.errors.length > 0 ? failure(plan, parsed) : summarize(plan, parsed, true, 0);
    }

    return prisma.$transaction(
        async (tx) => {
            // Checked again inside the transaction, so what is written is never based on stale data
            const plan = await buildPlan(tx, orgId, parsed, defaultStart);
            if (plan.errors.length > 0) return failure(plan, parsed);
            if (plan.toCreate.length === 0) return summarize(plan, parsed, false, 0);

            let created = 0;
            for (const part of chunks(plan.toCreate, 1000)) {
                const r = await tx.complianceSchedule.createMany({
                    data: part.map((row) => {
                        const c = row.compliance;
                        return {
                            orgId,
                            complianceId: c.id,
                            entityId: row.entityId,
                            locationId: row.locationId,
                            departmentId: row.departmentId,
                            verticalId: row.verticalId,
                            ownerId: row.ownerId,
                            managerId: row.managerId,
                            approverId: row.approverId,
                            startDate: parseDateOnly(row.startDate),
                            // The schedule follows the library as it is today
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
            if (created !== plan.toCreate.length) {
                throw new HttpError(
                    409,
                    'Some of these schedules were created by someone else while this was importing. Nothing was imported. Preview again.',
                );
            }

            await recordAudit(tx, actor, 'SCHEDULES_IMPORTED', 'Schedule', 'import', {
                created,
                rows: parsed.totalRows,
                locations: new Set(plan.toCreate.map((r) => r.locationId)).size,
            });
            return summarize(plan, parsed, false, created);
        },
        { timeout: 5 * 60 * 1000, maxWait: 10_000 },
    );
}