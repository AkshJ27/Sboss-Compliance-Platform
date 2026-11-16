import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Table, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { formatDate } from '../../../core/format';
import { errorText } from '../../../shared/errors';

export type LookupKind = 'law-categories' | 'statutory-authorities' | 'natures' | 'types';
type LookupRow = { id: string; name: string; createdAt: string; used: number };

type Props = {
    kind: LookupKind;
    singular: string;
    usedBy: string; // what uses it, such as "Acts"
    canEdit: boolean;
};

// One shared list (law categories, statutory authorities, natures or types)
export function LookupMasterTab({ kind, singular, usedBy, canEdit }: Props) {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const [editing, setEditing] = useState<LookupRow | 'new' | null>(null);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [form] = Form.useForm<{ name: string }>();

    const q = useQuery({
        queryKey: ['library', 'masters', kind],
        queryFn: ({ signal }) => api<LookupRow[]>(`/library/masters/${kind}`, { signal }),
    });
    const refresh = () => qc.invalidateQueries({ queryKey: ['library'] });

    const save = async (name: string) => {
        setBusy(true);
        try {
            if (editing === 'new') await api(`/library/masters/${kind}`, { method: 'POST', body: { name } });
            else if (editing) await api(`/library/masters/${kind}/${editing.id}`, { method: 'PATCH', body: { name } });
            notify.success('Saved');
            setEditing(null);
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (row: LookupRow) => {
        try {
            await api(`/library/masters/${kind}/${row.id}`, { method: 'DELETE' });
            notify.success('Deleted');
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const rows = (q.data ?? []).filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()));

    const columns: TableProps<LookupRow>['columns'] = [
        { title: 'Name', dataIndex: 'name', key: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
        { title: `Used by ${usedBy}`, dataIndex: 'used', key: 'used', width: 150, sorter: (a, b) => a.used - b.used },
        { title: 'Added', key: 'c', width: 130, render: (_, r) => formatDate(r.createdAt) },
        ...(canEdit
            ? [
                {
                    title: '',
                    key: 'actions',
                    width: 190,
                    render: (_: unknown, r: LookupRow) => (
                        <Space>
                            <Button size="small" onClick={() => setEditing(r)}>
                                Rename
                            </Button>
                            <Popconfirm
                                title={`Delete this ${singular}?`}
                                description={r.used ? `It is used by ${r.used} record(s), so it cannot be deleted.` : 'This cannot be undone.'}
                                okText="Delete"
                                okButtonProps={{ danger: true, disabled: r.used > 0 }}
                                onConfirm={() => void remove(r)}
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

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {holder}
            <Space wrap>
                {canEdit && (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
                        New {singular}
                    </Button>
                )}
                <Input.Search allowClear placeholder="Search" style={{ width: 240 }} onChange={(e) => setSearch(e.target.value)} />
                <Typography.Text type="secondary">{q.data ? `${q.data.length} in the shared library` : ''}</Typography.Text>
            </Space>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The list could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<LookupRow>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={rows}
                loading={q.isFetching}
                pagination={{ pageSize: 25, hideOnSinglePage: true }}
            />

            {editing && (
                <Modal
                    open
                    title={editing === 'new' ? `New ${singular}` : `Rename ${singular}`}
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
                        <Form.Item
                            label="Name"
                            name="name"
                            rules={[
                                { required: true, whitespace: true, message: 'Enter a name' },
                                { min: 2, message: 'At least 2 characters' },
                                { max: 200 },
                            ]}
                            extra={editing !== 'new' && editing.used ? `The new name shows on all ${editing.used} record(s) that use it.` : undefined}
                        >
                            <Input maxLength={200} autoFocus />
                        </Form.Item>
                    </Form>
                </Modal>
            )}
        </Space>
    );
}