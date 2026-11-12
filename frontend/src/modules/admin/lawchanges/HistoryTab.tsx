import { useState } from 'react';
import { Alert, Button, Segmented, Space, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { formatDateTime } from '../../../core/format';
import { ChangesTable, ChangeTags } from './ChangesTable';
import type { HistoryItem, HistoryPage } from './types';

const DECISION_TAG = {
    APPLIED: { color: 'green', label: 'Applied' },
    KEPT: { color: 'gold', label: 'Kept my rule' },
    ACKNOWLEDGED: { color: 'default', label: 'Acknowledged' },
} as const;

export function HistoryTab() {
    const [decision, setDecision] = useState<'ALL' | HistoryItem['decision']>('ALL');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (decision !== 'ALL') params.set('decision', decision);
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['lawchanges', 'history', qs],
        queryFn: ({ signal }) => api<HistoryPage>(`/compliance/amendments/history?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const columns: TableProps<HistoryItem>['columns'] = [
        { title: 'When', key: 'when', width: 150, render: (_, r) => formatDateTime(r.createdAt) },
        {
            title: 'Law',
            key: 'law',
            width: 280,
            render: (_, r) => (
                <div>
                    <div>{r.compliance.title}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.compliance.code}
                    </Typography.Text>
                </div>
            ),
        },
        {
            title: 'Decision',
            key: 'decision',
            width: 140,
            render: (_, r) => <Tag color={DECISION_TAG[r.decision].color}>{DECISION_TAG[r.decision].label}</Tag>,
        },
        { title: 'What changed', key: 'changes', render: (_, r) => <ChangeTags changes={r.changes} /> },
        { title: 'Versions', key: 'v', width: 100, render: (_, r) => `v${r.fromVersion} to v${r.toVersion}` },
        { title: 'Schedules', dataIndex: 'schedulesUpdated', key: 'schedules', width: 100 },
        { title: 'Items moved', dataIndex: 'itemsMoved', key: 'moved', width: 110 },
        { title: 'Decided by', key: 'by', width: 150, render: (_, r) => r.decidedBy.name },
        {
            title: 'Note',
            key: 'note',
            width: 220,
            render: (_, r) =>
                r.note ? <Typography.Paragraph ellipsis={{ rows: 2, tooltip: r.note }} style={{ margin: 0 }}>{r.note}</Typography.Paragraph> : '',
        },
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Segmented
                value={decision}
                onChange={(v) => {
                    setDecision(v as typeof decision);
                    setPage(1);
                }}
                options={[
                    { label: 'All', value: 'ALL' },
                    { label: 'Applied', value: 'APPLIED' },
                    { label: 'Kept my rule', value: 'KEPT' },
                    { label: 'Acknowledged', value: 'ACKNOWLEDGED' },
                ]}
            />

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The history could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<HistoryItem>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                scroll={{ x: 1350 }}
                expandable={{ expandedRowRender: (r) => <ChangesTable changes={r.changes} /> }}
                locale={{ emptyText: 'No decisions yet.' }}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (t) => `${t} decisions`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />
        </Space>
    );
}