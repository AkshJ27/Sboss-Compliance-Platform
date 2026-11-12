import { useState } from 'react';
import {
    Alert, Button, Card, Col, DatePicker, Form, Popconfirm, Result, Row, Select, Space, Statistic, Table, Tag, Typography,
} from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../core/api/client';
import { fyStartYear } from '../../../core/filters';
import { formatDate, titleCase } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { LoadWarning } from '../LoadWarning';
import { RemoteSelect } from '../RemoteSelect';
import type { Opt } from '../RemoteSelect';
import { RISK_COLOR, useSimple, useUsers, userOptions } from '../api';
import type { Level } from '../api';
import { loadActOptions, loadLocationOptions, useRefreshAfterBulk } from './api';

type FormValues = {
    source?: Opt;
    targets?: Opt[];
    startDate?: Dayjs;
    acts?: Opt[];
    departmentId?: string;
    verticalId?: string;
    ownerId?: string;
    managerId?: string;
    approverId?: string;
};

type TargetRow = {
    location: string;
    state: string;
    toCreate: number;
    alreadyActive: number;
    alreadyInactive: number;
    skippedWrongState: { act: string; count: number }[];
};
type SampleRow = { code: string; title: string; risk: Level; frequency: string };
type ReplicateResult = {
    dryRun: boolean;
    source: string;
    toCreate: number;
    alreadyActive: number;
    alreadyInactive: number;
    highRisk: number;
    sourceBehindLibrary: number;
    sample: SampleRow[];
    targets: TargetRow[];
    created: number;
};

function buildPayload(v: FormValues) {
    if (!v.source || !v.targets?.length || !v.startDate) throw new Error('Fill in all the required fields');
    if (v.ownerId && v.managerId && v.ownerId === v.managerId) {
        throw new Error('Owner and manager must be different people');
    }
    if (v.approverId && (v.approverId === v.ownerId || v.approverId === v.managerId)) {
        throw new Error('The approver must be a different person from the owner and manager');
    }
    const actIds = (v.acts ?? []).map((o) => o.value);
    return {
        sourceLocationId: v.source.value,
        targetLocationIds: v.targets.map((o) => o.value),
        startDate: v.startDate.format('YYYY-MM-DD'),
        ...(actIds.length ? { actIds } : {}),
        ...(v.departmentId ? { departmentId: v.departmentId } : {}),
        ...(v.verticalId ? { verticalId: v.verticalId } : {}),
        ...(v.ownerId ? { ownerId: v.ownerId } : {}),
        ...(v.managerId ? { managerId: v.managerId } : {}),
        ...(v.approverId ? { approverId: v.approverId } : {}),
    };
}
type Payload = ReturnType<typeof buildPayload>;

export function ReplicateTab() {
    const navigate = useNavigate();
    const refresh = useRefreshAfterBulk();
    const [form] = Form.useForm<FormValues>();
    const source = Form.useWatch('source', form);

    const departments = useSimple('departments', false);
    const verticals = useSimple('verticals', false);
    const users = useUsers();
    const people = userOptions(users.data);

    const [preview, setPreview] = useState<{ payload: Payload; result: ReplicateResult } | null>(null);
    const [done, setDone] = useState<ReplicateResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'preview' | 'create'>(null);

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
            const result = await api<ReplicateResult>('/compliance/bulk/replicate?dryRun=true', {
                method: 'POST',
                body: payload,
            });
            setPreview({ payload, result });
        } catch (e) {
            setPreview(null);
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const create = async () => {
        if (!preview) return;
        setBusy('create');
        setError(null);
        try {
            const result = await api<ReplicateResult>('/compliance/bulk/replicate?dryRun=false', {
                method: 'POST',
                body: preview.payload,
            });
            setDone(result);
            setPreview(null);
            await refresh();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const targetColumns: TableProps<TargetRow>['columns'] = [
        { title: 'Target location', dataIndex: 'location', key: 'location' },
        { title: 'State', dataIndex: 'state', key: 'state', width: 150 },
        { title: 'Will be created', dataIndex: 'toCreate', key: 'toCreate', width: 130 },
        { title: 'Already active', dataIndex: 'alreadyActive', key: 'alreadyActive', width: 130 },
        { title: 'Already inactive', dataIndex: 'alreadyInactive', key: 'alreadyInactive', width: 140 },
        {
            title: 'State laws skipped',
            key: 'skipped',
            width: 150,
            render: (_, t) => {
                const n = t.skippedWrongState.reduce((sum, s) => sum + s.count, 0);
                return n > 0 ? <Tag color="orange">{n}</Tag> : '';
            },
        },
    ];

    const sampleColumns: TableProps<SampleRow>['columns'] = [
        { title: 'Code', dataIndex: 'code', key: 'code', width: 130 },
        { title: 'Compliance', dataIndex: 'title', key: 'title' },
        {
            title: 'Risk',
            key: 'risk',
            width: 90,
            render: (_, r) => <Tag color={RISK_COLOR[r.risk]}>{titleCase(r.risk)}</Tag>,
        },
        { title: 'Periodicity', key: 'freq', width: 130, render: (_, r) => titleCase(r.frequency) },
    ];

    const r = preview?.result;
    const anySkipped = r?.targets.some((t) => t.skippedWrongState.length > 0) ?? false;

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <LoadWarning label="The people list" error={users.isError} onRetry={() => void users.refetch()} />

            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Copies the active schedules of one location to other locations, for example when you open a new branch. The copies
                follow the law as it is in the library today. This creates schedules only: generate the dated items afterwards.
            </Typography.Paragraph>

            {done && (
                <Result
                    status="success"
                    title={`${done.created} schedule${done.created === 1 ? '' : 's'} created`}
                    subTitle="The dated items do not exist yet. Open Setup, Schedules and use the Generate items tab."
                    extra={[
                        <Button key="open" type="primary" onClick={() => navigate('/admin/schedules')}>
                            Open Schedules
                        </Button>,
                        <Button key="again" onClick={() => setDone(null)}>
                            Copy another location
                        </Button>,
                    ]}
                />
            )}

            <Form<FormValues>
                form={form}
                layout="vertical"
                initialValues={{ startDate: dayjs(`${fyStartYear()}-04-01`) }}
                onValuesChange={(changed: Partial<FormValues>) => {
                    setPreview(null);
                    setDone(null);
                    setError(null);
                    // The source cannot also be a target
                    const chosen = changed.source?.value;
                    if (chosen) {
                        const targets = form.getFieldValue('targets') as Opt[] | undefined;
                        if (targets?.some((t) => t.value === chosen)) {
                            form.setFieldValue('targets', targets.filter((t) => t.value !== chosen));
                        }
                    }
                }}
            >
                <Row gutter={16}>
                    <Col xs={24} md={12}>
                        <Form.Item
                            label="Copy from"
                            name="source"
                            extra="The location whose active schedules are copied."
                            rules={[{ required: true, message: 'Choose the source location' }]}
                        >
                            <RemoteSelect
                                cacheKey="replicate-source"
                                load={(search, signal) => loadLocationOptions(search, signal)}
                                placeholder="Search locations"
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item
                            label="Copy to"
                            name="targets"
                            extra="Up to 50 locations at a time. Inactive locations are not listed."
                            rules={[
                                { required: true, message: 'Choose at least one target location' },
                                { type: 'array', max: 50, message: 'Choose at most 50 locations at a time' },
                            ]}
                        >
                            <RemoteSelect
                                multiple
                                cacheKey={`replicate-targets:${source?.value ?? ''}`}
                                load={(search, signal) => loadLocationOptions(search, signal, { excludeId: source?.value })}
                                disabled={!source}
                                placeholder={source ? 'Search locations' : 'Choose the source first'}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item
                            label="Obligations apply from"
                            name="startDate"
                            extra="Periods that ended before this date are not generated."
                            rules={[{ required: true, message: 'Choose a start date' }]}
                        >
                            <DatePicker allowClear={false} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item
                            label="Only these Acts (optional)"
                            name="acts"
                            extra="Leave blank to copy everything the source has."
                        >
                            <RemoteSelect multiple cacheKey="replicate-acts" load={loadActOptions} placeholder="Search Acts" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item label="Department for the copies (optional)" name="departmentId">
                            <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                placeholder="Same as the source"
                                options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item label="Vertical for the copies (optional)" name="verticalId">
                            <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                placeholder="Same as the source"
                                options={(verticals.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
                            />
                        </Form.Item>
                    </Col>
                </Row>

                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                    People: leave these blank to copy each schedule&apos;s owner, manager and approver from the source. Choose someone
                    to use them for every copy instead.
                </Typography.Paragraph>
                <Row gutter={16}>
                    <Col xs={24} md={8}>
                        <Form.Item label="Owner (optional)" name="ownerId">
                            <Select allowClear showSearch optionFilterProp="label" options={people} placeholder="Same as the source" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item label="Manager (optional)" name="managerId">
                            <Select allowClear showSearch optionFilterProp="label" options={people} placeholder="Same as the source" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item label="Approver (optional)" name="approverId">
                            <Select allowClear showSearch optionFilterProp="label" options={people} placeholder="Same as the source" />
                        </Form.Item>
                    </Col>
                </Row>

                <Button type="primary" loading={busy === 'preview'} onClick={() => void runPreview()}>
                    Preview
                </Button>
            </Form>

            {error && <Alert type="error" showIcon message={error} />}

            {r && preview && (
                <Card size="small" title={`Preview: copy from ${r.source}`}>
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        <Row gutter={[12, 12]}>
                            <Col xs={12} md={6}>
                                <Statistic title="Schedules to create" value={r.toCreate} valueStyle={{ color: '#1d4e89' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Already active" value={r.alreadyActive} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Already inactive" value={r.alreadyInactive} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="High-risk laws" value={r.highRisk} />
                            </Col>
                        </Row>

                        {r.toCreate === 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message="Nothing to create"
                                description="Every target already has these schedules, or no law applies at the targets."
                            />
                        )}
                        {anySkipped && (
                            <Alert
                                type="warning"
                                showIcon
                                message="Some state laws were skipped"
                                description="A state law is copied only to a location in the same state. Open a row below to see which ones."
                            />
                        )}
                        {r.sourceBehindLibrary > 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message={`${r.sourceBehindLibrary} of the laws being copied are on an older version at the source`}
                                description="The copies follow the current library rule, so they start up to date. Review the pending law changes if you want the source to catch up."
                            />
                        )}
                        {r.alreadyInactive > 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message={`${r.alreadyInactive} schedule(s) existed at a target before and were deactivated`}
                                description="They stay inactive. Reactivate them on the Schedules tab if you want them back."
                            />
                        )}

                        <Table<TargetRow>
                            size="small"
                            rowKey="location"
                            columns={targetColumns}
                            dataSource={r.targets}
                            pagination={{ pageSize: 10, hideOnSinglePage: true }}
                            expandable={{
                                rowExpandable: (t) => t.skippedWrongState.length > 0,
                                expandedRowRender: (t) => (
                                    <div>
                                        <Typography.Text type="secondary">
                                            Skipped here because this location is in {t.state}:
                                        </Typography.Text>
                                        <ul style={{ margin: '4px 0 0' }}>
                                            {t.skippedWrongState.map((s) => (
                                                <li key={s.act}>
                                                    {s.act}: {s.count}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ),
                            }}
                        />

                        {r.sample.length > 0 && (
                            <div>
                                <Typography.Text type="secondary">
                                    {r.sample.length < 20 ? 'The laws that would be copied' : 'The first 20 laws that would be copied'}
                                </Typography.Text>
                                <Table<SampleRow>
                                    size="small"
                                    rowKey="code"
                                    columns={sampleColumns}
                                    dataSource={r.sample}
                                    pagination={false}
                                    style={{ marginTop: 4 }}
                                />
                            </div>
                        )}

                        <Popconfirm
                            title={`Create ${r.toCreate} schedule${r.toCreate === 1 ? '' : 's'}?`}
                            description={`They start from ${formatDate(preview.payload.startDate)}. Nothing is generated until you generate the dated items.`}
                            okText="Create"
                            disabled={r.toCreate === 0}
                            onConfirm={() => void create()}
                        >
                            <Button type="primary" disabled={r.toCreate === 0} loading={busy === 'create'}>
                                {r.toCreate === 0 ? 'Nothing to create' : `Create ${r.toCreate}`}
                            </Button>
                        </Popconfirm>
                    </Space>
                </Card>
            )}
        </Space>
    );
}