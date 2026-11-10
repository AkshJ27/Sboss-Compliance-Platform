import { useState } from 'react';
import { Alert, Button, DatePicker, Select, Space, Table, Typography } from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { LoadWarning } from '../LoadWarning';
import { useUsers } from '../api';

type AuditRow = {
    id: string;
    createdAt: string;
    action: string;
    entityType: string;
    entityId: string;
    meta: unknown;
    user: { id: string; name: string | null } | null;
};
type AuditPageData = { items: AuditRow[]; total: number };
type Facets = { actions: string[]; entityTypes: string[] };

const PAGE_SIZES = [25, 50, 100];

export default function AuditPage() {
    const [userId, setUserId] = useState<string | undefined>();
    const [action, setAction] = useState<string | undefined>();
    const [entityType, setEntityType] = useState<string | undefined>();
    const [range, setRange] = useState<[string, string] | null>(null);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(50);

    const users = useUsers();
    const facets = useQuery({
        queryKey: ['audit', 'facets'],
        queryFn: ({ signal }) => api<Facets>('/audit/facets', { signal }),
        staleTime: 60_000,
    });

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (userId) params.set('userId', userId);
    if (action) params.set('action', action);
    if (entityType) params.set('entityType', entityType);
    if (range) {
        params.set('from', range[0]);
        params.set('to', range[1]);
    }
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['audit', 'list', qs],
        queryFn: ({ signal }) => api<AuditPageData>(`/audit?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const reset = () => setPage(1);

    const columns: TableProps<AuditRow>['columns'] = [
        {
            title: 'When',
            key: 'when',
            width: 190,
            render: (_, r) => dayjs(r.createdAt).format('DD MMM YYYY, HH:mm:ss'),
        },
        { title: 'Who', key: 'who', width: 180, render: (_, r) => r.user?.name ?? (r.user ? 'Unknown' : 'System') },
        { title: 'Action', dataIndex: 'action', key: 'action', width: 260 },
        { title: 'Record type', dataIndex: 'entityType', key: 'type', width: 180 },
        {
            title: 'Record',
            key: 'id',
            width: 120,
            render: (_, r) => <Typography.Text type="secondary">{r.entityId.slice(0, 8)}</Typography.Text>,
        },
    ];

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
                Audit log
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Who did what, and when. Open a row to see the details. Dates are in India time.
            </Typography.Paragraph>

            <LoadWarning label="The filter choices" error={facets.isError} onRetry={() => void facets.refetch()} />
            <LoadWarning label="The people list" error={users.isError} onRetry={() => void users.refetch()} />

            <Space wrap>
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Anyone"
                    style={{ width: 200 }}
                    options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
                    onChange={(v: string | undefined) => {
                        setUserId(v);
                        reset();
                    }}
                />
                <Select
                    allowClear
                    showSearch
                    placeholder="Any action"
                    style={{ width: 260 }}
                    options={(facets.data?.actions ?? []).map((a) => ({ value: a, label: a }))}
                    onChange={(v: string | undefined) => {
                        setAction(v);
                        reset();
                    }}
                />
                <Select
                    allowClear
                    showSearch
                    placeholder="Any record type"
                    style={{ width: 200 }}
                    options={(facets.data?.entityTypes ?? []).map((a) => ({ value: a, label: a }))}
                    onChange={(v: string | undefined) => {
                        setEntityType(v);
                        reset();
                    }}
                />
                <DatePicker.RangePicker
                    onChange={(v) => {
                        setRange(v?.[0] && v[1] ? [v[0].format('YYYY-MM-DD'), v[1].format('YYYY-MM-DD')] : null);
                        reset();
                    }}
                />
            </Space>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The audit log could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<AuditRow>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                scroll={{ x: 930 }}
                expandable={{
                    rowExpandable: (r) => r.meta !== null && r.meta !== undefined,
                    expandedRowRender: (r) => (
                        <pre style={{ margin: 0, maxHeight: 260, overflow: 'auto', fontSize: 12 }}>
                            {JSON.stringify(r.meta, null, 2)}
                        </pre>
                    ),
                }}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    pageSizeOptions: PAGE_SIZES,
                    showTotal: (t) => `${t} entries`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />
        </Space>
    );
}