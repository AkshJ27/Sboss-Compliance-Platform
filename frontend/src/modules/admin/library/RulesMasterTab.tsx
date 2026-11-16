import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { errorText } from '../../../shared/errors';
import { RemoteSelect } from '../RemoteSelect';
import type { Opt } from '../RemoteSelect';

type RuleRow = {
    id: string;
    name: string;
    isActive: boolean;
    act: { id: string; name: string; state: string | null; orgId: string | null };
    _count: { compliances: number };
};
type RulePage = { items: RuleRow[]; total: number };
type ActOption = { id: string; name: string; state: string | null; orgId: string | null };

const actLabel = (a: { name: string; state: string | null }) => (a.state ? `${a.name} (${a.state})` : a.name);

// Shared Acts only: a company's own "Internal Compliance" Acts do not take rules
async function loadActs(search: string, signal: AbortSignal): Promise<Opt[]> {
    const qs = new URLSearchParams({ limit: '50' });
    if (search) qs.set('search', search);
    const page = await api<{ items: ActOption[] }>(`/library/acts?${qs.toString()}`, { signal });
    return page.items.filter((a) => !a.orgId).map((a) => ({ value: a.id, label: actLabel(a) }));
}

export function RulesMasterTab({ canEdit }: { canEdit: boolean }) {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const [act, setAct] = useState<Opt | undefined>();
    const [search, setSearch] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [editing, setEditing] = useState<RuleRow | 'new' | null>(null);
    const [newAct, setNewAct] = useState<Opt | undefined>();
    const [busy, setBusy] = useState(false);
    const [form] = Form.useForm<{ name: string }>();

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (act) params.set('actId', act.value);
    if (search) params.set('search', search);
    if (showInactive) params.set('includeInactive', 'true');
    const qs = params.toString();
    const q = useQuery({
        queryKey: ['library', 'rules', qs],
        queryFn: ({ signal }) => api<RulePage>(`/library/masters/rules?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });
    const refresh = () => qc.invalidateQueries({ queryKey: ['library'] });

    const save = async (name: string) => {
        setBusy(true);
        try {
            if (editing === 'new') {
                const target = newAct ?? act;
                if (!target) {
                    notify.error('Choose the Act this rule belongs to');
                    return;
                }
                await api('/library/masters/rules', { method: 'POST', body: { actId: target.value, name } });
            } else if (editing) {
                await api(`/library/masters/rules/${editing.id}`, { method: 'PATCH', body: { name } });
            }
            notify.success('Saved');
            setEditing(null);
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const toggle = async (r: RuleRow) => {
        try {
            await api(`/library/masters/rules/${r.id}`, { method: 'PATCH', body: { isActive: !r.isActive } });
            notify.success(r.isActive ? 'Deactivated' : 'Activated');
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<RuleRow>['columns'] = [
        { title: 'Rule', dataIndex: 'name', key: 'n' },
        { title: 'Act', key: 'a', width: 320, render: (_, r) => actLabel(r.act) },
        { title: 'Compliances', key: 'c', width: 110, render: (_, r) => r._count.compliances },
        { title: 'Status', key: 's', width: 100, render: (_, r) => (r.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
        ...(canEdit
            ? [
                {
                    title: '',
                    key: 'x',
                    width: 190,
                    render: (_: unknown, r: RuleRow) =>
                        r.act.orgId ? null : (
                            <Space>
                                <Button size="small" onClick={() => setEditing(r)}>
                                    Rename
                                </Button>
                                <Popconfirm
                                    title={r.isActive ? 'Deactivate this rule?' : 'Activate this rule?'}
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

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {holder}
            <Space wrap>
                {canEdit && (
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => {
                            setNewAct(act);
                            setEditing('new');
                        }}
                    >
                        New rule
                    </Button>
                )}
                <div style={{ width: 320 }}>
                    <RemoteSelect
                        cacheKey="library-acts-for-rules"
                        load={loadActs}
                        placeholder="All Acts"
                        value={act}
                        onChange={(v) => {
                            setAct(v as Opt | undefined);
                            setPage(1);
                        }}
                    />
                </div>
                <Input.Search
                    allowClear
                    maxLength={100}
                    placeholder="Search rules"
                    style={{ width: 220 }}
                    onSearch={(v) => {
                        setSearch(v.trim());
                        setPage(1);
                    }}
                />
                <span>
                    <Switch
                        size="small"
                        checked={showInactive}
                        onChange={(v) => {
                            setShowInactive(v);
                            setPage(1);
                        }}
                    />{' '}
                    <Typography.Text type="secondary">Show inactive</Typography.Text>
                </span>
            </Space>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The rules could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<RuleRow>
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
                    showTotal: (t) => `${t} rules`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />

            {editing && (
                <Modal
                    open
                    title={editing === 'new' ? 'New rule' : 'Rename rule'}
                    okText="Save"
                    confirmLoading={busy}
                    onOk={() => form.submit()}
                    onCancel={() => setEditing(null)}
                    destroyOnClose
                >
                    {editing === 'new' && (
                        <div style={{ marginBottom: 16 }}>
                            <Typography.Text>Act</Typography.Text>
                            <RemoteSelect
                                cacheKey="library-acts-for-new-rule"
                                load={loadActs}
                                placeholder="Choose the Act"
                                value={newAct}
                                onChange={(v) => setNewAct(v as Opt | undefined)}
                            />
                        </div>
                    )}
                    <Form
                        form={form}
                        layout="vertical"
                        preserve={false}
                        initialValues={{ name: editing === 'new' ? '' : editing.name }}
                        onFinish={(v) => void save(v.name.trim())}
                    >
                        <Form.Item label="Rule name" name="name" rules={[{ required: true, whitespace: true, message: 'Enter a name' }, { min: 2 }, { max: 300 }]}>
                            <Input maxLength={300} placeholder="Payment of Wages (Maharashtra) Rules, 1963" />
                        </Form.Item>
                    </Form>
                </Modal>
            )}
        </Space>
    );
}