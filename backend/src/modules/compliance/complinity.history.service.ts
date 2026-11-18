import type { InstanceStatus, Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import { planComplinityAssignments, readDashboardData } from './complinity.assign';
import type { Sheet } from './complinity.assign';
import { TX, failure, lookups, readFirstSheet, saveAssignmentPlan } from './complinity.assign.service';
import { planHistory, readHistory, scheduleKey } from './complinity.history';
import type { HistoryLookups, PlannedItem, ScheduleRef } from './complinity.history';

type Db = Prisma.TransactionClient | typeof prisma;
const lower = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

async function historyLookups(db: Db, orgId: string, codes: string[], periodFrom: string, periodTo: string): Promise<HistoryLookups> {
    const schedules = await db.complianceSchedule.findMany({
        where: { orgId, compliance: { code: { in: codes } } },
        select: {
            id: true, complianceId: true, entityId: true, locationId: true, departmentId: true, verticalId: true, approverId: true,
            compliance: { select: { code: true, risk: true } },
            entity: { select: { name: true } },
            location: { select: { name: true } },
        },
    });
    const scheduleAt = new Map<string, ScheduleRef>(
        schedules.map((s) => [
            scheduleKey(s.entity.name, s.location.name, s.compliance.code),
            {
                id: s.id, complianceId: s.complianceId, entityId: s.entityId, locationId: s.locationId, departmentId: s.departmentId,
                verticalId: s.verticalId, approverId: s.approverId, highRisk: s.compliance.risk === 'HIGH',
            },
        ]),
    );
    const users = await db.user.findMany({ where: { orgId }, select: { id: true, email: true, name: true } });
    const found: { id: string; scheduleId: string; periodStart: Date; status: InstanceStatus; submittedAt: Date | null }[] = [];
    const instances: HistoryLookups['instances'] = new Map();
    for (const part of chunks(schedules.map((s) => s.id), 5000)) {
        found.push(
            ...(await db.complianceInstance.findMany({
                where: { orgId, scheduleId: { in: part }, periodStart: { gte: parseDateOnly(periodFrom), lte: parseDateOnly(periodTo) } },
                select: { id: true, scheduleId: true, periodStart: true, status: true, submittedAt: true },
            })),
        );
    }
    for (const f of found) {
        instances.set(`${f.scheduleId}|${f.periodStart.toISOString().slice(0, 10)}`, {
            id: f.id,
            status: f.status,
            // Generated but not yet worked on: the history can fill it in
            touched: f.status !== 'DUE' || f.submittedAt !== null,
        });
    }
    return {
        scheduleAt,
        userByEmail: new Map(users.map((u) => [u.email.toLowerCase(), u.id])),
        userByName: new Map(users.map((u) => [lower(u.name), u.id])),
        instances,
    };
}

const at = (iso: string | null) => (iso ? new Date(iso) : null);
const day = (d: string | null) => (d ? parseDateOnly(d) : null);

function instanceData(p: PlannedItem) {
    const r = p.row;
    const finished = r.status === 'CLOSED' || r.status === 'NOT_APPLICABLE';
    const submittedAt = at(r.submittedAt) ?? (r.status !== 'DUE' ? day(r.doneDate) : null);
    const closedAt = finished ? (at(r.closedAt) ?? submittedAt ?? day(r.doneDate) ?? parseDateOnly(r.dueDate)) : null;
    return {
        ownerId: p.ownerId,
        managerId: p.managerId,
        status: r.status,
        submissionType: r.submissionType,
        isWip: r.isWip,
        doneDate: day(r.doneDate),
        dueDate: parseDateOnly(r.dueDate),
        periodEnd: parseDateOnly(r.periodEnd),
        refNo: r.refNo,
        challanNo: r.challanNo,
        remarks: r.remarks,
        submittedAt,
        submittedById: submittedAt ? p.submittedById : null,
        managerActionAt: finished ? closedAt : null,
        managerActionById: finished ? p.approvedById : null,
        closedAt,
        closedById: finished ? p.approvedById : null,
    };
}

/**
 * Complinity's Dashboard Data exports with every status: brings the past due items across with their status,
 * done date, reference number and remarks. Old assignments that are not here yet are added as stopped first.
 * Items someone has already worked on here are left alone. Checked first with dryRun.
 */
export async function importComplinityHistory(actor: AuthUser, files: { name: string; buffer: Buffer }[], opts: { dryRun: boolean }) {
    const { orgId } = actor;
    const sheets: Sheet[] = [];
    for (const f of files) sheets.push(await readFirstSheet(f.name, f.buffer));

    const read = readDashboardData(sheets);
    const hist = readHistory(sheets);
    const fileErrors = [...new Set([...read.fileErrors, ...hist.fileErrors])];
    if (fileErrors.length || read.errors.length || hist.errors.length) return failure([...read.errors, ...hist.errors], fileErrors, []);

    const codes = [...new Set(hist.rows.map((r) => r.code))];
    const lk = await lookups(orgId, codes);
    // Old assignments missing here are added as stopped, so their history has somewhere to go
    const aplan = planComplinityAssignments(read.assignments, read.latest, lk, { pastOnly: true });
    if (aplan.errors.length) return failure(aplan.errors, [], aplan.warnings);
    const missing = aplan.planned.filter((p) => !p.existingId);

    const periodFrom = hist.rows.reduce((m, r) => (r.periodStart < m ? r.periodStart : m), '9999-12-31');
    const periodTo = hist.rows.reduce((m, r) => (r.periodStart > m ? r.periodStart : m), '0000-01-01');
    const summarize = (plan: ReturnType<typeof planHistory>, dryRun: boolean) => {
        const all = [...plan.create, ...plan.update];
        const count = (f: (p: PlannedItem) => boolean) => all.filter(f).length;
        return {
            ok: true as const,
            dryRun,
            rows: hist.rows.length,
            from: periodFrom,
            to: periodTo,
            assignmentsAdded: missing.length,
            toCreate: plan.create.length,
            toUpdate: plan.update.length,
            onTime: count((p) => p.row.status === 'CLOSED' && !!p.row.doneDate && p.row.doneDate <= p.row.dueDate),
            late: count((p) => p.row.status === 'CLOSED' && !!p.row.doneDate && p.row.doneDate > p.row.dueDate),
            notApplicable: count((p) => p.row.status === 'NOT_APPLICABLE'),
            pending: count((p) => p.row.status === 'SUBMITTED'),
            open: count((p) => p.row.status === 'DUE'),
            warnings: [
                ...plan.warnings,
                ...(missing.length ? [`${missing.length} older assignment(s) from Complinity are not here yet. They are added as stopped, to hold their history.`] : []),
                'Proof files stay in Complinity: the export does not include them.',
            ],
        };
    };

    if (opts.dryRun) {
        const hl = await historyLookups(prisma, orgId, codes, periodFrom, periodTo);
        // Stand-ins for the assignments that would be added, so the check can count their items
        missing.forEach((p, i) => {
            hl.scheduleAt.set(scheduleKey(p.location.entity, p.location.name, p.compliance.code), {
                id: `new-${i}`, complianceId: p.compliance.id, entityId: '', locationId: '', departmentId: null, verticalId: null, approverId: null, highRisk: false,
            });
        });
        const plan = planHistory(hist.rows, hl);
        if (plan.errors.length) return failure(plan.errors, [], plan.warnings);
        return summarize(plan, true);
    }

    return prisma.$transaction(async (tx) => {
        const added = await saveAssignmentPlan(tx, orgId, aplan, missing, [], periodFrom);
        const hl = await historyLookups(tx, orgId, codes, periodFrom, periodTo);
        const plan = planHistory(hist.rows, hl);
        if (plan.errors.length) return failure(plan.errors, [], plan.warnings);

        for (const part of chunks(plan.create, 1000)) {
            await tx.complianceInstance.createMany({
                data: part.map((p) => ({
                    orgId,
                    scheduleId: p.schedule.id,
                    complianceId: p.schedule.complianceId,
                    entityId: p.schedule.entityId,
                    locationId: p.schedule.locationId,
                    departmentId: p.schedule.departmentId,
                    verticalId: p.schedule.verticalId,
                    approverId: p.schedule.approverId,
                    requiresApprover: p.schedule.highRisk,
                    periodStart: parseDateOnly(p.row.periodStart),
                    ...instanceData(p),
                })),
                skipDuplicates: true,
            });
        }
        for (const p of plan.update) {
            await tx.complianceInstance.update({ where: { id: p.existingId as string }, data: instanceData(p) });
        }
        await recordAudit(tx, actor, 'HISTORY_IMPORTED', 'Instance', 'complinity', {
            source: 'Complinity Dashboard Data',
            files: files.map((f) => f.name),
            assignmentsAdded: added,
            created: plan.create.length,
            updated: plan.update.length,
            from: periodFrom,
            to: periodTo,
        });
        return summarize(plan, false);
    }, TX);
}