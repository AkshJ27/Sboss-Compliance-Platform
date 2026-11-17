import { useState } from 'react';
import { Alert, Breadcrumb, Button, Card, Col, Collapse, Input, Popconfirm, Row, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../core/api/client';
import { useAuth } from '../../core/auth/AuthContext';
import { errorText } from '../../shared/errors';
import { useStates, useUsers } from '../admin/api';

type ActRow = {
    id: string;
    name: string;
    jurisdiction: 'CENTRAL' | 'STATE';
    state: string | null;
    lawCategory: { id: string; name: string };
    display: boolean;
    emailAlerts: boolean;
    updates: number;
};
type ActPage = { items: ActRow[]; total: number; mappedCount: number; userId: string };
type Filters = { region?: string; lawCategoryId?: string; mapped?: 'yes' | 'no'; userId?: string };

// Which Acts' legal updates show under "Mapped", and which also send an email
export default function ConfigureLegalPage() {
    const qc = useQueryClient();
    const { user } = useAuth();
    const isAdmin = user?.role === 'ORG_ADMIN';
    const [notify, holder] = message.useMessage();
    const [filters, setFilters] = useState<Filters>({});
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(50);
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);

    const states = useStates();
    const users = useUsers();
    const lookups = useQuery({
        queryKey: ['library', 'lookups'],
        queryFn: ({ signal }) => api<{ lawCategories: { id: string; name: string }[] }>('/library/lookups', { signal }),
        staleTime: 5 * 60_000,
    });

    const set = (patch: Partial<Filters>) => {
        setFilters((f) => ({ ...f, ...patch }));
        setPage(1);
        setSelected([]);
    };

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    for (const k of ['region', 'lawCategoryId', 'mapped', 'userId'] as const) {
        const v = filters[k];
        if (v) params.set(k, v);
    }
    if (search) params.set('search', search);
    const qs = params.toString();
    const q = useQuery({
        queryKey: ['legal', 'acts', qs],
        queryFn: ({ signal }) => api<ActPage>(`/legal-updates/acts?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });
    const refresh = () => qc.invalidateQueries({ queryKey: ['legal'] });
    const forUser = filters.userId ? { userId: filters.userId } : {};
    const whose = filters.userId ? (users.data ?? []).find((u) => u.id === filters.userId)?.name ?? 'this user' : 'you';

    const setOne = async (r: ActRow, display: boolean, emailAlerts: boolean) => {
        try {
            await api('/legal-updates/subscriptions', { method: 'PUT', body: { ...forUser, actId: r.id, display, emailAlerts } });
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const bulk = async (body: Record<string, unknown>, done: (n: number) => string) => {
        setBusy(true);
        try {
            const out = await api<{ acts: number }>('/legal-updates/subscriptions/bulk', { method: 'POST', body: { ...forUser, ...body } });
            notify.success(done(out.acts));
            setSelected([]);
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };
    const matching = { region: filters.region, lawCategoryId: filters.lawCategoryId, ...(search ? { search } : {}) };

    const columns: TableProps<ActRow>['columns'] = [
        { title: 'Act Name', dataIndex: 'name', key: 'n' },
        { title: 'Law Category Name', key: 'c', width: 240, render: (_, r) => r.lawCategory.name },
        { title: 'Central/State', key: 's', width: 150, render: (_, r) => r.state ?? 'Central' },
        { title: 'Updates', dataIndex: 'updates', key: 'u', width: 90 },
        {
            title: 'Select for Display',
            key: 'd',
            width: 150,
            align: 'center',
            render: (_, r) => <Switch checked={r.display} onChange={(v) => void setOne(r, v, v && r.emailAlerts)} />,
        },
        {
            title: 'Email Alerts',
            key: 'e',
            width: 120,
            align: 'center',
            render: (_, r) => <Switch checked={r.emailAlerts} onChange={(v) => void setOne(r, r.display || v, v)} />,
        },
    ];

    const userOptions = (users.data ?? []).filter((u) => u.isActive).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }));

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {holder}
            <Breadcrumb items={[{ title: <Link to="/legal-updates">Legal Update</Link> }, { title: 'Configure Legal Update' }]} />
            <Alert
                type="info"
                showIcon
                message={`Choose the Acts whose legal updates show for ${whose} under "Mapped"`}
                description={
                    <>
                        Switch on <b>Select for Display</b> for one Act, or tick several and use the buttons below. <b>Email Alerts</b> also sends an email when a new update is published.
                        {isAdmin && ' As an admin, you can choose another user in the filters and set their Acts.'}
                    </>
                }
            />

            <Collapse
                defaultActiveKey={['f']}
                items={[
                    {
                        key: 'f',
                        label: 'Filters',
                        extra: (
                            <Button
                                size="small"
                                icon={<ReloadOutlined />}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setFilters({});
                                    setSelected([]);
                                }}
                            />
                        ),
                        children: (
                            <Row gutter={[12, 8]}>
                                <Col xs={24} sm={12} lg={6}>
                                    <Typography.Text strong>Central/State</Typography.Text>
                                    <Select
                                        allowClear
                                        showSearch
                                        placeholder="Select"
                                        style={{ width: '100%' }}
                                        value={filters.region}
                                        options={[{ value: 'CENTRAL', label: 'Central' }, ...(states.data ?? []).map((s) => ({ value: s, label: s }))]}
                                        onChange={(v) => set({ region: v })}
                                    />
                                </Col>
                                <Col xs={24} sm={12} lg={6}>
                                    <Typography.Text strong>Law Category</Typography.Text>
                                    <Select
                                        allowClear
                                        showSearch
                                        optionFilterProp="label"
                                        placeholder="Select"
                                        style={{ width: '100%' }}
                                        value={filters.lawCategoryId}
                                        options={(lookups.data?.lawCategories ?? []).map((c) => ({ value: c.id, label: c.name }))}
                                        onChange={(v) => set({ lawCategoryId: v })}
                                    />
                                </Col>
                                <Col xs={24} sm={12} lg={6}>
                                    <Typography.Text strong>Show</Typography.Text>
                                    <Select
                                        allowClear
                                        placeholder="All Acts"
                                        style={{ width: '100%' }}
                                        value={filters.mapped}
                                        options={[
                                            { value: 'yes', label: 'Selected for display' },
                                            { value: 'no', label: 'Not selected' },
                                        ]}
                                        onChange={(v) => set({ mapped: v })}
                                    />
                                </Col>
                                {isAdmin && (
                                    <Col xs={24} sm={12} lg={6}>
                                        <Typography.Text strong>User</Typography.Text>
                                        <Select
                                            allowClear
                                            showSearch
                                            optionFilterProp="label"
                                            placeholder="Me"
                                            style={{ width: '100%' }}
                                            value={filters.userId}
                                            options={userOptions}
                                            onChange={(v) => set({ userId: v })}
                                        />
                                    </Col>
                                )}
                            </Row>
                        ),
                    },
                ]}
            />

            <Card size="small">
                <Space direction="vertical" style={{ width: '100%' }}>
                    <Row gutter={8} align="middle" justify="space-between">
                        <Col xs={24} lg={10}>
                            <Input.Search
                                allowClear
                                maxLength={100}
                                placeholder="Search in LU Configuration"
                                onSearch={(v) => {
                                    setSearch(v.trim());
                                    setPage(1);
                                    setSelected([]);
                                }}
                            />
                        </Col>
                        <Col>
                            <Tag color="blue">{q.data?.mappedCount ?? 0} Act(s) selected for display</Tag>
                        </Col>
                    </Row>

                    <Space wrap>
                        <Button type="primary" disabled={!selected.length} loading={busy} onClick={() => void bulk({ actIds: selected, display: true }, (n) => `${n} Act(s) selected for display`)}>
                            Select {selected.length || ''} for display
                        </Button>
                        <Button disabled={!selected.length} loading={busy} onClick={() => void bulk({ actIds: selected, display: true, emailAlerts: true }, (n) => `Email alerts on for ${n} Act(s)`)}>
                            Display + email alerts
                        </Button>
                        <Button danger disabled={!selected.length} loading={busy} onClick={() => void bulk({ actIds: selected, display: false }, (n) => `${n} Act(s) removed`)}>
                            Remove selected
                        </Button>
                        <Popconfirm
                            title={`Select all ${q.data?.total ?? 0} Acts matching the filters for display?`}
                            okText="Select all"
                            onConfirm={() => void bulk({ allMatching: matching, display: true }, (n) => `${n} Act(s) selected for display`)}
                        >
                            <Button loading={busy} disabled={!q.data?.total}>
                                Select all {q.data?.total ?? 0} matching
                            </Button>
                        </Popconfirm>
                        <Popconfirm
                            title={`Remove all ${q.data?.total ?? 0} Acts matching the filters?`}
                            okText="Remove all"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => void bulk({ allMatching: matching, display: false }, (n) => `${n} Act(s) removed`)}
                        >
                            <Button danger loading={busy} disabled={!q.data?.total}>
                                Remove all matching
                            </Button>
                        </Popconfirm>
                    </Space>

                    {q.isError && <Alert type="error" showIcon message="The Acts could not be loaded" description={q.error.message} />}
                    <Table<ActRow>
                        rowKey="id"
                        size="middle"
                        columns={columns}
                        dataSource={q.data?.items ?? []}
                        loading={q.isFetching}
                        rowSelection={{ selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]), preserveSelectedRowKeys: true }}
                        pagination={{
                            current: page,
                            pageSize: limit,
                            total: q.data?.total ?? 0,
                            showSizeChanger: true,
                            pageSizeOptions: [25, 50, 100],
                            showTotal: (t) => `${t} Acts`,
                            onChange: (p, s) => {
                                setPage(p);
                                setLimit(s);
                            },
                        }}
                    />
                </Space>
            </Card>
        </Space>
    );
}