import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, message } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { errorText } from '../../../shared/errors';
import { useSimple } from '../api';
import type { Simple, SimpleKind } from '../api';
import { StatusFilter, byStatus } from '../../../shared/StatusFilter';
import type { StatusFilterValue } from '../../../shared/StatusFilter';

type Props = { kind: SimpleKind; singular: string; plural: string };
type NameValues = { name: string };

type ModalProps = {
    title: string;
    initial: string;
    busy: boolean;
    onSave: (name: string) => void;
    onCancel: () => void;
};

function NameModal({ title, initial, busy, onSave, onCancel }: ModalProps) {
    const [form] = Form.useForm<NameValues>();
    return (
        <Modal open title={title} okText="Save" confirmLoading={busy} onOk={() => form.submit()} onCancel={onCancel} destroyOnClose>
            <Form<NameValues>
                form={form}
                layout="vertical"
                initialValues={{ name: initial }}
                onFinish={(v) => onSave(v.name.trim())}
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
            </Form>
        </Modal>
    );
}

export function SimpleMasterTab({ kind, singular, plural }: Props) {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const [status, setStatus] = useState<StatusFilterValue>('active');
    const [editing, setEditing] = useState<Simple | 'new' | null>(null);
    const [busy, setBusy] = useState(false);
    const q = useSimple(kind, status !== 'active');

    const refresh = () => qc.invalidateQueries({ queryKey: ['masters'] });

    const save = async (name: string) => {
        setBusy(true);
        try {
            if (editing === 'new') {
                await api(`/masters/${kind}`, { method: 'POST', body: { name } });
            } else if (editing) {
                await api(`/masters/${kind}/${editing.id}`, { method: 'PATCH', body: { name } });
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

    const toggle = async (row: Simple) => {
        try {
            await api(`/masters/${kind}/${row.id}`, { method: 'PATCH', body: { isActive: !row.isActive } });
            notify.success(row.isActive ? 'Deactivated' : 'Activated');
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<Simple>['columns'] = [
        { title: 'Name', dataIndex: 'name', key: 'name' },
        {
            title: 'Status',
            key: 'status',
            width: 110,
            render: (_, r) => (r.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>),
        },
        {
            title: '',
            key: 'actions',
            width: 230,
            render: (_, r) => (
                <Space>
                    <Button size="small" onClick={() => setEditing(r)}>
                        Rename
                    </Button>
                    <Popconfirm
                        title={r.isActive ? `Deactivate this ${singular}?` : `Activate this ${singular}?`}
                        description={
                            r.isActive ? 'It stays on existing items but can no longer be chosen for new ones.' : undefined
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
                    New {singular}
                </Button>
                <StatusFilter value={status} onChange={setStatus} />
            </Space>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message={`The ${plural} could not be loaded`}
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<Simple>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={byStatus(q.data ?? [], status)}
                loading={q.isFetching}
                pagination={{ pageSize: 25, hideOnSinglePage: true }}
            />

            {editing && (
                <NameModal
                    title={editing === 'new' ? `New ${singular}` : `Rename ${singular}`}
                    initial={editing === 'new' ? '' : editing.name}
                    busy={busy}
                    onSave={(name) => void save(name)}
                    onCancel={() => setEditing(null)}
                />
            )}
        </Space>
    );
}