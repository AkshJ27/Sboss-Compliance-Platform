import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import type { Role } from '../../../core/api/client';
import { useAuth } from '../../../core/auth/AuthContext';
import { formatDateTime } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { useUsers } from '../api';
import type { UserRow } from '../api';

const ROLE_LABEL: Record<Role, string> = { ORG_ADMIN: 'Admin', MEMBER: 'Member', VIEWER: 'Viewer' };
const ROLE_COLOR: Record<Role, string> = { ORG_ADMIN: 'red', MEMBER: 'blue', VIEWER: 'default' };
const ROLE_OPTIONS = [
    { value: 'MEMBER', label: 'Member: can be an owner, manager or approver' },
    { value: 'VIEWER', label: 'Viewer: read-only' },
    { value: 'ORG_ADMIN', label: 'Admin: manages the company setup' },
];

function generatePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    const bytes = new Uint32Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (n) => chars[n % chars.length]).join('');
}

type NewValues = { name: string; email: string; password: string; role: Role };

function NewUserModal({ busy, onSave, onCancel }: { busy: boolean; onSave: (v: NewValues) => void; onCancel: () => void }) {
    const [form] = Form.useForm<NewValues>();
    return (
        <Modal open title="New user" okText="Create" confirmLoading={busy} onOk={() => form.submit()} onCancel={onCancel} destroyOnClose>
            <Form<NewValues>
                form={form}
                layout="vertical"
                initialValues={{ role: 'MEMBER' }}
                onFinish={(v) => onSave({ ...v, name: v.name.trim(), email: v.email.trim() })}
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
                <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}>
                    <Input maxLength={254} autoComplete="off" />
                </Form.Item>
                <Form.Item
                    label="Password"
                    name="password"
                    rules={[
                        { required: true, message: 'Enter a password' },
                        { min: 10, message: 'At least 10 characters' },
                        { max: 72, message: 'At most 72 characters' },
                    ]}
                    extra={
                        <Button
                            type="link"
                            size="small"
                            style={{ padding: 0 }}
                            onClick={() => form.setFieldValue('password', generatePassword())}
                        >
                            Generate a strong password
                        </Button>
                    }
                >
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Form.Item label="Role" name="role" rules={[{ required: true }]}>
                    <Select options={ROLE_OPTIONS} />
                </Form.Item>
            </Form>
        </Modal>
    );
}

type EditValues = { name: string; role: Role };

function EditUserModal({
    user,
    isSelf,
    busy,
    onSave,
    onCancel,
}: {
    user: UserRow;
    isSelf: boolean;
    busy: boolean;
    onSave: (v: EditValues) => void;
    onCancel: () => void;
}) {
    const [form] = Form.useForm<EditValues>();
    return (
        <Modal open title="Edit user" okText="Save" confirmLoading={busy} onOk={() => form.submit()} onCancel={onCancel} destroyOnClose>
            <Typography.Paragraph type="secondary">{user.email}</Typography.Paragraph>
            <Form<EditValues>
                form={form}
                layout="vertical"
                initialValues={{ name: user.name, role: user.role }}
                onFinish={(v) => onSave({ ...v, name: v.name.trim() })}
            >
                <Form.Item
                    label="Name"
                    name="name"
                    rules={[
                        { required: true, whitespace: true, message: 'Enter a name' },
                        { min: 2, message: 'At least 2 characters' },
                    ]}
                >
                    <Input maxLength={120} />
                </Form.Item>
                <Form.Item
                    label="Role"
                    name="role"
                    extra={isSelf ? 'You cannot change your own role.' : 'Changing a role signs the person out of their current sessions.'}
                >
                    <Select disabled={isSelf} options={ROLE_OPTIONS} />
                </Form.Item>
            </Form>
        </Modal>
    );
}

export default function UsersPage() {
    const { user: me } = useAuth();
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const q = useUsers();
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState<UserRow | null>(null);
    const [busy, setBusy] = useState(false);
    const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

    const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

    const create = async (v: NewValues) => {
        setBusy(true);
        try {
            await api('/users', { method: 'POST', body: v });
            setCreating(false);
            setCreated({ email: v.email.toLowerCase(), password: v.password });
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const saveEdit = async (v: EditValues) => {
        if (!editing) return;
        const body: Record<string, unknown> = {};
        if (v.name !== editing.name) body.name = v.name;
        if (v.role !== editing.role) body.role = v.role;
        if (Object.keys(body).length === 0) {
            notify.info('Nothing was changed');
            return;
        }
        setBusy(true);
        try {
            await api(`/users/${editing.id}`, { method: 'PATCH', body });
            notify.success('Saved');
            setEditing(null);
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const toggle = async (row: UserRow) => {
        try {
            await api(`/users/${row.id}`, { method: 'PATCH', body: { isActive: !row.isActive } });
            notify.success(row.isActive ? 'Deactivated. They are signed out.' : 'Activated');
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<UserRow>['columns'] = [
        {
            title: 'Name',
            key: 'name',
            render: (_, r) => (
                <span>
                    {r.name}
                    {r.id === me?.id && <Typography.Text type="secondary"> (you)</Typography.Text>}
                </span>
            ),
        },
        { title: 'Email', dataIndex: 'email', key: 'email' },
        { title: 'Role', key: 'role', render: (_, r) => <Tag color={ROLE_COLOR[r.role]}>{ROLE_LABEL[r.role]}</Tag> },
        {
            title: 'Status',
            key: 'status',
            render: (_, r) => (r.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>),
        },
        {
            title: 'Last sign-in',
            key: 'last',
            render: (_, r) => (r.lastLoginAt ? formatDateTime(r.lastLoginAt) : 'Never'),
        },
        {
            title: '',
            key: 'actions',
            width: 210,
            render: (_, r) => (
                <Space>
                    <Button size="small" onClick={() => setEditing(r)}>
                        Edit
                    </Button>
                    <Popconfirm
                        title={r.isActive ? 'Deactivate this user?' : 'Activate this user?'}
                        description={r.isActive ? 'They are signed out and cannot sign in again until you activate them.' : undefined}
                        okText={r.isActive ? 'Deactivate' : 'Activate'}
                        okButtonProps={{ danger: r.isActive }}
                        disabled={r.id === me?.id}
                        onConfirm={() => void toggle(r)}
                    >
                        <Button size="small" danger={r.isActive} disabled={r.id === me?.id}>
                            {r.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {holder}
            <Typography.Title level={4} style={{ margin: 0 }}>
                Users
            </Typography.Title>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)} style={{ width: 'fit-content' }}>
                New user
            </Button>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The users could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<UserRow>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data ?? []}
                loading={q.isFetching}
                scroll={{ x: 800 }}
                pagination={{ pageSize: 25, hideOnSinglePage: true }}
            />

            {creating && <NewUserModal busy={busy} onSave={(v) => void create(v)} onCancel={() => setCreating(false)} />}
            {editing && (
                <EditUserModal
                    user={editing}
                    isSelf={editing.id === me?.id}
                    busy={busy}
                    onSave={(v) => void saveEdit(v)}
                    onCancel={() => setEditing(null)}
                />
            )}

            <Modal
                open={created !== null}
                title="User created"
                closable={false}
                maskClosable={false}
                footer={
                    <Button type="primary" onClick={() => setCreated(null)}>
                        Done
                    </Button>
                }
            >
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Copy this password now"
                    description="It cannot be shown again. Share it through a secure channel."
                />
                <div>Email: {created?.email}</div>
                <div>
                    Password:{' '}
                    <Typography.Text code copyable>
                        {created?.password ?? ''}
                    </Typography.Text>
                </div>
            </Modal>
        </Space>
    );
}