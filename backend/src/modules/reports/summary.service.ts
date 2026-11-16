import { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { todayInIndia } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import type { StatusCounts } from '../compliance/dashboard.calc';
import { DASHBOARD_STATUSES, buildInstanceWhere, dashboardStatusWhere, dueRange } from '../compliance/filters';
import { resolvePeriod } from '../compliance/periods';
import type { DashboardStatus } from '../compliance/status';
import { toCsv, type Column } from './export.format';
import { toXlsx } from './export.xlsx';
import type { SummaryQuery } from './reports.schema';
import {
    GROUP_LABEL, baseFieldOf, buildSummary,
    type BaseField, type GroupBy, type MoneyRow, type StatusCountRow, type SummaryRow,
} from './summary.calc';

const COUNT_KEY: Record<DashboardStatus, keyof StatusCounts> = {
    NON_COMPLIANCE: 'nonCompliance',
    LATE_CLOSURE: 'lateClosure',
    ON_TIME: 'onTime',
    DUE: 'due',
    NOT_APPLICABLE: 'notApplicable',
    PENDING_APPROVAL: 'pendingApproval',
};

const titleCase = (s: string) =>
    s
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
const num = (d: Prisma.Decimal | null | undefined) => (d ? Number(d.toString()) : 0);

// Prisma's types cannot follow a grouping column chosen at run time, so this gives the
// one shape used here. The column is always one of BaseField.
type GroupRow = {
    _count: { _all: number };
    _sum?: { payableAmount: Prisma.Decimal | null; amountPaid: Prisma.Decimal | null; penaltyPaid: Prisma.Decimal | null };
} & Partial<Record<BaseField, string | null>>;
type GroupArgs = {
    by: BaseField[];
    where: Prisma.ComplianceInstanceWhereInput;
    _count?: { _all: true };
    _sum?: { payableAmount: true; amountPaid: true; penaltyPaid: true };
};
const groupBy = (args: GroupArgs) =>
    (prisma.complianceInstance.groupBy as unknown as (a: GroupArgs) => Promise<GroupRow[]>).call(
        prisma.complianceInstance,
        args,
    );

// Looks rows up by id in parts, so a very long list stays within the database's limits
async function byIds<T>(ids: string[], fetch: (part: string[]) => Promise<T[]>) {
    const out: T[] = [];
    for (const part of chunks(ids, 5000)) out.push(...(await fetch(part)));
    return out;
}

// Turns base values into group keys and names the groups
async function resolver(orgId: string, g: GroupBy, bases: string[]) {
    let groupOf: (base: string | null) => string | null = (b) => b;
    const names = new Map<string, string>();
    const named = (rows: { id: string; name: string }[]) => {
        for (const r of rows) names.set(r.id, r.name);
    };
    const pick = { id: true, name: true } as const;

    switch (g) {
        case 'entityId':
            named(await byIds(bases, (part) => prisma.entity.findMany({ where: { orgId, id: { in: part } }, select: pick })));
            break;
        case 'departmentId':
            named(await byIds(bases, (part) => prisma.department.findMany({ where: { orgId, id: { in: part } }, select: pick })));
            break;
        case 'verticalId':
            named(await byIds(bases, (part) => prisma.vertical.findMany({ where: { orgId, id: { in: part } }, select: pick })));
            break;
        case 'ownerId':
        case 'managerId':
            named(await byIds(bases, (part) => prisma.user.findMany({ where: { orgId, id: { in: part } }, select: pick })));
            break;
        case 'locationId':
        case 'state': {
            const locs = await byIds(bases, (part) =>
                prisma.location.findMany({
                    where: { orgId, id: { in: part } },
                    select: { id: true, name: true, state: true },
                }),
            );
            if (g === 'locationId') {
                for (const l of locs) names.set(l.id, `${l.name} (${l.state})`);
            } else {
                const stateOf = new Map(locs.map((l) => [l.id, l.state as string]));
                groupOf = (b) => (b ? stateOf.get(b) ?? null : null);
                for (const l of locs) names.set(l.state, l.state);
            }
            break;
        }
        default: {
            // Law category, act, risk and periodicity all come from the compliance
            const comps = await byIds(bases, (part) =>
                prisma.compliance.findMany({
                    where: { id: { in: part } },
                    select: {
                        id: true,
                        actId: true,
                        risk: true,
                        frequency: true,
                        act: {
                            select: { name: true, state: true, lawCategoryId: true, lawCategory: { select: { name: true } } },
                        },
                    },
                }),
            );
            const keyOf = new Map<string, string>();
            for (const c of comps) {
                if (g === 'actId') {
                    keyOf.set(c.id, c.actId);
                    names.set(c.actId, c.act.state ? `${c.act.name} (${c.act.state})` : c.act.name);
                } else if (g === 'lawCategoryId') {
                    keyOf.set(c.id, c.act.lawCategoryId);
                    names.set(c.act.lawCategoryId, c.act.lawCategory.name);
                } else if (g === 'risk') {
                    keyOf.set(c.id, c.risk);
                    names.set(c.risk, titleCase(c.risk));
                } else {
                    keyOf.set(c.id, c.frequency);
                    names.set(c.frequency, titleCase(c.frequency));
                }
            }
            groupOf = (b) => (b ? keyOf.get(b) ?? null : null);
        }
    }

    const labelOf = (key: string | null) => (key === null ? 'Not set' : names.get(key) ?? key);
    return { groupOf, labelOf };
}

export async function summaryReport(actor: AuthUser, q: SummaryQuery) {
    const today = todayInIndia();
    const period = resolvePeriod(q, today);
    const field = baseFieldOf(q.groupBy);
    const base: Prisma.ComplianceInstanceWhereInput = {
        AND: [buildInstanceWhere(actor, q), dueRange(period.from, period.to)],
    };

    // One grouped count per dashboard status, plus one for the amounts
    const [perStatus, sums] = await Promise.all([
        Promise.all(
            DASHBOARD_STATUSES.map(async (s) => ({
                status: COUNT_KEY[s],
                rows: await groupBy({
                    by: [field],
                    where: { AND: [base, dashboardStatusWhere([s], today)] },
                    _count: { _all: true },
                }),
            })),
        ),
        groupBy({
            by: [field],
            where: base,
            _sum: { payableAmount: true, amountPaid: true, penaltyPaid: true },
        }),
    ]);

    const counts: StatusCountRow[] = perStatus.flatMap(({ status, rows }) =>
        rows.map((r) => ({ base: r[field] ?? null, status, count: r._count._all })),
    );
    const money: MoneyRow[] = sums.map((r) => ({
        base: r[field] ?? null,
        payable: num(r._sum?.payableAmount),
        paid: num(r._sum?.amountPaid),
        penalty: num(r._sum?.penaltyPaid),
    }));

    const bases = [...new Set(counts.map((c) => c.base).filter((b): b is string => b !== null))];
    const { groupOf, labelOf } = await resolver(actor.orgId, q.groupBy, bases);
    const { rows, totals } = buildSummary(counts, money, groupOf, labelOf);

    return {
        asOf: today,
        period,
        groupBy: q.groupBy,
        groupLabel: GROUP_LABEL[q.groupBy],
        rows,
        totals,
    };
}

function summaryColumns(groupLabel: string): Column<SummaryRow>[] {
    return [
        { header: groupLabel, width: 36, get: (r) => r.label },
        { header: 'Total', width: 10, get: (r) => r.total },
        { header: 'Non compliance', width: 16, get: (r) => r.counts.nonCompliance },
        { header: 'Late closure', width: 14, get: (r) => r.counts.lateClosure },
        { header: 'On time', width: 10, get: (r) => r.counts.onTime },
        { header: 'Due', width: 10, get: (r) => r.counts.due },
        { header: 'Pending approval', width: 17, get: (r) => r.counts.pendingApproval },
        { header: 'Not applicable', width: 15, get: (r) => r.counts.notApplicable },
        { header: 'On time %', width: 11, get: (r) => r.onTimePercent },
        { header: 'Payable amount', width: 16, get: (r) => r.money.payable },
        { header: 'Amount paid', width: 16, get: (r) => r.money.paid },
        { header: 'Penalty paid', width: 16, get: (r) => r.money.penalty },
    ];
}

export async function exportSummary(actor: AuthUser, q: SummaryQuery) {
    const report = await summaryReport(actor, q);
    const cols = summaryColumns(report.groupLabel);
    const rows = [...report.rows, report.totals];
    const isCsv = q.format === 'csv';
    const body = isCsv ? Buffer.from(toCsv(rows, cols), 'utf8') : await toXlsx(rows, cols, 'Summary');

    await recordAudit(prisma, actor, 'REPORT_EXPORTED', 'Report', 'summary', {
        format: q.format,
        rows: report.rows.length,
        filters: JSON.parse(JSON.stringify(q)),
    } as Prisma.InputJsonValue);

    const slug = report.groupLabel.toLowerCase().replace(/\s+/g, '-');
    return {
        body,
        fileName: `compliance-summary-by-${slug}-${report.asOf}.${q.format}`,
        contentType: isCsv
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
}