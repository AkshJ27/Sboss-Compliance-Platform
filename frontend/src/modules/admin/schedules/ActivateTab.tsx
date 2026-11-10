import { useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Form, Popconfirm, Result, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { fyStartYear } from '../../../core/filters';
import { titleCase } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { LoadWarning } from '../LoadWarning';
import { RemoteSelect } from '../RemoteSelect';
import type { Opt } from '../RemoteSelect';
import { RISK_COLOR, useEntities, useSimple, useUsers, userOptions } from '../api';
import type { Level } from '../api';

type FormValues = {
    entityId?: string;
    location?: Opt;
    departmentId?: string;
    verticalId?: string;
    ownerId?: string;
    managerId?: string;
    approverId?: string;
    startDate?: Dayjs;
    acts?: Opt[];
    compliances?: Opt[];
};

type SampleRow = { code: string; title: string; risk: Level; frequency: string };

type ActivateResult = {
    dryRun: boolean;
    location: string;
    selected: number;
    toActivate: number;
    alreadyActive: number;
    alreadyInactive: number;
    skippedWrongState: { act: string; count: number }[];
    unknownComplianceIds: string[];
    actsWithNoActiveCompliances: string[];
    highRisk: number;
    sample: SampleRow[];
    created: number;
};

function buildPayload(v: FormValues) {
    if (!v.entityId || !v.location || !v.ownerId || !v.managerId || !v.startDate) {
        throw new Error('Fill in all the required fields');
    }
    if (v.ownerId === v.managerId) throw new Error('Owner and manager must be different people');
    if (v.approverId && (v.approverId === v.ownerId || v.approverId === v.managerId)) {
        throw new Error('The approver must be a different person from the owner and manager');
    }
    const actIds = (v.acts ?? []).map((o) => o.value);
    const complianceIds = (v.compliances ?? []).map((o) => o.value);
    if (actIds.length + complianceIds.length === 0) throw new Error('Choose at least one Act or compliance');

    return {
        entityId: v.entityId,
        locationId: v.location.value,
        departmentId: v.departmentId,
        verticalId: v.verticalId,
        ownerId: v.ownerId,
        managerId: v.managerId,
        approverId: v.approverId,
        startDate: v.startDate.format('YYYY-MM-DD'),
        actIds,
        complianceIds,
    };
}
type Payload = ReturnType<typeof buildPayload>;

const loadActs = async (search: string, signal: AbortSignal): Promise<Opt[]> => {
    const res = await api<{ items: { id: string; name: string; state: string | null }[] }>(
        `/library/acts?limit=50&search=${encodeURIComponent(search)}`,
        { signal },
    );
    return res.items.map((a) => ({ value: a.id, label: a.state ? `${a.name} (${a.state})` : a.name }));
};

const loadCompliances = async (search: string, signal: AbortSignal): Promise<Opt[]> => {
    const res = await api<{ items: { id: string; code: string; title: string }[] }>(
        `/library/compliances?limit=50&search=${encodeURIComponent(search)}`,
        { signal },
    );
    return res.items.map((c) => ({ value: c.id, label: `${c.code}: ${c.title}` }));
};

export function ActivateTab({ onDone }: { onDone: () => void }) {
    const qc = useQueryClient();
    const [form] = Form.useForm<FormValues>();
    const entityId = Form.useWatch('entityId', form);

    const entities = useEntities(false);
    const departments = useSimple('departments', false);
    const verticals = useSimple('verticals', false);
    const users = useUsers();
    const people = userOptions(users.data);

    const [preview, setPreview] = useState<{ payload: Payload; result: ActivateResult } | null>(null);
    const [done, setDone] = useState<ActivateResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'preview' | 'activate'>(null);

    const loadLocations = async (search: string, signal: AbortSignal): Promise<Opt[]> => {
        const res = await api<{ items: { id: string; name: string; state: string }[] }>(
            `/masters/locations?entityId=${entityId ?? ''}&limit=50&search=${encodeURIComponent(search)}`,
            { signal },
        );
        return res.items.map((l) => ({ value: l.id, label: `${l.name}, ${l.state}` }));
    };

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
            const result = await api<ActivateResult>('/compliance/schedules/activate?dryRun=true', {
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

    const activate = async () => {
        if (!preview) return;
        setBusy('activate');
        setError(null);
        try {
            const result = await api<ActivateResult>('/compliance/schedules/activate?dryRun=false', {
                method: 'POST',
                body: preview.payload,
            });
            setDone(result);
            setPreview(null);
            await qc.invalidateQueries({ queryKey: ['schedules'] });
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

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

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <LoadWarning label="The entity list" error={entities.isError} onRetry={() => void entities.refetch()} />
            <LoadWarning label="The people list" error={users.isError} onRetry={() => void users.refetch()} />

            {done && (
                <Result
                    status="success"
                    title={`${done.created} compliance${done.created === 1 ? '' : 's'} activated at ${done.location}`}
                    subTitle="The dated items do not exist yet. Generate them next."
                    extra={[
                        <Button key="gen" type="primary" onClick={onDone}>
                            Generate the dated items
                        </Button>,
                        <Button key="more" onClick={() => setDone(null)}>
                            Activate more
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
                    if ('entityId' in changed) form.setFieldValue('location', undefined);
                }}
            >
                <Row gutter={16}>
                    <Col xs={24} md={12}>
                        <Form.Item label="Entity" name="entityId" rules={[{ required: true, message: 'Choose an entity' }]}>
                            <Select
                                showSearch
                                optionFilterProp="label"
                                placeholder="Choose an entity"
                                options={(entities.data ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item label="Location" name="location" rules={[{ required: true, message: 'Choose a location' }]}>
                            <RemoteSelect
                                cacheKey={`locations:${entityId ?? ''}`}
                                load={loadLocations}
                                disabled={!entityId}
                                placeholder={entityId ? 'Search locations' : 'Choose an entity first'}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item label="Department (optional)" name="departmentId">
                            <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item label="Vertical (optional)" name="verticalId">
                            <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                options={(verticals.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item label="Owner" name="ownerId" rules={[{ required: true, message: 'Choose an owner' }]}>
                            <Select showSearch optionFilterProp="label" options={people} placeholder="Does the work" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item label="Manager" name="managerId" rules={[{ required: true, message: 'Choose a manager' }]}>
                            <Select showSearch optionFilterProp="label" options={people} placeholder="Reviews the work" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item label="Approver" name="approverId" extra="Required when any chosen item is high risk.">
                            <Select allowClear showSearch optionFilterProp="label" options={people} placeholder="Final sign-off" />
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
                </Row>

                <Form.Item
                    label="Acts"
                    name="acts"
                    extra="Every active compliance under a chosen Act is activated. A state law only applies at a location in that state."
                >
                    <RemoteSelect multiple cacheKey="acts" load={loadActs} placeholder="Search Acts" />
                </Form.Item>
                <Form.Item label="Specific compliances (optional)" name="compliances" extra="Use this to pick single items instead of a whole Act.">
                    <RemoteSelect multiple cacheKey="compliances" load={loadCompliances} placeholder="Search by code or title" />
                </Form.Item>

                <Button type="primary" loading={busy === 'preview'} onClick={() => void runPreview()}>
                    Preview
                </Button>
            </Form>

            {error && <Alert type="error" showIcon message={error} />}

            {r && preview && (
                <Card size="small" title={`Preview for ${r.location}`}>
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        <Row gutter={[12, 12]}>
                            <Col xs={12} md={6}>
                                <Statistic title="Selected" value={r.selected} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Will be activated" value={r.toActivate} valueStyle={{ color: '#1d4e89' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Already active" value={r.alreadyActive} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="High risk" value={r.highRisk} />
                            </Col>
                        </Row>

                        {r.skippedWrongState.length > 0 && (
                            <Alert
                                type="warning"
                                showIcon
                                message="Skipped: these Acts belong to another state"
                                description={r.skippedWrongState.map((s) => `${s.act} × ${s.count}`).join(', ')}
                            />
                        )}
                        {r.alreadyInactive > 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message={`${r.alreadyInactive} were activated before and later deactivated. They stay inactive. Reactivate them on the Schedules tab.`}
                            />
                        )}
                        {r.unknownComplianceIds.length > 0 && (
                            <Alert type="warning" showIcon message={`${r.unknownComplianceIds.length} chosen compliance(s) were not found or are inactive.`} />
                        )}
                        {r.actsWithNoActiveCompliances.length > 0 && (
                            <Alert type="info" showIcon message={`${r.actsWithNoActiveCompliances.length} chosen Act(s) have no active compliances.`} />
                        )}

                        {r.sample.length > 0 && (
                            <div>
                                <Typography.Text type="secondary">
                                    {r.toActivate > r.sample.length ? `First ${r.sample.length} of ${r.toActivate}` : 'All items'}
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
                            title={`Activate ${r.toActivate} compliance${r.toActivate === 1 ? '' : 's'} at ${r.location}?`}
                            okText="Activate"
                            disabled={r.toActivate === 0}
                            onConfirm={() => void activate()}
                        >
                            <Button type="primary" disabled={r.toActivate === 0} loading={busy === 'activate'}>
                                {r.toActivate === 0 ? 'Nothing to activate' : `Activate ${r.toActivate}`}
                            </Button>
                        </Popconfirm>
                    </Space>
                </Card>
            )}
        </Space>
    );
}