import type { Prisma } from '@prisma/client';
import { toDateOnly } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { dashboardStatus, type DashboardStatus } from '../compliance/status';
import { toDetailPdf } from './export.pdf';

// The record list as a PDF: one detail sheet per record, laid out like Complinity's.

export const MAX_PDF_RECORDS = 200;

const STATUS: Record<DashboardStatus, { label: string; color: string }> = {
    NON_COMPLIANCE: { label: 'Non compliance', color: '#e5383b' },
    LATE_CLOSURE: { label: 'Late closure', color: '#f59e0b' },
    ON_TIME: { label: 'On time', color: '#22c55e' },
    DUE: { label: 'Due', color: '#facc15' },
    NOT_APPLICABLE: { label: 'Not applicable', color: '#9ca3af' },
    PENDING_APPROVAL: { label: 'Pending approval', color: '#f472b6' },
};

const select = {
    id: true,
    status: true,
    periodStart: true,
    periodEnd: true,
    dueDate: true,
    doneDate: true,
    submissionType: true,
    refNo: true,
    challanNo: true,
    penaltyPaid: true,
    payableAmount: true,
    amountPaid: true,
    actualImprisonment: true,
    remarks: true,
    submittedById: true,
    closedById: true,
    compliance: {
        select: {
            orgId: true,
            code: true,
            title: true,
            description: true,
            frequency: true,
            event: true,
            form: true,
            reference: true,
            penalty: true,
            imprisonment: true,
            risk: true,
            attachment: true,
            proofOfCompliance: true,
            alertOwnerDays: true,
            alertManagerDays: true,
            rule: { select: { name: true } },
            nature: { select: { name: true } },
            act: { select: { name: true, statutoryAuthority: { select: { name: true } } } },
        },
    },
    entity: { select: { name: true } },
    location: { select: { name: true, state: true, locationType: { select: { name: true } } } },
    department: { select: { name: true } },
    vertical: { select: { name: true } },
    owner: { select: { name: true } },
    manager: { select: { name: true } },
    approver: { select: { name: true } },
} satisfies Prisma.ComplianceInstanceSelect;

type Row = Prisma.ComplianceInstanceGetPayload<{ select: typeof select }>;

const NA = 'NA';
const titleCase = (s: string) =>
    s
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d: Date | null) => {
    if (!d) return NA;
    const s = toDateOnly(d);
    return `${s.slice(8, 10)}-${MONTHS[Number(s.slice(5, 7)) - 1]}-${s.slice(0, 4)}`;
};
const text = (v: string | null | undefined) => (v && v.trim() ? v : NA);
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? NA : v.toString());

function sheetRows(r: Row, people: Map<string, string>): [string, string][] {
    const c = r.compliance;
    const submitted = r.submissionType !== null;
    return [
        ['Compliance Type', c.orgId ? 'Internal' : 'Statutory'],
        ['Compliance Name', c.title],
        ['Description', text(c.description)],
        ['Compliance No', c.code],
        ['Act', c.act.name],
        ['Rule', text(c.rule?.name)],
        ['Statutory Authority', text(c.act.statutoryAuthority?.name)],
        ['Periodicity', titleCase(c.frequency)],
        ['Event Name', text(c.event)],
        ['Proof of Compliance', text(c.proofOfCompliance)],
        ['Risk', titleCase(c.risk)],
        ['Imprisonment', c.imprisonment ? 'Yes' : 'No'],
        ['Section', text(c.reference)],
        ['Return Form', text(c.form)],
        ['Attachment', titleCase(c.attachment)],
        ['Penalty', text(c.penalty)],
        ['Compliance Nature', text(c.nature?.name)],
        ['Entity', r.entity.name],
        ['Department', text(r.department?.name)],
        ['Location Type', text(r.location.locationType?.name)],
        ['Location', r.location.name],
        ['State', r.location.state],
        ['Vertical', text(r.vertical?.name)],
        ['Owner', r.owner.name],
        ['Alert Owner', c.alertOwnerDays === null ? NA : String(c.alertOwnerDays)],
        ['Manager', r.manager.name],
        ['Alert Manager', c.alertManagerDays === null ? NA : String(c.alertManagerDays)],
        ['Approver', text(r.approver?.name)],
        ['Due Date', day(r.dueDate)],
        ['From Date', day(r.periodStart)],
        ['To Date', day(r.periodEnd)],
        ['Submission Type', submitted ? titleCase(r.submissionType as string) : NA],
        ['Done Date', day(r.doneDate)],
        ['Ref No', text(r.refNo)],
        ['Challan No', text(r.challanNo)],
        ['Penalty/Interest Paid', num(r.penaltyPaid)],
        ['Payable Amount', num(r.payableAmount)],
        ['Amount Paid', num(r.amountPaid)],
        ['Actual Imprisonment', submitted ? (r.actualImprisonment ? 'Yes' : 'No') : NA],
        ['Remarks', text(r.remarks)],
        ['Submitted By', r.submittedById ? people.get(r.submittedById) ?? NA : NA],
        ['Approved By', r.status === 'CLOSED' || r.status === 'NOT_APPLICABLE' ? (r.closedById ? people.get(r.closedById) ?? NA : NA) : NA],
    ];
}

export async function recordsPdf(
    orgId: string,
    where: Prisma.ComplianceInstanceWhereInput,
    orderBy: Prisma.ComplianceInstanceOrderByWithRelationInput[],
    today: string,
): Promise<Buffer> {
    const [rows, org] = await Promise.all([
        prisma.complianceInstance.findMany({ where, select, orderBy, take: MAX_PDF_RECORDS }),
        prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    ]);

    // Names of the people who submitted and approved, which the item stores as ids
    const ids = new Set<string>();
    for (const r of rows) {
        if (r.submittedById) ids.add(r.submittedById);
        if (r.closedById) ids.add(r.closedById);
    }
    const users = ids.size
        ? await prisma.user.findMany({ where: { orgId, id: { in: [...ids] } }, select: { id: true, name: true } })
        : [];
    const people = new Map<string, string>(users.map((u) => [u.id, u.name]));

    const sheets = rows.map((r) => {
        const s = STATUS[dashboardStatus(r, today)];
        return { status: s.label, color: s.color, rows: sheetRows(r, people) };
    });
    return toDetailPdf(sheets, {
        heading: org?.name ?? 'Compliance records',
        footer: `Compliance Platform - printed ${day(new Date(`${today}T00:00:00.000Z`))}`,
    });
}