import { useState } from 'react';
import { Alert, Button, Input, Popconfirm, Segmented, Space, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { MessageInstance } from 'antd/es/message/interface';
import { api } from '../../../core/api/client';
import { errorText } from '../../../shared/errors';
import { useRefreshAfterLawDecision, useLawSummary } from './api';
import { ChangeTags } from './ChangesTable';
import type { WaitingItem, WaitingPage } from './types';

type Props = { notify: MessageInstance; onOpen: (id: string) => void };

export function WaitingTab({ notify, onOpen }: Props) {
    const refresh = useRefreshAfterLawDecision();
    const summary = useLawSummary();
    const [kind, setKind] = useState<'all' | 'decision' | 'info'>('all');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [busy, setBusy] = useState(false);

    const params = new URLSearchParams({ kind, page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['lawchanges', 'list', qs],
        queryFn: ({ signal }) => api<WaitingPage>(`/compliance/amendments?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const acknowledgeAll = async () => {
        setBusy(true);
        try {
            const r = await api<{ acknowledged: number; skipped: number; remaining: number }>(
                '/compliance/amendments/acknowledge-all',
                { method: 'POST' },
            );
            notify.success(
                `${r.acknowledged} acknowledged` +
                (r.skipped ? `, ${r.skipped} skipped` : '') +
                (r.remaining ? `. ${r.remaining} more remain, press the button again.` : '.'),
            );
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const informational = summary.data?.informational ?? 0;

    const columns: TableProps<WaitingItem>['columns'] = [
        {
            title: 'Law',
            key: 'law',
            width: 300,
            render: (_, r) => (
                <div>
                    <div>{r.title}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.code}
                    </Typography.Text>
                </div>
            ),
        },
        {
            title: 'Act',
            key: 'act',
            width: 230,
            render: (_, r) => (r.act.state ? `${r.act.name} (${r.act.state})` : r.act.name),
        },
        { title: 'What changed', key: 'changes', render: (_, r) => <ChangeTags changes={r.changes} /> },
        { title: 'Schedules', dataIndex: 'schedules', key: 'schedules', width: 100 },
        { title: 'Versions', key: 'v', width: 100, render: (_, r) => `v${r.fromVersion} to v${r.toVersion}` },
        {
            title: 'Needs',
            key: 'needs',
            width: 150,
            render: (_, r) =>
                r.needsDecision ? <Tag color="orange">A decision</Tag> : <Tag color="blue">Acknowledging</Tag>,
        },
        {
            title: '',
            key: 'x',
            width: 100,
            render: (_, r) => (
                <Button size="small" type="primary" onClick={() => onOpen(r.complianceId)}>
                    Review
                </Button>
            ),
        },
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap>
                <Segmented
                    value={kind}
                    onChange={(v) => {
                        setKind(v as typeof kind);
                        setPage(1);
                    }}
                    options={[
                        { label: 'All', value: 'all' },
                        { label: 'Need a decision', value: 'decision' },
                        { label: 'Information only', value: 'info' },
                    ]}
                />
                <Input.Search
                    allowClear
                    maxLength={100}
                    placeholder="Search by title, code or Act"
                    style={{ width: 280 }}
                    onSearch={(v) => {
                        setSearch(v.trim());
                        setPage(1);
                    }}
                />
                <Popconfirm
                    title="Acknowledge every information-only change?"
                    description="These changes do not affect due dates. Each one is recorded as acknowledged."
                    okText="Acknowledge all"
                    disabled={informational === 0}
                    onConfirm={() => void acknowledgeAll()}
                >
                    <Button loading={busy} disabled={informational === 0}>
                        Acknowledge all information-only changes
                    </Button>
                </Popconfirm>
            </Space>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The waiting changes could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<WaitingItem>
                rowKey="complianceId"
                size="middle"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                scroll={{ x: 1100 }}
                onRow={(r) => ({ onClick: () => onOpen(r.complianceId), style: { cursor: 'pointer' } })}
                locale={{ emptyText: 'Nothing is waiting. Every law you follow is up to date.' }}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (t) => `${t} laws`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />
        </Space>
    );
}