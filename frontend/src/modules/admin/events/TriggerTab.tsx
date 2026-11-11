import { useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Form, Input, Popconfirm, Result, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../core/api/client';
import { formatDate, titleCase } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { LoadWarning } from '../LoadWarning';
import { RemoteSelect } from '../RemoteSelect';
import type { Opt } from '../RemoteSelect';
import { RISK_COLOR, useEntities } from '../api';
import type { Level } from '../api';

type FormValues = { entityId?: string; location?: Opt; event?: string; eventDate?: Dayjs; note?: string };
type Sample = { code: string; title: string; risk: Level; dueDate: string };
type EventOption = { event: string; items: number };
type Payload = { entityId: string; locationId: string; event: string; eventDate: string; note?: string };

type TriggerResult = {
    dryRun: boolean;
    location: string;
    event: string;
    eventDate: string;
    matched: number;
    toCreate: number;
    alreadyExist: number;
    skippedBeforeStart: number;
    skippedNoDueDays: number;
    firstDue: string | null;
    lastDue: string | null;
    sample: Sample[];
    created: number;
    triggerId: string | null;
};

function buildPayload(v: FormValues): Payload {
    if (!v.entityId || !v.location || !v.event || !v.eventDate) throw new Error('Fill in all the required fields');
    return {
        entityId: v.entityId,
        locationId: v.location.value,
        event: v.event,
        eventDate: v.eventDate.format('YYYY-MM-DD'),
        ...(v.note?.trim() ? { note: v.note.trim() } : {}),
    };
}

export function TriggerTab() {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const [form] = Form.useForm<FormValues>();
    const entityId = Form.useWatch('entityId', form);
    const location = Form.useWatch('location', form);
    const locationId = location?.value;

    const entities = useEntities(false);
    const options = useQuery({
        queryKey: ['events', 'options', locationId],
        enabled: !!locationId,
        queryFn: ({ signal }) => api<EventOption[]>(`/compliance/events/options?locationId=${locationId}`, { signal }),
    });

    const [preview, setPreview] = useState<{ payload: Payload; result: TriggerResult } | null>(null);
    const [done, setDone] = useState<{ result: TriggerResult; locationId: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'preview' | 'create'>(null);

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
            const result = await api<TriggerResult>('/compliance/events/trigger?dryRun=true', { method: 'POST', body: payload });
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
            const result = await api<TriggerResult>('/compliance/events/trigger?dryRun=false', {
                method: 'POST',
                body: preview.payload,
            });
            setDone({ result, locationId: preview.payload.locationId });
            setPreview(null);
            await Promise.all(
                ['records', 'dashboard', 'facets', 'documents', 'notifications', 'events'].map((key) =>
                    qc.invalidateQueries({ queryKey: [key] }),
                ),
            );
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const columns: TableProps<Sample>['columns'] = [
        { title: 'Code', dataIndex: 'code', key: 'code', width: 130 },
        { title: 'Compliance', dataIndex: 'title', key: 'title' },
        {
            title: 'Risk',
            key: 'risk',
            width: 90,
            render: (_, r) => <Tag color={RISK_COLOR[r.risk]}>{titleCase(r.risk)}</Tag>,
        },
        { title: 'Due date', key: 'due', width: 130, render: (_, r) => formatDate(r.dueDate) },
    ];

    const r = preview?.result;

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <LoadWarning label="The entity list" error={entities.isError} onRetry={() => void entities.refetch()} />

            {done && (
                <Result
                    status="success"
                    title={`${done.result.created} item${done.result.created === 1 ? '' : 's'} created for "${done.result.event}"`}
                    subTitle="They now appear on the Records page and the dashboard, and the owners have been notified."
                    extra={[
                        <Button key="open" type="primary" onClick={() => navigate(`/records?locationId=${done.locationId}`)}>
                            Open the records
                        </Button>,
                        <Button key="more" onClick={() => setDone(null)}>
                            Record another event
                        </Button>,
                    ]}
                />
            )}

            <Form<FormValues>
                form={form}
                layout="vertical"
                initialValues={{ eventDate: dayjs() }}
                onValuesChange={(changed: Partial<FormValues>) => {
                    setPreview(null);
                    setDone(null);
                    setError(null);
                    if ('entityId' in changed) {
                        form.setFieldValue('location', undefined);
                        form.setFieldValue('event', undefined);
                    }
                    if ('location' in changed) form.setFieldValue('event', undefined);
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
                                cacheKey={`event-locations:${entityId ?? ''}`}
                                load={loadLocations}
                                disabled={!entityId}
                                placeholder={entityId ? 'Search locations' : 'Choose an entity first'}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item label="Event" name="event" rules={[{ required: true, message: 'Choose the event' }]}>
                            <Select
                                showSearch
                                optionFilterProp="label"
                                disabled={!locationId}
                                loading={options.isFetching}
                                placeholder={locationId ? 'Choose the event' : 'Choose a location first'}
                                notFoundContent={
                                    options.isError
                                        ? 'The list could not be loaded'
                                        : 'No event-based compliances are active at this location'
                                }
                                options={(options.data ?? []).map((o) => ({
                                    value: o.event,
                                    label: `${o.event} (${o.items} item${o.items === 1 ? '' : 's'})`,
                                }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item
                            label="Date the event happened"
                            name="eventDate"
                            extra="Due dates are counted from this date. It cannot be in the future."
                            rules={[{ required: true, message: 'Choose the event date' }]}
                        >
                            <DatePicker allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                </Row>
                <Form.Item label="Note (optional)" name="note">
                    <Input.TextArea rows={2} maxLength={500} showCount />
                </Form.Item>

                <Button type="primary" loading={busy === 'preview'} onClick={() => void runPreview()}>
                    Preview
                </Button>
            </Form>

            {error && <Alert type="error" showIcon message={error} />}

            {r && preview && (
                <Card size="small" title={`Preview: ${r.event} at ${r.location} on ${formatDate(r.eventDate)}`}>
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        <Row gutter={[12, 12]}>
                            <Col xs={12} md={6}>
                                <Statistic title="Schedules that use this event" value={r.matched} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Will be created" value={r.toCreate} valueStyle={{ color: '#1d4e89' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Already recorded" value={r.alreadyExist} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Skipped" value={r.skippedBeforeStart + r.skippedNoDueDays} />
                            </Col>
                        </Row>

                        {r.firstDue && r.lastDue && (
                            <Typography.Text>
                                Due dates run from <b>{formatDate(r.firstDue)}</b> to <b>{formatDate(r.lastDue)}</b>.
                            </Typography.Text>
                        )}
                        {r.firstDue && r.firstDue < dayjs().format('YYYY-MM-DD') && (
                            <Alert
                                type="warning"
                                showIcon
                                message="Some of these items are already past their due date"
                                description="They will show as non compliance straight away, until the owner submits them."
                            />
                        )}
                        {r.skippedBeforeStart > 0 && (
                            <Alert
                                type="warning"
                                showIcon
                                message={`${r.skippedBeforeStart} schedule(s) were skipped because they start after the event date`}
                                description="Obligations apply from the date chosen when the schedule was activated."
                            />
                        )}
                        {r.skippedNoDueDays > 0 && (
                            <Alert
                                type="warning"
                                showIcon
                                message={`${r.skippedNoDueDays} compliance(s) have no "due days after event" in the library and were skipped`}
                            />
                        )}
                        {r.alreadyExist > 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message={`${r.alreadyExist} item(s) for this event and date already exist, so nothing is repeated.`}
                            />
                        )}

                        {r.sample.length > 0 && (
                            <Table<Sample>
                                size="small"
                                rowKey="code"
                                columns={columns}
                                dataSource={r.sample}
                                pagination={false}
                            />
                        )}

                        <Popconfirm
                            title={`Create ${r.toCreate} item${r.toCreate === 1 ? '' : 's'}?`}
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