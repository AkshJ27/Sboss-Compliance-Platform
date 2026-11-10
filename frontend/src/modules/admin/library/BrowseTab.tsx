import { useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Input, Segmented, Select, Skeleton, Space, Switch, Table, Tag, Timeline, Typography } from 'antd';
import type { TableProps } from 'antd';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { formatDate, titleCase } from '../../../core/format';
import { RISK_COLOR, useStates } from '../api';
import type { Level } from '../api';

type Named = { id: string; name: string };
type Lookups = { lawCategories: Named[] };

type LibCompliance = {
    id: string;
    code: string;
    title: string;
    description: string | null;
    form: string | null;
    reference: string | null;
    penalty: string | null;
    risk: Level;
    impact: Level;
    frequency: string;
    periodBasis: string;
    dueDay: number | null;
    dueMonthOffset: number;
    event: string | null;
    dueDaysAfterEvent: number | null;
    attachment: string;
    isActive: boolean;
    version: number;
    act: { id: string; name: string; state: string | null; jurisdiction: string; lawCategory: Named };
    nature: Named | null;
    type: Named | null;
};
type Revision = { id: string; version: number; changes: unknown; createdAt: string };
type ComplianceDetail = LibCompliance & { revisions: Revision[] };
type CompliancePage = { items: LibCompliance[]; total: number };

type LibAct = {
    id: string;
    name: string;
    jurisdiction: string;
    state: string | null;
    isActive: boolean;
    lawCategory: Named;
    _count: { compliances: number; rules: number };
};
type ActPage = { items: LibAct[]; total: number };

const FREQUENCIES = ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'EVENT_BASED'];

function dueRule(c: Pick<LibCompliance, 'frequency' | 'dueDay' | 'dueMonthOffset' | 'event' | 'dueDaysAfterEvent'>): string {
    if (c.frequency === 'EVENT_BASED') return `${c.dueDaysAfterEvent ?? '?'} days after: ${c.event ?? '?'}`;
    if (c.frequency === 'ONE_TIME') return c.dueDay ? `Day ${c.dueDay}` : 'On the start date';
    if (c.dueDay == null) return '';
    const when =
        c.dueMonthOffset === 0
            ? 'in the last month of the period'
            : `${c.dueMonthOffset} month${c.dueMonthOffset === 1 ? '' : 's'} after the period`;
    return `Day ${c.dueDay}, ${when}`;
}

const show = (x: unknown) => (x === null || x === undefined ? 'empty' : String(x));

function describeChanges(changes: unknown): string {
    if (!changes || typeof changes !== 'object') return '';
    const c = changes as Record<string, unknown>;
    if (c.created === true) return 'Created';
    return Object.entries(c)
        .map(([field, v]) => {
            const o = (v ?? {}) as { from?: unknown; to?: unknown };
            return `${field}: ${show(o.from)} to ${show(o.to)}`;
        })
        .join('; ');
}

function ComplianceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
    const q = useQuery({
        queryKey: ['library', 'compliance', id],
        queryFn: ({ signal }) => api<ComplianceDetail>(`/library/compliances/${id}`, { signal }),
    });
    const c = q.data;

    return (
        <Drawer open width="min(640px, 100vw)" onClose={onClose} title={c ? c.title : 'Compliance'}>
            {q.isError && !c && (
                <Alert
                    type="error"
                    showIcon
                    message="This item could not be opened"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}
            {!c && !q.isError && <Skeleton active />}
            {c && (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    {c.description && <Typography.Paragraph type="secondary">{c.description}</Typography.Paragraph>}
                    <Descriptions
                        size="small"
                        bordered
                        column={2}
                        items={[
                            { key: 'code', label: 'Code', children: c.code },
                            { key: 'version', label: 'Version', children: c.version },
                            { key: 'act', label: 'Act', span: 2, children: c.act.state ? `${c.act.name} (${c.act.state})` : c.act.name },
                            { key: 'cat', label: 'Law category', children: c.act.lawCategory.name },
                            { key: 'form', label: 'Form', children: c.form ?? '-' },
                            { key: 'freq', label: 'Periodicity', children: titleCase(c.frequency) },
                            { key: 'basis', label: 'Period basis', children: titleCase(c.periodBasis) },
                            { key: 'due', label: 'Due', span: 2, children: dueRule(c) || '-' },
                            { key: 'risk', label: 'Risk', children: <Tag color={RISK_COLOR[c.risk]}>{titleCase(c.risk)}</Tag> },
                            { key: 'impact', label: 'Impact', children: <Tag color={RISK_COLOR[c.impact]}>{titleCase(c.impact)}</Tag> },
                            { key: 'proof', label: 'Proof', children: titleCase(c.attachment) },
                            { key: 'ref', label: 'Reference', children: c.reference ?? '-' },
                            { key: 'penalty', label: 'Penalty', span: 2, children: c.penalty ?? '-' },
                        ]}
                    />
                    <div>
                        <Typography.Text strong>History</Typography.Text>
                        <Timeline
                            style={{ marginTop: 12 }}
                            items={c.revisions.map((rev) => ({
                                children: (
                                    <div>
                                        <div>
                                            Version {rev.version}: {describeChanges(rev.changes)}
                                        </div>
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                            {formatDate(rev.createdAt)}
                                        </Typography.Text>
                                    </div>
                                ),
                            }))}
                        />
                    </div>
                </Space>
            )}
        </Drawer>
    );
}

function CompliancesView() {
    const lookups = useQuery({
        queryKey: ['library', 'lookups'],
        queryFn: ({ signal }) => api<Lookups>('/library/lookups', { signal }),
        staleTime: 5 * 60_000,
    });
    const states = useStates();

    const [search, setSearch] = useState('');
    const [lawCategoryId, setLawCategoryId] = useState<string | undefined>();
    const [state, setState] = useState<string | undefined>();
    const [frequency, setFrequency] = useState<string | undefined>();
    const [risk, setRisk] = useState<string | undefined>();
    const [showInactive, setShowInactive] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [open, setOpen] = useState<string | null>(null);

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    if (lawCategoryId) params.set('lawCategoryId', lawCategoryId);
    if (state) params.set('state', state);
    if (frequency) params.set('frequency', frequency);
    if (risk) params.set('risk', risk);
    if (showInactive) params.set('includeInactive', 'true');
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['library', 'compliances', qs],
        queryFn: ({ signal }) => api<CompliancePage>(`/library/compliances?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const reset = () => setPage(1);

    const columns: TableProps<LibCompliance>['columns'] = [
        {
            title: 'Compliance',
            key: 'c',
            width: 340,
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
            width: 260,
            render: (_, r) => (r.act.state ? `${r.act.name} (${r.act.state})` : r.act.name),
        },
        { title: 'Periodicity', key: 'f', width: 120, render: (_, r) => titleCase(r.frequency) },
        { title: 'Due', key: 'd', width: 260, render: (_, r) => dueRule(r) },
        {
            title: 'Risk',
            key: 'risk',
            width: 90,
            render: (_, r) => <Tag color={RISK_COLOR[r.risk]}>{titleCase(r.risk)}</Tag>,
        },
        { title: 'Version', dataIndex: 'version', key: 'v', width: 80 },
        {
            title: 'Status',
            key: 's',
            width: 90,
            render: (_, r) => (r.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>),
        },
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap>
                <Input.Search
                    allowClear
                    maxLength={100}
                    placeholder="Search by title, code or Act"
                    style={{ width: 260 }}
                    onSearch={(v) => {
                        setSearch(v.trim());
                        reset();
                    }}
                />
                <Select
                    allowClear
                    placeholder="Law category"
                    style={{ width: 190 }}
                    options={(lookups.data?.lawCategories ?? []).map((c) => ({ value: c.id, label: c.name }))}
                    onChange={(v: string | undefined) => {
                        setLawCategoryId(v);
                        reset();
                    }}
                />
                <Select
                    allowClear
                    showSearch
                    placeholder="State"
                    style={{ width: 180 }}
                    options={(states.data ?? []).map((s) => ({ value: s, label: s }))}
                    onChange={(v: string | undefined) => {
                        setState(v);
                        reset();
                    }}
                />
                <Select
                    allowClear
                    placeholder="Periodicity"
                    style={{ width: 150 }}
                    options={FREQUENCIES.map((f) => ({ value: f, label: titleCase(f) }))}
                    onChange={(v: string | undefined) => {
                        setFrequency(v);
                        reset();
                    }}
                />
                <Select
                    allowClear
                    placeholder="Risk"
                    style={{ width: 120 }}
                    options={(['HIGH', 'MEDIUM', 'LOW'] as const).map((l) => ({ value: l, label: titleCase(l) }))}
                    onChange={(v: string | undefined) => {
                        setRisk(v);
                        reset();
                    }}
                />
                <span>
                    <Switch
                        size="small"
                        checked={showInactive}
                        onChange={(v) => {
                            setShowInactive(v);
                            reset();
                        }}
                    />{' '}
                    <Typography.Text type="secondary">Show inactive</Typography.Text>
                </span>
            </Space>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The compliances could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<LibCompliance>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                scroll={{ x: 1250 }}
                onRow={(r) => ({ onClick: () => setOpen(r.id), style: { cursor: 'pointer' } })}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (t) => `${t} compliances`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />

            {open && <ComplianceDrawer id={open} onClose={() => setOpen(null)} />}
        </Space>
    );
}

function ActsView() {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['library', 'acts', qs],
        queryFn: ({ signal }) => api<ActPage>(`/library/acts?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const columns: TableProps<LibAct>['columns'] = [
        { title: 'Act', dataIndex: 'name', key: 'name' },
        {
            title: 'Applies to',
            key: 'j',
            width: 200,
            render: (_, r) => (r.jurisdiction === 'STATE' ? <Tag color="purple">{r.state}</Tag> : <Tag color="blue">Central</Tag>),
        },
        { title: 'Law category', key: 'cat', width: 180, render: (_, r) => r.lawCategory.name },
        { title: 'Compliances', key: 'cc', width: 120, render: (_, r) => r._count.compliances },
        { title: 'Rules', key: 'rc', width: 90, render: (_, r) => r._count.rules },
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Input.Search
                allowClear
                maxLength={100}
                placeholder="Search Acts"
                style={{ width: 280 }}
                onSearch={(v) => {
                    setSearch(v.trim());
                    setPage(1);
                }}
            />
            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The Acts could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}
            <Table<LibAct>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (t) => `${t} Acts`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />
        </Space>
    );
}

export function BrowseTab() {
    const [view, setView] = useState<'compliances' | 'acts'>('compliances');
    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Segmented
                value={view}
                onChange={(v) => setView(v as typeof view)}
                options={[
                    { label: 'Compliances', value: 'compliances' },
                    { label: 'Acts', value: 'acts' },
                ]}
            />
            {view === 'compliances' ? <CompliancesView /> : <ActsView />}
        </Space>
    );
}