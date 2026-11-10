import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { errorText } from '../../../shared/errors';
import { useEntities } from '../api';
import type { Entity } from '../api';

type FormValues = { name: string; code: string };

type ModalProps = {
    initial: Entity | null;
    busy: boolean;
    onSave: (v: FormValues) => void;
    onCancel: () => void;
};

function EntityModal({ initial, busy, onSave, onCancel }: ModalProps) {
    const [form] = Form.useForm<FormValues>();
    return (
        <Modal
            open
            title={initial ? 'Edit entity' : 'New entity'}
            okText="Save"
            confirmLoading={busy}
            onOk={() => form.submit()}
            onCancel={onCancel}
            destroyOnClose
        >
            <Form<FormValues>
                form={form}
                layout="vertical"
                initialValues={{ name: initial?.name ?? '', code: initial?.code ?? '' }}
                onFinish={(v) => onSave({ name: v.name.trim(), code: v.code.trim().toUpperCase() })}
            >
                <Form.Item
                    label="Name"
                    name="name"
                    rules={[
                        { required: true, whitespace: true, message: 'Enter a name' },
                        { min: 2, message: 'At least 2 characters' },
                    ]}
                >
                    <Input maxLength={120} autoFocus />
                </Form.Item>
                <Form.Item
                    label="Code"
                    name="code"
                    extra="2 to 10 letters or digits. Shown in lists and reports."
                    rules={[
                        { required: true, message: 'Enter a code' },
                        { pattern: /^[A-Za-z0-9]{2,10}$/, message: 'Use 2 to 10 letters or digits' },
                    ]}
                >
                    <Input maxLength={10} style={{ textTransform: 'uppercase' }} />
                </Form.Item>
            </Form>
        </Modal>
    );
}

export function EntitiesTab() {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const [showInactive, setShowInactive] = useState(false);
    const [editing, setEditing] = useState<Entity | 'new' | null>(null);
    const [busy, setBusy] = useState(false);
    const q = useEntities(showInactive);

    const refresh = () => qc.invalidateQueries({ queryKey: ['masters'] });

    const save = async (v: FormValues) => {
        setBusy(true);
        try {
            if (editing === 'new') {
                await api('/masters/entities', { method: 'POST', body: v });
            } else if (editing) {
                await api(`/masters/entities/${editing.id}`, { method: 'PATCH', body: v });
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

    const toggle = async (row: Entity) => {
        try {
            await api(`/masters/entities/${row.id}`, { method: 'PATCH', body: { isActive: !row.isActive } });
            notify.success(row.isActive ? 'Deactivated' : 'Activated');
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<Entity>['columns'] = [
        { title: 'Name', dataIndex: 'name', key: 'name' },
        { title: 'Code', dataIndex: 'code', key: 'code', width: 120 },
        {
            title: 'Status',
            key: 'status',
            width: 110,
            render: (_, r) => (r.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>),
        },
        {
            title: '',
            key: 'actions',
            width: 200,
            render: (_, r) => (
                <Space>
                    <Button size="small" onClick={() => setEditing(r)}>
                        Edit
                    </Button>
                    <Popconfirm
                        title={r.isActive ? 'Deactivate this entity?' : 'Activate this entity?'}
                        description={
                            r.isActive
                                ? 'No new items are generated for its locations. Existing items are not changed.'
                                : undefined
                        }
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
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {holder}
            <Space wrap>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
                    New entity
                </Button>
                <span>
                    <Switch size="small" checked={showInactive} onChange={setShowInactive} />{' '}
                    <Typography.Text type="secondary">Show inactive</Typography.Text>
                </span>
            </Space>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The entities could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<Entity>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data ?? []}
                loading={q.isFetching}
                pagination={{ pageSize: 25, hideOnSinglePage: true }}
            />

            {editing && (
                <EntityModal
                    initial={editing === 'new' ? null : editing}
                    busy={busy}
                    onSave={(v) => void save(v)}
                    onCancel={() => setEditing(null)}
                />
            )}
        </Space>
    );
}