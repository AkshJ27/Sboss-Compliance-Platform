import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { titleCase } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { LoadWarning } from '../LoadWarning';
import { RISK_COLOR, useEntities, useUsers, userOptions } from '../api';
import type { Level } from '../api';

type Person = { id: string; name: string };
type ScheduleRow = {
    id: string;
    isActive: boolean;
    ownerId: string;
    managerId: string;
    approverId: string | null;
    compliance: {
        code: string;
        title: string;
        risk: Level;
        frequency: string;
        act: { name: string; state: string | null };
    };
    entity: { id: string; name: string; code: string };
    location: { id: string; name: string; state: string };
    owner: Person;
    manager: Person;
    approver: Person | null;
};
type SchedulePage = { items: ScheduleRow[]; total: number };

type PeopleValues = { ownerId: string; managerId: string; approverId?: string; applyToOpenInstances: boolean };

type ModalProps = {
    row: ScheduleRow;
    options: { value: string; label: string }[];
    busy: boolean;
    onSave: (v: PeopleValues) => void;
    onCancel: () => void;
};

function PeopleModal({ row, options, busy, onSave, onCancel }: ModalProps) {
    const [form] = Form.useForm<PeopleValues>();
    const highRisk = row.compliance.risk === 'HIGH';
    return (
        <Modal
            open
            title="Change the people on this schedule"
            okText="Save"
            confirmLoading={busy}
            onOk={() => form.submit()}
            onCancel={onCancel}
            destroyOnClose
        >
            <Typography.Paragraph type="secondary">
                {row.compliance.code}: {row.compliance.title} at {row.location.name}
            </Typography.Paragraph>
            <Form<PeopleValues>
                form={form}
                layout="vertical"
                initialValues={{
                    ownerId: row.ownerId,
                    managerId: row.managerId,
                    approverId: row.approverId ?? undefined,
                    applyToOpenInstances: true,
                }}
                onFinish={onSave}
            >
                <Form.Item label="Owner" name="ownerId" rules={[{ required: true }]}>
                    <Select showSearch optionFilterProp="label" options={options} />
                </Form.Item>
                <Form.Item label="Manager" name="managerId" rules={[{ required: true }]}>
                    <Select showSearch optionFilterProp="label" options={options} />
                </Form.Item>
                <Form.Item
                    label={highRisk ? 'Approver (required for a high-risk item)' : 'Approver'}
                    name="approverId"
                    rules={highRisk ? [{ required: true, message: 'A high-risk item needs an approver' }] : []}
                >
                    <Select allowClear={!highRisk} showSearch optionFilterProp="label" options={options} placeholder="No approver" />
                </Form.Item>
                <Form.Item name="applyToOpenInstances" valuePropName="checked">
                    <Checkbox>Also move items that are still due or returned</Checkbox>
                </Form.Item>
            </Form>
        </Modal>
    );
}

export function SchedulesListTab() {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
    const [entityId, setEntityId] = useState<string | undefined>();
    const [ownerId, setOwnerId] = useState<string | undefined>();
    const [managerId, setManagerId] = useState<string | undefined>();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [editing, setEditing] = useState<ScheduleRow | null>(null);
    const [busy, setBusy] = useState(false);

    const entities = useEntities(true);
    const users = useUsers();
    const people = userOptions(users.data);

    const params = new URLSearchParams({ status, page: String(page), limit: String(limit) });
    if (entityId) params.set('entityId', entityId);
    if (ownerId) params.set('ownerId', ownerId);
    if (managerId) params.set('managerId', managerId);
    if (search) params.set('search', search);
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['schedules', qs],
        queryFn: ({ signal }) => api<SchedulePage>(`/compliance/schedules?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const reset = () => setPage(1);
    const refresh = () => qc.invalidateQueries({ queryKey: ['schedules'] });

    const savePeople = async (v: PeopleValues) => {
        if (!editing) return;
        const body: Record<string, unknown> = {};
        if (v.ownerId !== editing.ownerId) body.ownerId = v.ownerId;
        if (v.managerId !== editing.managerId) body.managerId = v.managerId;
        if ((v.approverId ?? null) !== editing.approverId) body.approverId = v.approverId ?? null;
        if (Object.keys(body).length === 0) {
            notify.info('Nothing was changed');
            return;
        }
        body.applyToOpenInstances = v.applyToOpenInstances;

        setBusy(true);
        try {
            const res = await api<{ reassignedInstances: number }>(`/compliance/schedules/${editing.id}`, {
                method: 'PATCH',
                body,
            });
            notify.success(`Saved. ${res.reassignedInstances} open item(s) moved to the new people.`);
            setEditing(null);
            await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['records'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const toggle = async (row: ScheduleRow) => {
        try {
            await api(`/compliance/schedules/${row.id}`, { method: 'PATCH', body: { isActive: !row.isActive } });
            notify.success(row.isActive ? 'Deactivated' : 'Activated');
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<ScheduleRow>['columns'] = [
        {
            title: 'Compliance',
            key: 'c',
            width: 320,
            render: (_, r) => (
                <div>
                    <div>{r.compliance.title}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.compliance.code}
                    </Typography.Text>
                </div>
            ),
        },
        {
            title: 'Act',
            key: 'act',
            width: 240,
            render: (_, r) => (r.compliance.act.state ? `${r.compliance.act.name} (${r.compliance.act.state})` : r.compliance.act.name),
        },
        { title: 'Location', key: 'loc', width: 220, render: (_, r) => `${r.entity.code} / ${r.location.name}` },
        { title: 'Owner', key: 'o', width: 140, render: (_, r) => r.owner.name },
        { title: 'Manager', key: 'm', width: 140, render: (_, r) => r.manager.name },
        { title: 'Approver', key: 'a', width: 140, render: (_, r) => r.approver?.name ?? '' },
        {
            title: 'Risk',
            key: 'risk',
            width: 90,
            render: (_, r) => <Tag color={RISK_COLOR[r.compliance.risk]}>{titleCase(r.compliance.risk)}</Tag>,
        },
        { title: 'Periodicity', key: 'f', width: 120, render: (_, r) => titleCase(r.compliance.frequency) },
        {
            title: 'Status',
            key: 's',
            width: 100,
            render: (_, r) => (r.isActive ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>),
        },
        {
            title: '',
            key: 'x',
            width: 210,
            fixed: 'right',
            render: (_, r) => (
                <Space>
                    <Button size="small" onClick={() => setEditing(r)}>
                        People
                    </Button>
                    <Popconfirm
                        title={r.isActive ? 'Deactivate this schedule?' : 'Activate this schedule?'}
                        description={r.isActive ? 'No new items are generated. Existing items are not changed.' : undefined}
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
            <LoadWarning label="The entity list" error={entities.isError} onRetry={() => void entities.refetch()} />
            <LoadWarning label="The people list" error={users.isError} onRetry={() => void users.refetch()} />

            <Space wrap>
                <Segmented
                    value={status}
                    onChange={(v) => {
                        setStatus(v as typeof status);
                        reset();
                    }}
                    options={[
                        { label: 'Active', value: 'active' },
                        { label: 'Inactive', value: 'inactive' },
                        { label: 'All', value: 'all' },
                    ]}
                />
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="All entities"
                    style={{ width: 220 }}
                    options={(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))}
                    onChange={(v: string | undefined) => {
                        setEntityId(v);
                        reset();
                    }}
                />
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Any owner"
                    style={{ width: 200 }}
                    options={people}
                    onChange={(v: string | undefined) => {
                        setOwnerId(v);
                        reset();
                    }}
                />
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Any manager"
                    style={{ width: 200 }}
                    options={people}
                    onChange={(v: string | undefined) => {
                        setManagerId(v);
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
            </Space>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The schedules could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<ScheduleRow>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                scroll={{ x: 1700 }}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (t) => `${t} schedules`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />

            {editing && (
                <PeopleModal
                    row={editing}
                    options={people}
                    busy={busy}
                    onSave={(v) => void savePeople(v)}
                    onCancel={() => setEditing(null)}
                />
            )}
        </Space>
    );
}