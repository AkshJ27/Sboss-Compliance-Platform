import { Alert, Badge, Button, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableProps } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import { STATUS_META } from '../../core/filters';
import { formatDate, formatDateTime, titleCase } from '../../core/format';
import { useScheduleHistory } from './api';
import type { PeriodRow } from './api';

type Props = { id: string; onNavigate: (id: string) => void };

const ROLE = { owner: 'Owner', manager: 'Manager', approver: 'Approver' } as const;

// Every period of this compliance at this location, like Complinity's schedule history.
// Clicking another period opens it.
export function ScheduleHistory({ id, onNavigate }: Props) {
    const q = useScheduleHistory(id);

    if (q.isError) {
        return (
            <Alert
                type="error"
                showIcon
                message="The periods could not be loaded"
                description={q.error.message}
                action={
                    <Button size="small" onClick={() => void q.refetch()}>
                        Retry
                    </Button>
                }
            />
        );
    }

    const columns: TableProps<PeriodRow>['columns'] = [
        { title: 'No.', key: 'n', width: 50, render: (_, __, i) => i + 1 },
        {
            title: 'Status',
            key: 's',
            width: 150,
            render: (_, r) => (
                <span>
                    <Badge color={STATUS_META[r.dashboardStatus].color} text={STATUS_META[r.dashboardStatus].label} />
                    {r.isCurrent && (
                        <Tag color="blue" style={{ marginLeft: 6 }}>
                            This one
                        </Tag>
                    )}
                </span>
            ),
        },
        { title: 'Due date', key: 'due', width: 110, render: (_, r) => formatDate(r.dueDate) },
        {
            title: 'Period',
            key: 'p',
            width: 190,
            render: (_, r) =>
                r.frequency === 'EVENT_BASED' ? `Event on ${formatDate(r.periodStart)}` : `${formatDate(r.periodStart)} to ${formatDate(r.periodEnd)}`,
        },
        { title: 'Entered', key: 'e', width: 130, render: (_, r) => (r.enteredAt ? formatDateTime(r.enteredAt) : '') },
        { title: 'Done date', key: 'd', width: 110, render: (_, r) => formatDate(r.doneDate) },
        { title: 'Submitted by', key: 'sb', width: 140, render: (_, r) => r.submittedBy ?? '' },
        {
            title: 'Pending at',
            key: 'pa',
            width: 160,
            render: (_, r) => (r.pendingAt ? `${r.pendingAt.name} (${ROLE[r.pendingAt.role]})` : ''),
        },
        { title: 'Approved by', key: 'ab', width: 140, render: (_, r) => r.approvedBy ?? '' },
        {
            title: 'Remarks',
            key: 'r',
            width: 200,
            ellipsis: { showTitle: false },
            render: (_, r) =>
                r.remarks ? (
                    <Tooltip title={r.remarks}>
                        <span>{r.remarks}</span>
                    </Tooltip>
                ) : (
                    ''
                ),
        },
        {
            title: 'Files',
            key: 'f',
            width: 70,
            render: (_, r) =>
                r.documents ? (
                    <span>
                        <PaperClipOutlined /> {r.documents}
                    </span>
                ) : (
                    ''
                ),
        },
    ];

    return (
        <div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                {q.data
                    ? `${q.data.total} period(s) of this compliance at this location${q.data.shown < q.data.total ? `, showing the latest ${q.data.shown}` : ''}. Click a row to open it.`
                    : ' '}
                {q.data && q.data.items[0] && ` Periodicity: ${titleCase(q.data.items[0].frequency)}.`}
            </Typography.Paragraph>
            <Table<PeriodRow>
                size="small"
                rowKey="id"
                loading={q.isLoading}
                columns={columns}
                dataSource={q.data?.items ?? []}
                scroll={{ x: 1450 }}
                pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
                rowClassName={(r) => (r.isCurrent ? 'ant-table-row-selected' : '')}
                onRow={(r) => ({
                    onClick: () => {
                        if (!r.isCurrent) onNavigate(r.id);
                    },
                    style: { cursor: r.isCurrent ? 'default' : 'pointer' },
                })}
            />
        </div>
    );
}