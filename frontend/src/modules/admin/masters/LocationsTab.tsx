import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { errorText } from '../../../shared/errors';
import { LoadWarning } from '../LoadWarning';
import { useEntities, useSimple, useStates } from '../api';
import type { Entity, LocationPage, LocationRow, Simple } from '../api';
import { StatusFilter } from '../../../shared/StatusFilter';
import type { StatusFilterValue } from '../../../shared/StatusFilter';

type FormValues = {
    entityId?: string;
    locationTypeId?: string;
    name: string;
    state?: string;
    city?: string;
    address?: string;
};

type ModalProps = {
    initial: LocationRow | null;
    entities: Entity[];
    types: Simple[];
    states: string[];
    busy: boolean;
    onSave: (v: FormValues) => void;
    onCancel: () => void;
};

function LocationModal({ initial, entities, types, states, busy, onSave, onCancel }: ModalProps) {
    const [form] = Form.useForm<FormValues>();

    const entityOptions = initial
        ? [{ value: initial.entityId, label: initial.entity.name }]
        : entities.filter((e) => e.isActive).map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }));

    const typeOptions = types.filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name }));
    if (initial?.locationType && !typeOptions.some((o) => o.value === initial.locationType?.id)) {
        typeOptions.push({ value: initial.locationType.id, label: `${initial.locationType.name} (inactive)` });
    }

    return (
        <Modal
            open
            title={initial ? 'Edit location' : 'New location'}
            okText="Save"
            confirmLoading={busy}
            onOk={() => form.submit()}
            onCancel={onCancel}
            destroyOnClose
        >
            <Form<FormValues>
                form={form}
                layout="vertical"
                initialValues={{
                    entityId: initial?.entityId,
                    locationTypeId: initial?.locationTypeId ?? undefined,
                    name: initial?.name ?? '',
                    state: initial?.state,
                    city: initial?.city ?? '',
                    address: initial?.address ?? '',
                }}
                onFinish={(v) => onSave({ ...v, name: v.name.trim(), city: v.city?.trim(), address: v.address?.trim() })}
            >
                <Form.Item
                    label="Entity"
                    name="entityId"
                    rules={[{ required: true, message: 'Choose an entity' }]}
                    extra={initial ? 'A location cannot be moved to another entity.' : undefined}
                >
                    <Select showSearch optionFilterProp="label" disabled={!!initial} options={entityOptions} placeholder="Choose an entity" />
                </Form.Item>
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
                    label="State"
                    name="state"
                    rules={[{ required: true, message: 'Choose a state' }]}
                    extra={
                        initial
                            ? "Changing the state stops the old state's laws here. Central laws carry on."
                            : 'State laws apply only at locations in that state.'
                    }
                >
                    <Select
                        showSearch
                        optionFilterProp="label"
                        options={states.map((s) => ({ value: s, label: s }))}
                        placeholder="Choose a state"
                    />
                </Form.Item>
                <Form.Item label="Location type" name="locationTypeId">
                    <Select allowClear options={typeOptions} placeholder="Optional" />
                </Form.Item>
                <Form.Item label="City" name="city">
                    <Input maxLength={120} />
                </Form.Item>
                <Form.Item label="Address" name="address">
                    <Input.TextArea rows={2} maxLength={500} />
                </Form.Item>
            </Form>
        </Modal>
    );
}

export function LocationsTab() {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const [editing, setEditing] = useState<LocationRow | 'new' | null>(null);
    const [busy, setBusy] = useState(false);
    const [entityId, setEntityId] = useState<string | undefined>();
    const [state, setState] = useState<string | undefined>();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilterValue>('active');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);

    const entities = useEntities(true);
    const types = useSimple('location-types', true);
    const states = useStates();

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (entityId) params.set('entityId', entityId);
    if (state) params.set('state', state);
    if (search) params.set('search', search);
    params.set('status', status);
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['masters', 'locations', qs],
        queryFn: ({ signal }) => api<LocationPage>(`/masters/locations?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const refresh = () => qc.invalidateQueries({ queryKey: ['masters'] });

    const save = async (v: FormValues) => {
        setBusy(true);
        try {
            if (editing === 'new') {
                await api('/masters/locations', {
                    method: 'POST',
                    body: {
                        entityId: v.entityId,
                        name: v.name,
                        state: v.state,
                        ...(v.locationTypeId ? { locationTypeId: v.locationTypeId } : {}),
                        ...(v.city ? { city: v.city } : {}),
                        ...(v.address ? { address: v.address } : {}),
                    },
                });
                notify.success('Saved');
            } else if (editing) {
                const out = await api<{ stoppedSchedules?: number; removedItems?: number }>(`/masters/locations/${editing.id}`, {
                    method: 'PATCH',
                    body: {
                        name: v.name,
                        state: v.state,
                        locationTypeId: v.locationTypeId ?? null,
                        city: v.city || null,
                        address: v.address || null,
                    },
                });
                if (out.stoppedSchedules) {
                    notify.warning(
                        `Saved. ${out.stoppedSchedules} assignment(s) under ${editing.state} laws were stopped, since the location is now in ${v.state}${out.removedItems ? `, and ${out.removedItems} of their upcoming item(s) nobody had started were removed` : ''}. Add the ${v.state} laws from Schedules > Activate.`,
                        10,
                    );
                } else {
                    notify.success('Saved');
                }
            }
            setEditing(null);
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const toggle = async (row: LocationRow) => {
        try {
            await api(`/masters/locations/${row.id}`, { method: 'PATCH', body: { isActive: !row.isActive } });
            notify.success(row.isActive ? 'Deactivated' : 'Activated');
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<LocationRow>['columns'] = [
        { title: 'Location', dataIndex: 'name', key: 'name' },
        { title: 'Entity', key: 'entity', render: (_, r) => `${r.entity.name} (${r.entity.code})` },
        { title: 'State', dataIndex: 'state', key: 'state' },
        { title: 'City', key: 'city', render: (_, r) => r.city ?? '' },
        { title: 'Type', key: 'type', render: (_, r) => r.locationType?.name ?? '' },
        {
            title: 'Status',
            key: 'status',
            width: 100,
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
                        title={r.isActive ? 'Deactivate this location?' : 'Activate this location?'}
                        description={r.isActive ? 'No new items are generated here. Existing items are not changed.' : undefined}
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
            <LoadWarning label="The state list" error={states.isError} onRetry={() => void states.refetch()} />

            <Space wrap>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    disabled={!entities.data || !states.data}
                    onClick={() => setEditing('new')}
                >
                    New location
                </Button>
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="All entities"
                    style={{ width: 240 }}
                    value={entityId}
                    options={(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))}
                    onChange={(v: string | undefined) => {
                        setEntityId(v);
                        setPage(1);
                    }}
                />
                <Select
                    allowClear
                    showSearch
                    placeholder="All states"
                    style={{ width: 200 }}
                    value={state}
                    options={(states.data ?? []).map((s) => ({ value: s, label: s }))}
                    onChange={(v: string | undefined) => {
                        setState(v);
                        setPage(1);
                    }}
                />
                <Input.Search
                    allowClear
                    maxLength={100}
                    placeholder="Search by name or city"
                    style={{ width: 240 }}
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
                    message="The locations could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<LocationRow>
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
                    showTotal: (t) => `${t} locations`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />

            {editing && entities.data && states.data && (
                <LocationModal
                    initial={editing === 'new' ? null : editing}
                    entities={entities.data}
                    types={types.data ?? []}
                    states={states.data}
                    busy={busy}
                    onSave={(v) => void save(v)}
                    onCancel={() => setEditing(null)}
                />
            )}
        </Space>
    );
}