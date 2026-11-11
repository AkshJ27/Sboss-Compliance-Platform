import { useState } from 'react';
import { Alert, Button, Popconfirm, Segmented, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { formatDate, formatDateTime } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { LoadWarning } from '../LoadWarning';
import { useEntities } from '../api';

type TriggerRow = {
    id: string;
    event: string;
    eventDate: string;
    note: string | null;
    createdAt: string;
    cancelledAt: string | null;
    entity: { id: string; name: string; code: string };
    location: { id: string; name: string; state: string };
    createdBy: { id: string; name: string };
    _count: { instances: number };
};
type TriggerPage = { items: TriggerRow[]; total: number };

export function HistoryTab() {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const [status, setStatus] = useState<'active' | 'cancelled' | 'all'>('active');
    const [entityId, setEntityId] = useState<string | undefined>();
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const entities = useEntities(true);

    const params = new URLSearchParams({ status, page: String(page), limit: String(limit) });
    if (entityId) params.set('entityId', entityId);
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['events', 'triggers', qs],
        queryFn: ({ signal }) => api<TriggerPage>(`/compliance/events/triggers?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const cancel = async (row: TriggerRow) => {
        try {
            const res = await api<{ removed: number }>(`/compliance/events/triggers/${row.id}/cancel`, { method: 'POST' });
            notify.success(`Cancelled. ${res.removed} item${res.removed === 1 ? '' : 's'} removed.`);
            await Promise.all(
                ['events', 'records', 'dashboard', 'facets', 'documents'].map((key) => qc.invalidateQueries({ queryKey: [key] })),
            );
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<TriggerRow>['columns'] = [
        { title: 'Recorded', key: 'created', width: 150, render: (_, r) => formatDateTime(r.createdAt) },
        {
            title: 'Event',
            key: 'event',
            render: (_, r) => (
                <div>
                    <div>{r.event}</div>
                    {r.note && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {r.note}
                        </Typography.Text>
                    )}
                </div>
            ),
        },
        { title: 'Event date', key: 'date', width: 120, render: (_, r) => formatDate(r.eventDate) },
        { title: 'Location', key: 'loc', width: 220, render: (_, r) => `${r.entity.code} / ${r.location.name}` },
        { title: 'Items', key: 'items', width: 80, render: (_, r) => r._count.instances },
        { title: 'Recorded by', key: 'by', width: 150, render: (_, r) => r.createdBy.name },
        {
            title: 'Status',
            key: 'status',
            width: 110,
            render: (_, r) =>
                r.cancelledAt ? <Tag>Cancelled</Tag> : <Tag color="green">Active</Tag>,
        },
        {
            title: '',
            key: 'actions',
            width: 120,
            render: (_, r) =>
                r.cancelledAt ? null : (
                    <Popconfirm
                        title="Cancel this event?"
                        description="The items it created are removed, but only if nobody has started on them."
                        okText="Cancel the event"
                        okButtonProps={{ danger: true }}
                        cancelText="Keep it"
                        onConfirm={() => void cancel(r)}
                    >
                        <Button size="small" danger>
                            Cancel
                        </Button>
                    </Popconfirm>
                ),
        },
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {holder}
            <LoadWarning label="The entity list" error={entities.isError} onRetry={() => void entities.refetch()} />

            <Space wrap>
                <Segmented
                    value={status}
                    onChange={(v) => {
                        setStatus(v as typeof status);
                        setPage(1);
                    }}
                    options={[
                        { label: 'Active', value: 'active' },
                        { label: 'Cancelled', value: 'cancelled' },
                        { label: 'All', value: 'all' },
                    ]}
                />
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="All entities"
                    style={{ width: 240 }}
                    options={(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))}
                    onChange={(v: string | undefined) => {
                        setEntityId(v);
                        setPage(1);
                    }}
                />
            </Space>

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

            <Table<TriggerRow>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                scroll={{ x: 1000 }}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (t) => `${t} events`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />
        </Space>
    );
}