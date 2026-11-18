import { useState } from 'react';
import {
    Alert, Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message,
} from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined, SwapOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../core/api/client';
import { useAuth } from '../../core/auth/AuthContext';
import { errorText } from '../../shared/errors';
import { useUsers, userOptions } from '../admin/api';
import { useDocCategories } from './api';
import type { DocCategory, RecordPage } from './api';
import { StatusFilter, byStatus } from '../../shared/StatusFilter';
import type { StatusFilterValue } from '../../shared/StatusFilter';

export type MastersTab = 'category' | 'sub' | 'subsub' | 'owner-swap';

const LABEL = { 1: 'category', 2: 'sub category', 3: 'sub sub category' } as const;

// One level of the category tree. Levels 2 and 3 first ask which parent to show.
function CategoryLevel({ level, canEdit }: { level: 1 | 2 | 3; canEdit: boolean }) {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const [catId, setCatId] = useState<string | undefined>();
    const [subId, setSubId] = useState<string | undefined>();
    const [status, setStatus] = useState<StatusFilterValue>('active');
    const [editing, setEditing] = useState<DocCategory | 'new' | null>(null);
    const [busy, setBusy] = useState(false);
    const [form] = Form.useForm<{ name: string }>();

    const cats = useDocCategories(1, null, true);
    const subs = useDocCategories(2, catId, true);
    const parentId = level === 1 ? null : level === 2 ? catId : subId;
    const rows = useDocCategories(level, parentId, status !== 'active');
    const ready = level === 1 || !!parentId;
    const refresh = () => qc.invalidateQueries({ queryKey: ['documents'] });

    const save = async (name: string) => {
        setBusy(true);
        try {
            if (editing === 'new') await api('/documents/categories', { method: 'POST', body: { name, parentId } });
            else if (editing) await api(`/documents/categories/${editing.id}`, { method: 'PATCH', body: { name } });
            notify.success('Saved');
            setEditing(null);
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const act = async (fn: () => Promise<unknown>, done: string) => {
        try {
            await fn();
            notify.success(done);
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<DocCategory>['columns'] = [
        { title: 'Name', dataIndex: 'name', key: 'n' },
        ...(level < 3 ? [{ title: level === 1 ? 'Sub categories' : 'Sub sub categories', dataIndex: 'children', key: 'c', width: 140 }] : []),
        { title: 'Documents', dataIndex: 'documents', key: 'd', width: 110 },
        { title: 'Status', key: 's', width: 90, render: (_, r) => (r.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
        ...(canEdit
            ? [
                {
                    title: '',
                    key: 'x',
                    width: 270,
                    render: (_: unknown, r: DocCategory) => (
                        <Space>
                            <Button size="small" onClick={() => setEditing(r)}>
                                Rename
                            </Button>
                            <Button
                                size="small"
                                onClick={() =>
                                    void act(
                                        () => api(`/documents/categories/${r.id}`, { method: 'PATCH', body: { isActive: !r.isActive } }),
                                        r.isActive ? 'Deactivated' : 'Activated',
                                    )
                                }
                            >
                                {r.isActive ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Popconfirm
                                title={`Delete this ${LABEL[level]}?`}
                                description={
                                    r.children || r.documents ? 'It is in use, so it cannot be deleted. Deactivate it instead.' : 'This cannot be undone.'
                                }
                                okText="Delete"
                                okButtonProps={{ danger: true, disabled: !!(r.children || r.documents) }}
                                onConfirm={() => void act(() => api(`/documents/categories/${r.id}`, { method: 'DELETE' }), 'Deleted')}
                            >
                                <Button size="small" danger>
                                    Delete
                                </Button>
                            </Popconfirm>
                        </Space>
                    ),
                },
            ]
            : []),
    ];

    const catOptions = (cats.data ?? []).map((c) => ({ value: c.id, label: c.isActive ? c.name : `${c.name} (inactive)` }));
    const subOptions = (subs.data ?? []).map((c) => ({ value: c.id, label: c.isActive ? c.name : `${c.name} (inactive)` }));

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {holder}
            <Space wrap>
                {level >= 2 && (
                    <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Choose the category"
                        style={{ width: 240 }}
                        value={catId}
                        options={catOptions}
                        onChange={(v) => {
                            setCatId(v);
                            setSubId(undefined);
                        }}
                    />
                )}
                {level === 3 && (
                    <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder={catId ? 'Choose the sub category' : 'Choose the category first'}
                        disabled={!catId}
                        style={{ width: 240 }}
                        value={subId}
                        options={subOptions}
                        onChange={setSubId}
                    />
                )}
                {canEdit && (
                    <Button type="primary" icon={<PlusOutlined />} disabled={!ready} onClick={() => setEditing('new')}>
                        New {LABEL[level]}
                    </Button>
                )}
                <StatusFilter value={status} onChange={setStatus} />
            </Space>

            {rows.isError && <Alert type="error" showIcon message="The list could not be loaded" description={rows.error.message} />}
            {ready ? (
                <Table<DocCategory>
                    rowKey="id"
                    size="small"
                    columns={columns}
                    dataSource={byStatus(rows.data ?? [], status)}
                    loading={rows.isFetching}
                    pagination={{ pageSize: 20, hideOnSinglePage: true }}
                />
            ) : (
                <Typography.Text type="secondary">Choose {level === 2 ? 'a category' : 'a category and a sub category'} to see its entries.</Typography.Text>
            )}

            {editing && (
                <Modal
                    open
                    title={editing === 'new' ? `New ${LABEL[level]}` : `Rename ${LABEL[level]}`}
                    okText="Save"
                    confirmLoading={busy}
                    onOk={() => form.submit()}
                    onCancel={() => setEditing(null)}
                    destroyOnClose
                >
                    <Form
                        form={form}
                        layout="vertical"
                        preserve={false}
                        initialValues={{ name: editing === 'new' ? '' : editing.name }}
                        onFinish={(v) => void save(v.name.trim())}
                    >
                        <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, message: 'Enter a name' }, { min: 2 }, { max: 200 }]}>
                            <Input maxLength={200} autoFocus />
                        </Form.Item>
                    </Form>
                </Modal>
            )}
        </Space>
    );
}

// Moves documents from one owner to another, such as when someone leaves
function OwnerSwap() {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const users = useUsers();
    const [fromUserId, setFrom] = useState<string | undefined>();
    const [toUserId, setTo] = useState<string | undefined>();
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);

    const owned = useQuery({
        queryKey: ['documents', 'records', 'owned-by', fromUserId],
        queryFn: ({ signal }) => api<RecordPage>(`/documents/records?ownerId=${fromUserId}&limit=100&sort=name&order=asc`, { signal }),
        enabled: !!fromUserId,
    });

    const everyoneWithDocs = (users.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.email})${u.isActive ? '' : ' - inactive'}` }));
    const total = owned.data?.total ?? 0;

    const swap = async () => {
        if (!fromUserId || !toUserId) return;
        setBusy(true);
        try {
            const body = selected.length ? { fromUserId, toUserId, recordIds: selected } : { fromUserId, toUserId };
            const r = await api<{ moved: number }>('/documents/records/owner-swap', { method: 'POST', body });
            notify.success(`${r.moved} document(s) moved to the new owner`);
            setSelected([]);
            await qc.invalidateQueries({ queryKey: ['documents'] });
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {holder}
            <Typography.Text type="secondary">
                Moves documents from one owner to another. Tick documents to move only those; tick none to move all of them.
            </Typography.Text>
            <Space wrap>
                <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Current owner"
                    style={{ width: 300 }}
                    value={fromUserId}
                    options={everyoneWithDocs}
                    onChange={(v) => {
                        setFrom(v);
                        setSelected([]);
                    }}
                />
                <SwapOutlined />
                <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="New owner"
                    style={{ width: 300 }}
                    value={toUserId}
                    options={userOptions(users.data).filter((o) => o.value !== fromUserId)}
                    onChange={setTo}
                />
                <Popconfirm
                    title={`Move ${selected.length || total} document(s)?`}
                    okText="Move"
                    disabled={!fromUserId || !toUserId || !total}
                    onConfirm={() => void swap()}
                >
                    <Button type="primary" loading={busy} disabled={!fromUserId || !toUserId || !total}>
                        {selected.length ? `Move ${selected.length} selected` : `Move all ${total}`}
                    </Button>
                </Popconfirm>
            </Space>
            {total > 100 && !selected.length && (
                <Alert type="info" showIcon message={`Showing the first 100 of ${total}. "Move all" moves every one of them.`} />
            )}
            {fromUserId && (
                <Table
                    rowKey="id"
                    size="small"
                    loading={owned.isFetching}
                    dataSource={owned.data?.items ?? []}
                    pagination={{ pageSize: 20, hideOnSinglePage: true }}
                    rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
                    columns={[
                        { title: 'Doc Name', dataIndex: 'name', key: 'n' },
                        { title: 'Category', key: 'c', render: (_, r) => r.category.name },
                        { title: 'Location', key: 'l', render: (_, r) => r.location.name },
                    ]}
                />
            )}
        </Space>
    );
}

export function DocumentMastersDrawer({ tab, onTabChange, onClose }: { tab: MastersTab; onTabChange: (t: MastersTab) => void; onClose: () => void }) {
    const { user } = useAuth();
    const isAdmin = user?.role === 'ORG_ADMIN';
    return (
        <Drawer open width={900} title="Document Master" onClose={onClose} destroyOnClose>
            {!isAdmin && (
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Only a company admin can change these. You can look." />
            )}
            <Tabs
                activeKey={tab}
                onChange={(k) => onTabChange(k as MastersTab)}
                destroyInactiveTabPane
                items={[
                    { key: 'category', label: 'Category', children: <CategoryLevel level={1} canEdit={isAdmin} /> },
                    { key: 'sub', label: 'Sub Category', children: <CategoryLevel level={2} canEdit={isAdmin} /> },
                    { key: 'subsub', label: 'Sub Sub Category', children: <CategoryLevel level={3} canEdit={isAdmin} /> },
                    ...(isAdmin ? [{ key: 'owner-swap', label: 'Document Owner Swap', children: <OwnerSwap /> }] : []),
                ]}
            />
        </Drawer>
    );
}