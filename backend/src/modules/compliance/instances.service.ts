import { InstanceStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly, toDateOnly, todayInIndia } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import type { GenerateInput } from './compliance.schema';
import { occurrences } from './schedule.engine';
import { dashboardStatus } from './status';

const MAX_ROWS = 50_000;
const insensitive = Prisma.QueryMode.insensitive;

type Row = {
    orgId: string;
    scheduleId: string;
    complianceId: string;
    entityId: string;
    locationId: string;
    departmentId: string | null;
    verticalId: string | null;
    ownerId: string;
    managerId: string;
    approverId: string | null;
    requiresApprover: boolean;
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date;
};

const rowKey = (scheduleId: string, periodStart: Date) => `${scheduleId}|${toDateOnly(periodStart)}`;

export async function generate(actor: AuthUser, input: GenerateInput, dryRun: boolean) {
    const { orgId } = actor;
    const from = parseDateOnly(input.from);
    const to = parseDateOnly(input.to);

    const schedules = await prisma.complianceSchedule.findMany({
        where: {
            orgId,
            isActive: true,
            compliance: { isActive: true },
            location: { isActive: true, entity: { isActive: true } },
            ...(input.entityId ? { entityId: input.entityId } : {}),
            ...(input.locationId ? { locationId: input.locationId } : {}),
            ...(input.scheduleIds?.length ? { id: { in: input.scheduleIds } } : {}),
        },
        select: {
            id: true,
            complianceId: true,
            entityId: true,
            locationId: true,
            departmentId: true,
            verticalId: true,
            ownerId: true,
            managerId: true,
            approverId: true,
            startDate: true,
            compliance: {
                select: { frequency: true, periodBasis: true, dueDay: true, dueMonthOffset: true, risk: true },
            },
        },
    });

    const rows: Row[] = [];
    let eventBasedSkipped = 0;

    for (const s of schedules) {
        if (s.compliance.frequency === 'EVENT_BASED') {
            eventBasedSkipped++;
            continue;
        }
        for (const o of occurrences(s.compliance, s.startDate, from, to)) {
            rows.push({
                orgId,
                scheduleId: s.id,
                complianceId: s.complianceId,
                entityId: s.entityId,
                locationId: s.locationId,
                departmentId: s.departmentId,
                verticalId: s.verticalId,
                ownerId: s.ownerId,
                managerId: s.managerId,
                approverId: s.approverId,
                requiresApprover: s.compliance.risk === 'HIGH',
                periodStart: o.periodStart,
                periodEnd: o.periodEnd,
                dueDate: o.dueDate,
            });
            if (rows.length > MAX_ROWS) {
                throw new HttpError(
                    400,
                    `This would create more than ${MAX_ROWS} items. Narrow the date range or filter by entity or location.`,
                );
            }
        }
    }

    // Which of these already exist (so re-running only adds what is missing)
    const existing = new Set<string>();
    if (rows.length) {
        let min = rows[0].periodStart.getTime();
        let max = min;
        for (const r of rows) {
            const t = r.periodStart.getTime();
            if (t < min) min = t;
            if (t > max) max = t;
        }
        const ids = [...new Set(rows.map((r) => r.scheduleId))];
        for (const part of chunks(ids, 5000)) {
            const found = await prisma.complianceInstance.findMany({
                where: {
                    orgId,
                    scheduleId: { in: part },
                    periodStart: { gte: new Date(min), lte: new Date(max) },
                },
                select: { scheduleId: true, periodStart: true },
            });
            for (const f of found) existing.add(rowKey(f.scheduleId, f.periodStart));
        }
    }

    const fresh = rows.filter((r) => !existing.has(rowKey(r.scheduleId, r.periodStart)));

    const byMonth: Record<string, number> = {};
    let firstDue: string | null = null;
    let lastDue: string | null = null;
    for (const r of fresh) {
        const due = toDateOnly(r.dueDate);
        const month = due.slice(0, 7);
        byMonth[month] = (byMonth[month] ?? 0) + 1;
        if (!firstDue || due < firstDue) firstDue = due;
        if (!lastDue || due > lastDue) lastDue = due;
    }
    const byMonthSorted = Object.fromEntries(Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)));

    const summary = {
        dryRun,
        from: input.from,
        to: input.to,
        schedulesConsidered: schedules.length,
        eventBasedSkipped,
        candidates: rows.length,
        alreadyExist: rows.length - fresh.length,
        toCreate: fresh.length,
        firstDue,
        lastDue,
        byMonth: byMonthSorted,
    };

    if (dryRun || fresh.length === 0) return { ...summary, created: 0 };

    const created = await prisma.$transaction(
        async (tx) => {
            let count = 0;
            for (const part of chunks(fresh)) {
                const r = await tx.complianceInstance.createMany({ data: part, skipDuplicates: true });
                count += r.count;
            }
            await recordAudit(tx, actor, 'INSTANCES_GENERATED', 'ComplianceInstance', 'generate', {
                from: input.from,
                to: input.to,
                created: count,
                schedulesConsidered: schedules.length,
            });
            return count;
        },
        { timeout: 5 * 60 * 1000, maxWait: 10_000 },
    );

    return { ...summary, dryRun: false, created };
}

const person = { select: { id: true, name: true } } as const;

export const instanceInclude = {
    compliance: {
        select: {
            id: true,
            code: true,
            title: true,
            form: true,
            event: true,
            description: true,
            reference: true,
            penalty: true,
            imprisonment: true,
            risk: true,
            impact: true,
            attachment: true,
            frequency: true,
            act: {
                select: {
                    id: true,
                    name: true,
                    jurisdiction: true,
                    state: true,
                    lawCategory: { select: { id: true, name: true } },
                },
            },
        },
    },
    entity: { select: { id: true, name: true, code: true } },
    location: { select: { id: true, name: true, state: true } },
    department: { select: { id: true, name: true } },
    vertical: { select: { id: true, name: true } },
    _count: { select: { documents: { where: { deletedAt: null } } } },
    owner: person,
    manager: person,
    approver: person,
} as const;

// Admins and viewers see everything; members see only what they own, manage or approve
export function visibleTo(actor: AuthUser): Prisma.ComplianceInstanceWhereInput {
    if (actor.role !== 'MEMBER') return {};
    return { OR: [{ ownerId: actor.id }, { managerId: actor.id }, { approverId: actor.id }] };
}

export function withOverdue<T extends { dueDate: Date; status: InstanceStatus; doneDate: Date | null }>(row: T) {
    const label = dashboardStatus(row, todayInIndia());
    return { ...row, overdue: label === 'NON_COMPLIANCE', dashboardStatus: label };
}

export async function getInstance(actor: AuthUser, id: string) {
    const row = await prisma.complianceInstance.findFirst({
        where: { id, orgId: actor.orgId, ...visibleTo(actor) },
        include: instanceInclude,
    });
    if (!row) throw new HttpError(404, 'Compliance item not found');
    return withOverdue(row);
}