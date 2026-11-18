import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Radio, Select, Space, Table, Tag, message } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { errorText } from '../../../shared/errors';
import { useStates } from '../api';
import { StatusFilter } from '../../../shared/StatusFilter';
import type { StatusFilterValue } from '../../../shared/StatusFilter';

type Named = { id: string; name: string };
type Lookups = { lawCategories: Named[]; statutoryAuthorities: Named[] };
type ActRow = {
    id: string;
    name: string;
    jurisdiction: 'CENTRAL' | 'STATE';
    state: string | null;
    isActive: boolean;
    orgId: string | null;
    lawCategory: Named;
    statutoryAuthority: Named | null;
    _count: { compliances: number; rules: number };
};
type ActPage = { items: ActRow[]; total: number };
type ActForm = {
    name: string;
    jurisdiction: 'CENTRAL' | 'STATE';
    state?: string;
    lawCategoryId: string;
    statutoryAuthorityId?: string;
};

export function ActsMasterTab({ canEdit }: { canEdit: boolean }) {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const [form] = Form.useForm<ActForm>();
    const states = useStates();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilterValue>('active');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [editing, setEditing] = useState<ActRow | 'new' | null>(null);
    const [busy, setBusy] = useState(false);
    const jurisdiction = Form.useWatch('jurisdiction', form);

    const lookups = useQuery({
        queryKey: ['library', 'lookups'],
        queryFn: ({ signal }) => api<Lookups>('/library/lookups', { signal }),
        staleTime: 5 * 60_000,
    });

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    params.set('status', status);
    const qs = params.toString();
    const q = useQuery({
        queryKey: ['library', 'acts', 'masters', qs],
        queryFn: ({ signal }) => api<ActPage>(`/library/acts?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });
    const refresh = () => qc.invalidateQueries({ queryKey: ['library'] });

    const save = async (v: ActForm) => {
        setBusy(true);
        try {
            const body = {
                name: v.name.trim(),
                jurisdiction: v.jurisdiction,
                state: v.jurisdiction === 'STATE' ? v.state : null,
                lawCategoryId: v.lawCategoryId,
                statutoryAuthorityId: v.statutoryAuthorityId ?? null,
            };
            if (editing === 'new') await api('/library/masters/acts', { method: 'POST', body });
            else if (editing) await api(`/library/masters/acts/${editing.id}`, { method: 'PATCH', body });
            notify.success('Saved');
            setEditing(null);
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const toggle = async (r: ActRow) => {
        try {
            await api(`/library/masters/acts/${r.id}`, { method: 'PATCH', body: { isActive: !r.isActive } });
            notify.success(r.isActive ? 'Deactivated' : 'Activated');
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<ActRow>['columns'] = [
        {
            title: 'Act',
            key: 'n',
            render: (_, r) => (
                <span>
                    {r.name}
                    {r.orgId && (
                        <Tag color="geekblue" style={{ marginLeft: 8 }}>
                            Your internal
                        </Tag>
                    )}
                </span>
            ),
        },
        {
            title: 'Applies to',
            key: 'j',
            width: 170,
            render: (_, r) => (r.jurisdiction === 'STATE' ? <Tag color="purple">{r.state}</Tag> : <Tag color="blue">Central</Tag>),
        },
        { title: 'Law category', key: 'c', width: 190, render: (_, r) => r.lawCategory.name },
        { title: 'Statutory authority', key: 'a', width: 200, render: (_, r) => r.statutoryAuthority?.name ?? '' },
        { title: 'Compliances', key: 'cc', width: 110, render: (_, r) => r._count.compliances },
        { title: 'Rules', key: 'rc', width: 80, render: (_, r) => r._count.rules },
        { title: 'Status', key: 's', width: 100, render: (_, r) => (r.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
        ...(canEdit
            ? [
                {
                    title: '',
                    key: 'x',
                    width: 190,
                    render: (_: unknown, r: ActRow) =>
                        r.orgId ? null : (
                            <Space>
                                <Button size="small" onClick={() => setEditing(r)}>
                                    Edit
                                </Button>
                                <Popconfirm
                                    title={r.isActive ? 'Deactivate this Act?' : 'Activate this Act?'}
                                    description={r.isActive ? 'Its compliances can no longer be newly scheduled. Existing schedules keep running.' : undefined}
                                    okText={r.isActive ? 'Deactivate' : 'Activate'}
                                    okButtonProps={{ danger: r.isActive }}
                                    onConfirm={() => void toggle(r)}
                                >
                                    <Button size="small" danger={r.isActive}>
                                        {r.isActive ? 'Deactivate' : 'Activate'}
                                    </Button>
                                </Popconfirm>
                            </Space>
                        ),
                },
            ]
            : []),
    ];

    const initial: Partial<ActForm> =
        editing && editing !== 'new'
            ? {
                name: editing.name,
                jurisdiction: editing.jurisdiction,
                state: editing.state ?? undefined,
                lawCategoryId: editing.lawCategory.id,
                statutoryAuthorityId: editing.statutoryAuthority?.id,
            }
            : { jurisdiction: 'CENTRAL' };

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {holder}
            <Space wrap>
                {canEdit && (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
                        New Act
                    </Button>
                )}
                <Input.Search
                    allowClear
                    maxLength={100}
                    placeholder="Search Acts"
                    style={{ width: 260 }}
                    onSearch={(v) => {
                        setSearch(v.trim());
                        setPage(1);
                    }}
                />
                <StatusFilter
                    value={status}
                    onChange={(v) => {
                        setStatus(v);
                        setPage(1);
                    }}
                />
            </Space>

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

            <Table<ActRow>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                scroll={{ x: 1250 }}
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

            {editing && (
                <Modal
                    open
                    title={editing === 'new' ? 'New Act' : 'Edit Act'}
                    okText="Save"
                    confirmLoading={busy}
                    onOk={() => form.submit()}
                    onCancel={() => setEditing(null)}
                    destroyOnClose
                >
                    <Form<ActForm> form={form} layout="vertical" preserve={false} initialValues={initial} onFinish={(v) => void save(v)}>
                        <Form.Item name="name" label="Act name" rules={[{ required: true, whitespace: true, message: 'Enter a name' }, { min: 2 }, { max: 300 }]}>
                            <Input maxLength={300} placeholder="Payment of Wages Act, 1936" />
                        </Form.Item>
                        <Form.Item name="jurisdiction" label="Applies to" rules={[{ required: true }]}>
                            <Radio.Group
                                options={[
                                    { value: 'CENTRAL', label: 'Central (all of India)' },
                                    { value: 'STATE', label: 'One state' },
                                ]}
                            />
                        </Form.Item>
                        {jurisdiction === 'STATE' && (
                            <Form.Item name="state" label="State" rules={[{ required: true, message: 'Choose the state' }]}>
                                <Select showSearch options={(states.data ?? []).map((s) => ({ value: s, label: s }))} />
                            </Form.Item>
                        )}
                        <Form.Item name="lawCategoryId" label="Law category" rules={[{ required: true, message: 'Choose a law category' }]}>
                            <Select
                                showSearch
                                optionFilterProp="label"
                                options={(lookups.data?.lawCategories ?? []).map((c) => ({ value: c.id, label: c.name }))}
                            />
                        </Form.Item>
                        <Form.Item name="statutoryAuthorityId" label="Statutory authority">
                            <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                options={(lookups.data?.statutoryAuthorities ?? []).map((c) => ({ value: c.id, label: c.name }))}
                            />
                        </Form.Item>
                    </Form>
                </Modal>
            )}
        </Space>
    );
}