import { Card, Descriptions, Tag, Typography } from 'antd';
import { formatDate, formatMoney, titleCase } from '../../core/format';
import { RISK_COLOR } from './capabilities';
import type { RecordDetail } from './types';

export function RecordDetails({ r }: { r: RecordDetail }) {
    const c = r.compliance;
    return (
        <div>
            {c.description && (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                    {c.description}
                </Typography.Paragraph>
            )}
            <Descriptions
                size="small"
                bordered
                column={2}
                items={[
                    { key: 'act', label: 'Act', span: 2, children: c.act.state ? `${c.act.name} (${c.act.state})` : c.act.name },
                    { key: 'cat', label: 'Law category', children: c.act.lawCategory.name },
                    { key: 'freq', label: 'Periodicity', children: titleCase(c.frequency) },
                    { key: 'entity', label: 'Entity', children: r.entity.name },
                    { key: 'loc', label: 'Location', children: `${r.location.name}, ${r.location.state}` },
                    { key: 'dept', label: 'Department', children: r.department?.name ?? '-' },
                    { key: 'vert', label: 'Vertical', children: r.vertical?.name ?? '-' },
                    { key: 'period', label: 'Period', span: 2, children: `${formatDate(r.periodStart)} to ${formatDate(r.periodEnd)}` },
                    { key: 'due', label: 'Due date', children: formatDate(r.dueDate) },
                    { key: 'form', label: 'Form', children: c.form ?? '-' },
                    { key: 'risk', label: 'Risk', children: <Tag color={RISK_COLOR[c.risk]}>{titleCase(c.risk)}</Tag> },
                    { key: 'impact', label: 'Impact', children: <Tag color={RISK_COLOR[c.impact]}>{titleCase(c.impact)}</Tag> },
                    { key: 'ref', label: 'Reference', children: c.reference ?? '-' },
                    { key: 'attach', label: 'Proof', children: titleCase(c.attachment) },
                    { key: 'penalty', label: 'Penalty', span: 2, children: c.penalty ?? '-' },
                    { key: 'prison', label: 'Imprisonment possible', children: c.imprisonment ? 'Yes' : 'No' },
                    { key: 'owner', label: 'Owner', children: r.owner.name },
                    { key: 'manager', label: 'Manager', children: r.manager.name },
                    { key: 'approver', label: 'Approver', children: r.approver?.name ?? '-' },
                ]}
            />
        </div>
    );
}

export function SubmissionSummary({ r }: { r: RecordDetail }) {
    if (!r.submissionType && !r.doneDate) {
        return <Typography.Text type="secondary">Nothing has been submitted yet.</Typography.Text>;
    }
    const notApplicable = r.submissionType === 'NOT_APPLICABLE';

    const items = [
        { key: 'type', label: 'Submission type', children: r.submissionType ? titleCase(r.submissionType) : '-' },
        { key: 'done', label: 'Done date', children: r.doneDate ? formatDate(r.doneDate) : '-' },
        ...(notApplicable
            ? []
            : [
                { key: 'ref', label: 'Reference no', children: r.refNo ?? '-' },
                { key: 'challan', label: 'Challan no', children: r.challanNo ?? '-' },
                { key: 'payable', label: 'Payable amount', children: formatMoney(r.payableAmount) || '-' },
                { key: 'paid', label: 'Amount paid', children: formatMoney(r.amountPaid) || '-' },
                { key: 'penalty', label: 'Penalty / interest paid', children: formatMoney(r.penaltyPaid) || '-' },
                { key: 'prison', label: 'Actual imprisonment', children: r.actualImprisonment ? 'Yes' : 'No' },
            ]),
        { key: 'remarks', label: 'Remarks', span: 2, children: r.remarks ?? '-' },
    ];

    return (
        <Card size="small" title={r.isWip ? 'Saved draft (not submitted)' : 'Submission'}>
            <Descriptions size="small" column={2} items={items} />
        </Card>
    );
}