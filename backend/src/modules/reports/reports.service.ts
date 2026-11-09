import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { toDateOnly, todayInIndia } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import { buildListWhere } from '../compliance/instances.query';
import { dashboardStatus, type DashboardStatus } from '../compliance/status';
import { toCsv, type Column } from './export.format';
import { toXlsx } from './export.xlsx';
import type { ExportQuery } from './reports.schema';

const MAX_EXPORT_ROWS = 20_000;

const STATUS_LABEL: Record<DashboardStatus, string> = {
    NON_COMPLIANCE: 'Non compliance',
    LATE_CLOSURE: 'Late closure',
    ON_TIME: 'On time',
    DUE: 'Due',
    NOT_APPLICABLE: 'Not applicable',
    PENDING_APPROVAL: 'Pending approval',
};

const select = {
    id: true,
    periodStart: true,
    periodEnd: true,
    dueDate: true,
    status: true,
    doneDate: true,
    submissionType: true,
    refNo: true,
    challanNo: true,
    penaltyPaid: true,
    payableAmount: true,
    amountPaid: true,
    actualImprisonment: true,
    remarks: true,
    compliance: {
        select: {
            code: true,
            title: true,
            risk: true,
            frequency: true,
            act: { select: { name: true, state: true, lawCategory: { select: { name: true } } } },
        },
    },
    entity: { select: { name: true } },
    location: { select: { name: true, state: true } },
    department: { select: { name: true } },
    vertical: { select: { name: true } },
    owner: { select: { name: true } },
    manager: { select: { name: true } },
    approver: { select: { name: true } },
} satisfies Prisma.ComplianceInstanceSelect;

type Row = Prisma.ComplianceInstanceGetPayload<{ select: typeof select }>;

const titleCase = (s: string) =>
    s
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
const money = (d: Prisma.Decimal | null) => (d === null ? null : Number(d.toString()));
const day = (d: Date | null) => (d ? toDateOnly(d) : null);

function columns(today: string): Column<Row>[] {
    return [
        { header: 'Code', width: 14, get: (r) => r.compliance.code },
        { header: 'Compliance', width: 48, get: (r) => r.compliance.title },
        {
            header: 'Act',
            width: 36,
            get: (r) =>
                r.compliance.act.state ? `${r.compliance.act.name} (${r.compliance.act.state})` : r.compliance.act.name,
        },
        { header: 'Law category', width: 18, get: (r) => r.compliance.act.lawCategory.name },
        { header: 'Entity', width: 28, get: (r) => r.entity.name },
        { header: 'Location', width: 22, get: (r) => r.location.name },
        { header: 'State', width: 18, get: (r) => r.location.state },
        { header: 'Department', width: 20, get: (r) => r.department?.name },
        { header: 'Vertical', width: 18, get: (r) => r.vertical?.name },
        { header: 'Owner', width: 20, get: (r) => r.owner.name },
        { header: 'Manager', width: 20, get: (r) => r.manager.name },
        { header: 'Approver', width: 20, get: (r) => r.approver?.name },
        { header: 'Risk', width: 10, get: (r) => titleCase(r.compliance.risk) },
        { header: 'Frequency', width: 14, get: (r) => titleCase(r.compliance.frequency) },
        { header: 'Period start', width: 13, get: (r) => day(r.periodStart) },
        { header: 'Period end', width: 13, get: (r) => day(r.periodEnd) },
        { header: 'Due date', width: 13, get: (r) => day(r.dueDate) },
        { header: 'Status', width: 18, get: (r) => STATUS_LABEL[dashboardStatus(r, today)] },
        { header: 'Done date', width: 13, get: (r) => day(r.doneDate) },
        { header: 'Submission', width: 16, get: (r) => (r.submissionType ? titleCase(r.submissionType) : null) },
        { header: 'Reference no', width: 18, get: (r) => r.refNo },
        { header: 'Challan no', width: 18, get: (r) => r.challanNo },
        { header: 'Payable amount', width: 16, get: (r) => money(r.payableAmount) },
        { header: 'Amount paid', width: 16, get: (r) => money(r.amountPaid) },
        { header: 'Penalty paid', width: 16, get: (r) => money(r.penaltyPaid) },
        {
            header: 'Imprisonment',
            width: 14,
            get: (r) => (r.submissionType ? (r.actualImprisonment ? 'Yes' : 'No') : null),
        },
        { header: 'Remarks', width: 40, get: (r) => r.remarks },
    ];
}

export async function exportInstances(actor: AuthUser, q: ExportQuery) {
    const where = buildListWhere(actor, q);

    const total = await prisma.complianceInstance.count({ where });
    if (total > MAX_EXPORT_ROWS) {
        throw new HttpError(
            400,
            `This export has ${total} rows, more than the limit of ${MAX_EXPORT_ROWS}. Narrow the filters.`,
        );
    }

    const rows = await prisma.complianceInstance.findMany({
        where,
        select,
        orderBy: [{ dueDate: q.order }, { id: 'asc' }],
        take: MAX_EXPORT_ROWS,
    });

    const today = todayInIndia();
    const cols = columns(today);
    const isCsv = q.format === 'csv';
    const body = isCsv ? Buffer.from(toCsv(rows, cols), 'utf8') : await toXlsx(rows, cols, 'Compliance');

    await recordAudit(prisma, actor, 'REPORT_EXPORTED', 'Report', 'instances', {
        format: q.format,
        rows: rows.length,
        filters: JSON.parse(JSON.stringify(q)),
    } as Prisma.InputJsonValue);

    return {
        body,
        fileName: `compliance-${today}.${q.format}`,
        contentType: isCsv
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
}