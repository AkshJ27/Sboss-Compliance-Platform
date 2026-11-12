import { useState } from 'react';
import {
    Alert, Button, Card, Checkbox, Col, Form, Input, Popconfirm, Result, Row, Select, Space, Statistic, Switch, Table, Tag,
    Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../../core/api/client';
import { formatDate, titleCase } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { LoadWarning } from '../LoadWarning';
import { RemoteSelect } from '../RemoteSelect';
import type { Opt } from '../RemoteSelect';
import { useEntities, useUsers, userOptions } from '../api';
import { loadLocationOptions, useRefreshAfterBulk } from './api';

type Role = 'OWNER' | 'MANAGER' | 'APPROVER';

type FormValues = {
    fromUserId?: string;
    toUserId?: string;
    roles: Role[];
    entityId?: string;
    location?: Opt;
    includeOpenItems: boolean;
    note?: string;
};

type SampleItem = {
    code: string;
    title: string;
    location: string;
    dueDate: string;
    status: string;
    roles: string[];
};
type SwapResult = {
    dryRun: boolean;
    from: string;
    to: string;
    roles: Role[];
    schedules: { matched: number; willMove: number; conflicts: number };
    items: {
        willMove: number;
        conflicts: number;
        blocked: number;
        byRole: { owner: number; manager: number; approver: number };
    };
    sampleItems: SampleItem[];
    schedulesMoved: number;
    itemsMoved: number;
};

const ROLE_OPTIONS = [
    { value: 'OWNER', label: 'Owner' },
    { value: 'MANAGER', label: 'Manager' },
    { value: 'APPROVER', label: 'Approver' },
];

function buildPayload(v: FormValues) {
    if (!v.fromUserId || !v.toUserId || !v.roles?.length) throw new Error('Fill in all the required fields');
    if (v.fromUserId === v.toUserId) throw new Error('Choose two different people');
    return {
        fromUserId: v.fromUserId,
        toUserId: v.toUserId,
        roles: v.roles,
        ...(v.entityId ? { entityId: v.entityId } : {}),
        ...(v.location ? { locationId: v.location.value } : {}),
        includeOpenItems: v.includeOpenItems,
        ...(v.note?.trim() ? { note: v.note.trim() } : {}),
    };
}
type Payload = ReturnType<typeof buildPayload>;

export function SwapTab() {
    const navigate = useNavigate();
    const refresh = useRefreshAfterBulk();
    const [form] = Form.useForm<FormValues>();
    const fromUserId = Form.useWatch('fromUserId', form);
    const entityId = Form.useWatch('entityId', form);

    const users = useUsers();
    const entities = useEntities(true);

    // Everyone can be replaced, including people who left or were made viewers, since they may still hold work
    const fromOptions = (users.data ?? []).map((u) => ({
        value: u.id,
        label: `${u.name} (${u.email})${!u.isActive ? ' - inactive' : u.role === 'VIEWER' ? ' - viewer' : ''}`,
    }));
    const toOptions = userOptions(users.data).filter((o) => o.value !== fromUserId);

    const [preview, setPreview] = useState<{ payload: Payload; result: SwapResult } | null>(null);
    const [done, setDone] = useState<SwapResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'preview' | 'swap'>(null);

    const runPreview = async () => {
        setError(null);
        setDone(null);
        let values: FormValues;
        try {
            values = await form.validateFields();
        } catch {
            return; // the form shows what is missing
        }
        let payload: Payload;
        try {
            payload = buildPayload(values);
        } catch (e) {
            setError((e as Error).message);
            return;
        }
        setBusy('preview');
        try {
            const result = await api<SwapResult>('/compliance/bulk/swap?dryRun=true', { method: 'POST', body: payload });
            setPreview({ payload, result });
        } catch (e) {
            setPreview(null);
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const swap = async () => {
        if (!preview) return;
        setBusy('swap');
        setError(null);
        try {
            const result = await api<SwapResult>('/compliance/bulk/swap?dryRun=false', {
                method: 'POST',
                body: preview.payload,
            });
            setDone(result);
            setPreview(null);
            await refresh();
        } catch (e) {
            setError(errorText(e));
            // The records changed since the preview, and the server changed nothing. Preview again.
            if (e instanceof ApiError && e.status === 409) setPreview(null);
        } finally {
            setBusy(null);
        }
    };

    const columns: TableProps<SampleItem>['columns'] = [
        {
            title: 'Compliance',
            key: 'c',
            render: (_, r) => (
                <div>
                    <div>{r.title}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.code}
                    </Typography.Text>
                </div>
            ),
        },
        { title: 'Location', dataIndex: 'location', key: 'location', width: 180 },
        { title: 'Due date', key: 'due', width: 120, render: (_, r) => formatDate(r.dueDate) },
        { title: 'Status', key: 'status', width: 150, render: (_, r) => titleCase(r.status) },
        {
            title: 'Moves as',
            key: 'roles',
            width: 190,
            render: (_, r) => (
                <Space size={4} wrap>
                    {r.roles.map((role) => (
                        <Tag key={role}>{titleCase(role)}</Tag>
                    ))}
                </Space>
            ),
        },
    ];

    const r = preview?.result;
    const skipped = r ? r.schedules.conflicts + r.items.conflicts : 0;
    const nothing = r ? r.schedules.willMove === 0 && r.items.willMove === 0 : false;

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <LoadWarning label="The people list" error={users.isError} onRetry={() => void users.refetch()} />
            <LoadWarning label="The entity list" error={entities.isError} onRetry={() => void entities.refetch()} />

            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Moves one person&apos;s work to another, for example when someone leaves. Schedules move so that future items go to the
                new person, and open items can move too. Anything already approved, closed or not applicable is never changed.
            </Typography.Paragraph>

            {done && (
                <Result
                    status="success"
                    title={`${done.schedulesMoved} schedule${done.schedulesMoved === 1 ? '' : 's'} and ${done.itemsMoved} open item${done.itemsMoved === 1 ? '' : 's'} moved`}
                    subTitle={`From ${done.from} to ${done.to}. ${done.to} has been notified, and each moved item shows the change in its history.`}
                    extra={[
                        <Button key="records" type="primary" onClick={() => navigate('/records')}>
                            Open the records
                        </Button>,
                        <Button key="again" onClick={() => setDone(null)}>
                            Do another swap
                        </Button>,
                    ]}
                />
            )}

            <Form<FormValues>
                form={form}
                layout="vertical"
                initialValues={{ roles: ['OWNER', 'MANAGER', 'APPROVER'], includeOpenItems: true }}
                onValuesChange={(changed: Partial<FormValues>) => {
                    setPreview(null);
                    setDone(null);
                    setError(null);
                    if ('entityId' in changed) form.setFieldValue('location', undefined);
                    if (changed.fromUserId && form.getFieldValue('toUserId') === changed.fromUserId) {
                        form.setFieldValue('toUserId', undefined);
                    }
                }}
            >
                <Row gutter={16}>
                    <Col xs={24} md={12}>
                        <Form.Item
                            label="Replace this person"
                            name="fromUserId"
                            extra="People who left or were made viewers are listed too."
                            rules={[{ required: true, message: 'Choose the person to replace' }]}
                        >
                            <Select
                                showSearch
                                optionFilterProp="label"
                                loading={users.isLoading}
                                options={fromOptions}
                                placeholder="Choose a person"
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item
                            label="With this person"
                            name="toUserId"
                            extra="Only active people who are not viewers can take work."
                            rules={[{ required: true, message: 'Choose who takes over' }]}
                        >
                            <Select
                                showSearch
                                optionFilterProp="label"
                                loading={users.isLoading}
                                options={toOptions}
                                placeholder="Choose a person"
                            />
                        </Form.Item>
                    </Col>
                </Row>

                <Form.Item
                    label="Move their work as"
                    name="roles"
                    rules={[{ required: true, message: 'Choose at least one role' }]}
                >
                    <Checkbox.Group options={ROLE_OPTIONS} />
                </Form.Item>

                <Row gutter={16}>
                    <Col xs={24} md={12}>
                        <Form.Item label="Only in this entity (optional)" name="entityId">
                            <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                loading={entities.isLoading}
                                placeholder="Everywhere"
                                options={(entities.data ?? []).map((e) => ({
                                    value: e.id,
                                    label: e.isActive ? e.name : `${e.name} (inactive)`,
                                }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item label="Only at this location (optional)" name="location">
                            <RemoteSelect
                                cacheKey={`swap-locations:${entityId ?? ''}`}
                                load={(search, signal) =>
                                    loadLocationOptions(search, signal, { entityId: entityId || undefined, includeInactive: true })
                                }
                                placeholder="Everywhere"
                            />
                        </Form.Item>
                    </Col>
                </Row>

                <Form.Item
                    label="Also move open items"
                    name="includeOpenItems"
                    valuePropName="checked"
                    extra="Off: only schedules change, so existing items stay with the old person and only new items go to the new person."
                >
                    <Switch />
                </Form.Item>
                <Form.Item label="Note (optional, kept in each item's history)" name="note">
                    <Input.TextArea rows={2} maxLength={500} showCount />
                </Form.Item>

                <Typography.Paragraph type="secondary">
                    Which items move: the owner on items that are due or returned, the manager also while an item waits for the
                    manager&apos;s review, and the approver at any open stage.
                </Typography.Paragraph>

                <Button type="primary" loading={busy === 'preview'} onClick={() => void runPreview()}>
                    Preview
                </Button>
            </Form>

            {error && <Alert type="error" showIcon message={error} />}

            {r && preview && (
                <Card size="small" title={`Preview: ${r.from} to ${r.to}`}>
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        <Row gutter={[12, 12]}>
                            <Col xs={12} md={6}>
                                <Statistic title="Schedules that move" value={r.schedules.willMove} valueStyle={{ color: '#1d4e89' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Open items that move" value={r.items.willMove} valueStyle={{ color: '#1d4e89' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Skipped (two roles)" value={skipped} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Blocked (own work)" value={r.items.blocked} />
                            </Col>
                        </Row>

                        {r.items.willMove > 0 && (
                            <Space wrap>
                                <Typography.Text type="secondary">Items by role:</Typography.Text>
                                <Tag>Owner {r.items.byRole.owner}</Tag>
                                <Tag>Manager {r.items.byRole.manager}</Tag>
                                <Tag>Approver {r.items.byRole.approver}</Tag>
                            </Space>
                        )}

                        {nothing && (
                            <Alert
                                type="info"
                                showIcon
                                message="Nothing to move"
                                description={`${r.from} has nothing in the chosen roles${preview.payload.entityId || preview.payload.locationId ? ' in that entity or location' : ''}, or everything they hold would be skipped.`}
                            />
                        )}
                        {skipped > 0 && (
                            <Alert
                                type="warning"
                                showIcon
                                message={`${skipped} record(s) are skipped`}
                                description={`${r.to} would hold two roles on the same record, which is not allowed. Those stay with ${r.from}.`}
                            />
                        )}
                        {r.items.blocked > 0 && (
                            <Alert
                                type="warning"
                                showIcon
                                message={`${r.items.blocked} item(s) are blocked`}
                                description={`${r.to} submitted or approved these items, so they cannot also review them. Reassign them one by one from the record panel.`}
                            />
                        )}

                        {r.sampleItems.length > 0 && (
                            <div>
                                <Typography.Text type="secondary">
                                    {r.items.willMove > r.sampleItems.length
                                        ? `The first ${r.sampleItems.length} of ${r.items.willMove} items`
                                        : 'The items that would move'}
                                </Typography.Text>
                                <Table<SampleItem>
                                    size="small"
                                    rowKey={(row) => `${row.code}|${row.location}|${row.dueDate}`}
                                    columns={columns}
                                    dataSource={r.sampleItems}
                                    pagination={false}
                                    style={{ marginTop: 4 }}
                                />
                            </div>
                        )}

                        <Popconfirm
                            title={`Move ${r.schedules.willMove} schedule(s) and ${r.items.willMove} open item(s)?`}
                            description={`From ${r.from} to ${r.to}. This cannot be undone with one click: you would have to swap back.`}
                            okText="Move"
                            disabled={nothing}
                            onConfirm={() => void swap()}
                        >
                            <Button type="primary" disabled={nothing} loading={busy === 'swap'}>
                                {nothing ? 'Nothing to move' : 'Move the work'}
                            </Button>
                        </Popconfirm>
                    </Space>
                </Card>
            )}
        </Space>
    );
}