import { useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Input, Popconfirm, Segmented, Select, Skeleton, Space, Table, Tag, Timeline, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { useMe } from '../../../core/auth/useMe';
import { errorText } from '../../../shared/errors';
import { formatDate, titleCase } from '../../../core/format';
import { RISK_COLOR, useStates } from '../api';
import { EditInternalModal } from './InternalForm';
import type { Level } from '../api';
import { StatusFilter } from '../../../shared/StatusFilter';
import type { StatusFilterValue } from '../../../shared/StatusFilter';

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
    orgId: string | null; // set for the company's own internal compliances
    applicability: string | null;
    proofOfCompliance: string | null;
    alertOwnerDays: number | null;
    alertManagerDays: number | null;
    effectiveDate: string | null;
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
const PERIOD_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12 };

const TypeTag = ({ orgId }: { orgId: string | null }) =>
    orgId ? <Tag color="geekblue">Internal</Tag> : <Tag>Statutory</Tag>;

function dueRule(c: Pick<LibCompliance, 'frequency' | 'dueDay' | 'dueMonthOffset' | 'event' | 'dueDaysAfterEvent'>): string {
    if (c.frequency === 'EVENT_BASED') return `${c.dueDaysAfterEvent ?? '?'} days after: ${c.event ?? '?'}`;
    if (c.frequency === 'ONE_TIME') return c.dueDay ? `Day ${c.dueDay}` : 'On the start date';
    if (c.dueDay == null) return '';
    const months = (n: number) => `${n} month${n === 1 ? '' : 's'}`;
    const when =
        c.dueMonthOffset === 0
            ? 'in the last month of the period'
            : c.dueMonthOffset === 1 - (PERIOD_MONTHS[c.frequency] ?? 1)
                ? 'in the first month of the period'
                : c.dueMonthOffset < 0
                    ? `${months(-c.dueMonthOffset)} before the last month of the period`
                    : `${months(c.dueMonthOffset)} after the period`;
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
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const me = useMe();
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(false);
    const q = useQuery({
        queryKey: ['library', 'compliance', id],
        queryFn: ({ signal }) => api<ComplianceDetail>(`/library/compliances/${id}`, { signal }),
    });
    const c = q.data;

    // The shared library: only the platform administrator can switch a compliance on or off
    const toggle = async () => {
        if (!c) return;
        setBusy(true);
        try {
            await api(`/library/compliances/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } });
            notify.success(c.isActive ? 'Deactivated' : 'Activated');
            await qc.invalidateQueries({ queryKey: ['library'] });
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Drawer
            open
            width="min(640px, 100vw)"
            onClose={onClose}
            title={c ? c.title : 'Compliance'}
            extra={
                c?.orgId ? (
                    <Button type="primary" onClick={() => setEditing(true)}>
                        Modify
                    </Button>
                ) : c && me.data?.isPlatformAdmin ? (
                    <Popconfirm
                        title={c.isActive ? 'Deactivate this compliance?' : 'Activate this compliance?'}
                        description={
                            c.isActive
                                ? 'It can no longer be newly assigned, and no new items are generated for it. Items already created are not changed.'
                                : undefined
                        }
                        okText={c.isActive ? 'Deactivate' : 'Activate'}
                        okButtonProps={{ danger: c.isActive }}
                        onConfirm={() => void toggle()}
                    >
                        <Button danger={c.isActive} loading={busy}>
                            {c.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                    </Popconfirm>
                ) : null
            }
        >
            {holder}
            {editing && c && <EditInternalModal item={c} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
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
                            { key: 'type', label: 'Type', children: <TypeTag orgId={c.orgId} /> },
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
                            ...(c.orgId
                                ? [
                                    { key: 'proofOf', label: 'Proof of compliance', span: 2, children: c.proofOfCompliance ?? '-' },
                                    { key: 'appl', label: 'Applicability', span: 2, children: c.applicability ?? '-' },
                                    { key: 'aOwner', label: 'Owner alert days', children: c.alertOwnerDays ?? '-' },
                                    { key: 'aMgr', label: 'Manager alert days', children: c.alertManagerDays ?? '-' },
                                    { key: 'eff', label: 'Effective date', children: c.effectiveDate ? formatDate(c.effectiveDate) : '-' },
                                    { key: 'status', label: 'Status', children: c.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag> },
                                ]
                                : [
                                    { key: 'version', label: 'Version', children: c.version },
                                    { key: 'status', label: 'Status', children: c.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag> },
                                ]),
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
    const [status, setStatus] = useState<StatusFilterValue>('active');
    const [type, setType] = useState<string | undefined>();
    const [mapping, setMapping] = useState<'ALL' | 'MAPPED' | 'UNMAPPED'>('ALL');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [open, setOpen] = useState<string | null>(null);

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    if (lawCategoryId) params.set('lawCategoryId', lawCategoryId);
    if (state) params.set('state', state);
    if (frequency) params.set('frequency', frequency);
    if (risk) params.set('risk', risk);
    params.set('status', status);
    if (type) params.set('type', type);
    if (mapping !== 'ALL') params.set('mapping', mapping);
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
        { title: 'Type', key: 't', width: 100, render: (_, r) => <TypeTag orgId={r.orgId} /> },
        {
            title: 'Status',
            key: 's',
            width: 90,
            render: (_, r) => (r.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>),
        },
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Segmented
                value={mapping}
                options={[
                    { value: 'ALL', label: 'All' },
                    { value: 'MAPPED', label: 'Mapped' },
                    { value: 'UNMAPPED', label: 'Unmapped' },
                ]}
                onChange={(v) => {
                    setMapping(v as 'ALL' | 'MAPPED' | 'UNMAPPED');
                    reset();
                }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Mapped: scheduled at one or more of your locations. Unmapped: not scheduled anywhere yet.
            </Typography.Text>
            <Space wrap>
                <Select
                    allowClear
                    placeholder="Type"
                    style={{ width: 130 }}
                    options={[
                        { value: 'STATUTORY', label: 'Statutory' },
                        { value: 'INTERNAL', label: 'Internal' },
                    ]}
                    onChange={(v: string | undefined) => {
                        setType(v);
                        reset();
                    }}
                />
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
                <StatusFilter
                    value={status}
                    onChange={(v) => {
                        setStatus(v);
                        reset();
                    }}
                />
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