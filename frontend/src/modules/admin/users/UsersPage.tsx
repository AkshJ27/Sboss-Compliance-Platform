import { useState } from 'react';
import { Alert, Button, Col, Form, Input, Modal, Popconfirm, Radio, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined, SafetyOutlined, UploadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import type { Role } from '../../../core/api/client';
import { useAuth } from '../../../core/auth/AuthContext';
import { formatDateTime } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { useSimple, useUsers } from '../api';
import type { UserRow } from '../api';
import { UsersUploadModal } from './UsersUploadModal';
import { VendorAccessModal } from './VendorAccessModal';

const ROLE_LABEL: Record<Role, string> = { ORG_ADMIN: 'Admin', MEMBER: 'Member', VIEWER: 'Viewer' };
const ROLE_COLOR: Record<Role, string> = { ORG_ADMIN: 'red', MEMBER: 'blue', VIEWER: 'default' };
const ROLE_OPTIONS = [
    { value: 'MEMBER', label: 'Member: can be an owner, manager or approver' },
    { value: 'VIEWER', label: 'Viewer: read-only' },
    { value: 'ORG_ADMIN', label: 'Admin: manages the company setup' },
];

const isLocked = (r: UserRow) => r.lockedUntil !== null && new Date(r.lockedUntil) > new Date();

function generatePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    const bytes = new Uint32Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (n) => chars[n % chars.length]).join('');
}

type NewValues = { name: string; email: string; method: 'invite' | 'password'; password?: string; role: Role };
type CreateResponse = UserRow & { invite: { emailed: boolean } | null };
type Created = { email: string; password?: string; invite: { emailed: boolean } | null };

function NewUserModal({
    busy,
    onSave,
    onCancel,
}: {
    busy: boolean;
    onSave: (v: NewValues) => void;
    onCancel: () => void;
}) {
    const [form] = Form.useForm<NewValues>();
    return (
        <Modal open title="New user" okText="Create" confirmLoading={busy} onOk={() => form.submit()} onCancel={onCancel} destroyOnClose>
            <Form<NewValues>
                form={form}
                layout="vertical"
                initialValues={{ role: 'MEMBER', method: 'invite' }}
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
                <Form.Item label="Role" name="role" rules={[{ required: true }]}>
                    <Select options={ROLE_OPTIONS} />
                </Form.Item>
                <Form.Item label="How do they get access?" name="method">
                    <Radio.Group
                        options={[
                            { value: 'invite', label: 'Send an invitation email (recommended)' },
                            { value: 'password', label: 'I will set a password myself' },
                        ]}
                        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                    />
                </Form.Item>
                <Form.Item noStyle shouldUpdate={(p, c) => p.method !== c.method}>
                    {({ getFieldValue }) =>
                        getFieldValue('method') === 'password' ? (
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
                        ) : (
                            <Typography.Paragraph type="secondary">
                                They receive an email with a link to choose their own password. The link works once and expires in 3 days.
                            </Typography.Paragraph>
                        )
                    }
                </Form.Item>
            </Form>
        </Modal>
    );
}

type EditValues = { name: string; role: Role; managerId?: string | null; defaultApproverId?: string | null; employeeCode?: string; mobile?: string; verticalIds?: string[] };

function EditUserModal({
    user,
    isSelf,
    people,
    busy,
    onSave,
    onCancel,
}: {
    user: UserRow;
    isSelf: boolean;
    people: { value: string; label: string }[];
    busy: boolean;
    onSave: (v: EditValues) => void;
    onCancel: () => void;
}) {
    const [form] = Form.useForm<EditValues>();
    const verticals = useSimple('verticals', false);
    const role = Form.useWatch('role', form);
    return (
        <Modal open title="Edit user" okText="Save" confirmLoading={busy} onOk={() => form.submit()} onCancel={onCancel} destroyOnClose>
            <Typography.Paragraph type="secondary">{user.email}</Typography.Paragraph>
            <Form<EditValues>
                form={form}
                layout="vertical"
                initialValues={{
                    name: user.name,
                    role: user.role,
                    managerId: user.managerId ?? undefined,
                    defaultApproverId: user.defaultApproverId ?? undefined,
                    employeeCode: user.employeeCode ?? undefined,
                    mobile: user.mobile ?? undefined,
                    verticalIds: user.verticals.map((v) => v.id),
                }}
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
                <Form.Item label="Reporting manager" name="managerId" extra="Filled in as the manager on new documents they add.">
                    <Select allowClear showSearch optionFilterProp="label" placeholder="No manager" options={people.filter((p) => p.value !== user.id)} />
                </Form.Item>
                <Form.Item
                    label="Limited to verticals"
                    name="verticalIds"
                    extra={
                        role === 'ORG_ADMIN'
                            ? 'Admins are never limited.'
                            : 'For vendors: they see only documents, people and locations of these verticals. Leave empty for no limit.'
                    }
                >
                    <Select
                        mode="multiple"
                        allowClear
                        disabled={role === 'ORG_ADMIN'}
                        optionFilterProp="label"
                        placeholder="No limit"
                        options={(verticals.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
                    />
                </Form.Item>
                <Form.Item label="Default approver" name="defaultApproverId" extra="Filled in as the approver when compliances are assigned to this person. They give the final approval after the manager.">
                    <Select allowClear showSearch optionFilterProp="label" placeholder="No approver" options={people.filter((p) => p.value !== user.id)} />
                </Form.Item>
                <Row gutter={12}>
                    <Col span={12}>
                        <Form.Item label="User ID / employee code" name="employeeCode" rules={[{ max: 50 }]}>
                            <Input maxLength={50} />
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item label="Mobile" name="mobile" rules={[{ pattern: /^[+\d][\d\s-]{6,19}$/, message: 'Enter a valid phone number' }]}>
                            <Input maxLength={20} />
                        </Form.Item>
                    </Col>
                </Row>
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
    const [created, setCreated] = useState<Created | null>(null);
    const [uploading, setUploading] = useState(false);
    const [vendorAccess, setVendorAccess] = useState(false);
    const people = (q.data ?? []).filter((u) => u.isActive).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }));

    const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

    const create = async (v: NewValues) => {
        setBusy(true);
        try {
            const res = await api<CreateResponse>('/users', {
                method: 'POST',
                body: {
                    name: v.name,
                    email: v.email,
                    role: v.role,
                    ...(v.method === 'password' ? { password: v.password } : {}),
                },
            });
            setCreating(false);
            setCreated({
                email: v.email.toLowerCase(),
                password: v.method === 'password' ? v.password : undefined,
                invite: res.invite,
            });
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
        if ((v.managerId ?? null) !== editing.managerId) body.managerId = v.managerId ?? null;
        if ((v.defaultApproverId ?? null) !== editing.defaultApproverId) body.defaultApproverId = v.defaultApproverId ?? null;
        if ((v.employeeCode?.trim() || null) !== editing.employeeCode) body.employeeCode = v.employeeCode?.trim() || null;
        if ((v.mobile?.trim() || null) !== editing.mobile) body.mobile = v.mobile?.trim() || null;
        const ids = [...(v.verticalIds ?? [])].sort();
        if (ids.join() !== editing.verticals.map((x) => x.id).sort().join()) body.verticalIds = ids;
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

    const sendLink = async (row: UserRow, kind: 'invite' | 'reset-link') => {
        try {
            const res = await api<{ emailed: boolean }>(`/users/${row.id}/${kind}`, { method: 'POST' });
            if (res.emailed) notify.success(kind === 'invite' ? 'Invitation sent' : 'Reset link sent');
            else notify.warning('The email could not be sent. Try again later.');
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
        { title: 'Manager', key: 'manager', render: (_, r) => r.manager?.name ?? '' },
        { title: 'Approver', key: 'approver', render: (_, r) => r.defaultApprover?.name ?? '' },
        {
            title: 'Access',
            key: 'access',
            width: 150,
            render: (_, r) =>
                r.role === 'ORG_ADMIN' || r.verticals.length === 0 ? (
                    <Typography.Text type="secondary">All</Typography.Text>
                ) : (
                    r.verticals.map((v) => <Tag key={v.id}>{v.name}</Tag>)
                ),
        },
        { title: 'User ID', key: 'code', width: 90, render: (_, r) => r.employeeCode ?? '' },
        { title: 'Role', key: 'role', render: (_, r) => <Tag color={ROLE_COLOR[r.role]}>{ROLE_LABEL[r.role]}</Tag> },
        {
            title: 'Status',
            key: 'status',
            render: (_, r) => (
                <Space size={4} wrap>
                    {r.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>}
                    {r.passwordSetAt === null && <Tag color="gold">Invited</Tag>}
                    {isLocked(r) && <Tag color="red">Locked</Tag>}
                </Space>
            ),
        },
        {
            title: 'Last sign-in',
            key: 'last',
            render: (_, r) => (r.lastLoginAt ? formatDateTime(r.lastLoginAt) : 'Never'),
        },
        {
            title: '',
            key: 'actions',
            width: 430,
            render: (_, r) => (
                <Space wrap>
                    <Button size="small" onClick={() => setEditing(r)}>
                        Edit
                    </Button>
                    {r.isActive && r.passwordSetAt === null && (
                        <Button size="small" onClick={() => void sendLink(r, 'invite')}>
                            Resend invite
                        </Button>
                    )}
                    {r.isActive && r.passwordSetAt !== null && r.id !== me?.id && (
                        <Popconfirm
                            title="Send a password reset link?"
                            description={`An email goes to ${r.email}. The link works once and expires in 1 hour.`}
                            okText="Send"
                            onConfirm={() => void sendLink(r, 'reset-link')}
                        >
                            <Button size="small">Send reset link</Button>
                        </Popconfirm>
                    )}
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
            <Space wrap>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                    New user
                </Button>
                <Button icon={<UploadOutlined />} onClick={() => setUploading(true)}>
                    Upload users (Excel)
                </Button>
                <Button icon={<SafetyOutlined />} onClick={() => setVendorAccess(true)}>
                    Limit vendors to their verticals
                </Button>
            </Space>

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
                scroll={{ x: 1600 }}
                pagination={{ pageSize: 25, hideOnSinglePage: true }}
            />
            {uploading && <UsersUploadModal onClose={() => setUploading(false)} />}
            {vendorAccess && <VendorAccessModal onClose={() => setVendorAccess(false)} />}
            {creating && <NewUserModal busy={busy} onSave={(v) => void create(v)} onCancel={() => setCreating(false)} />}
            {editing && (
                <EditUserModal
                    user={editing}
                    isSelf={editing.id === me?.id}
                    people={people}
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
                {created?.invite?.emailed && (
                    <Alert
                        type="success"
                        showIcon
                        message={`An invitation was sent to ${created.email}`}
                        description="The link works once and expires in 3 days. You can resend it from their row."
                    />
                )}
                {created?.invite && !created.invite.emailed && (
                    <Alert
                        type="warning"
                        showIcon
                        message="The user was created, but the invitation email could not be sent"
                        description="Use Resend invite on their row once email is working."
                    />
                )}
                {created?.password && (
                    <>
                        <Alert
                            type="warning"
                            showIcon
                            style={{ marginBottom: 12 }}
                            message="Copy this password now"
                            description="It cannot be shown again. Share it through a secure channel."
                        />
                        <div>Email: {created.email}</div>
                        <div>
                            Password:{' '}
                            <Typography.Text code copyable>
                                {created.password}
                            </Typography.Text>
                        </div>
                    </>
                )}
            </Modal>
        </Space>
    );
}