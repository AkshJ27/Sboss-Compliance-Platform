import { useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Popconfirm, Row, Select, Space, Statistic, Table, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { fyStartYear } from '../../../core/filters';
import { formatDate } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { LoadWarning } from '../LoadWarning';
import { useEntities } from '../api';

type GenResult = {
    dryRun: boolean;
    from: string;
    to: string;
    schedulesConsidered: number;
    eventBasedSkipped: number;
    candidates: number;
    alreadyExist: number;
    toCreate: number;
    firstDue: string | null;
    lastDue: string | null;
    byMonth: Record<string, number>;
    created: number;
};
type Payload = { from: string; to: string; entityId?: string };

export function GenerateTab() {
    const qc = useQueryClient();
    const entities = useEntities(false);
    const [range, setRange] = useState<[Dayjs, Dayjs]>([
        dayjs(`${fyStartYear()}-04-01`),
        dayjs(`${fyStartYear() + 1}-03-31`),
    ]);
    const [entityId, setEntityId] = useState<string | undefined>();
    const [preview, setPreview] = useState<{ payload: Payload; result: GenResult } | null>(null);
    const [done, setDone] = useState<GenResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'preview' | 'create'>(null);

    const clear = () => {
        setPreview(null);
        setDone(null);
        setError(null);
    };

    const runPreview = async () => {
        clear();
        const payload: Payload = {
            from: range[0].format('YYYY-MM-DD'),
            to: range[1].format('YYYY-MM-DD'),
            ...(entityId ? { entityId } : {}),
        };
        setBusy('preview');
        try {
            const result = await api<GenResult>('/compliance/instances/generate?dryRun=true', {
                method: 'POST',
                body: payload,
            });
            setPreview({ payload, result });
        } catch (e) {
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
            const result = await api<GenResult>('/compliance/instances/generate?dryRun=false', {
                method: 'POST',
                body: preview.payload,
            });
            setDone(result);
            setPreview(null);
            await Promise.all(
                ['records', 'dashboard', 'facets', 'documents', 'notifications'].map((key) =>
                    qc.invalidateQueries({ queryKey: [key] }),
                ),
            );
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const r = preview?.result;
    const monthRows = r
        ? Object.entries(r.byMonth).map(([month, count]) => ({ month, count }))
        : [];
    const today = dayjs().format('YYYY-MM-DD');

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <LoadWarning label="The entity list" error={entities.isError} onRetry={() => void entities.refetch()} />

            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Creates one item for every active schedule and period whose due date falls in the range. It is safe to run again: only the missing items are added.
            </Typography.Paragraph>

            <Space wrap>
                <DatePicker.RangePicker
                    allowClear={false}
                    value={range}
                    onChange={(v) => {
                        if (v?.[0] && v[1]) {
                            setRange([v[0], v[1]]);
                            clear();
                        }
                    }}
                />
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="All entities"
                    style={{ width: 260 }}
                    options={(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))}
                    onChange={(v: string | undefined) => {
                        setEntityId(v);
                        clear();
                    }}
                />
                <Button type="primary" loading={busy === 'preview'} onClick={() => void runPreview()}>
                    Preview
                </Button>
            </Space>

            {error && <Alert type="error" showIcon message={error} />}

            {done && (
                <Alert
                    type="success"
                    showIcon
                    message={`${done.created} item${done.created === 1 ? '' : 's'} created`}
                    description="They now appear on the Records page and the dashboard."
                />
            )}

            {r && preview && (
                <Card size="small" title={`Preview: due dates from ${formatDate(r.from)} to ${formatDate(r.to)}`}>
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        <Row gutter={[12, 12]}>
                            <Col xs={12} md={6}>
                                <Statistic title="Schedules considered" value={r.schedulesConsidered} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Already exist" value={r.alreadyExist} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Will be created" value={r.toCreate} valueStyle={{ color: '#1d4e89' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Event-based (skipped)" value={r.eventBasedSkipped} />
                            </Col>
                        </Row>

                        {r.firstDue && r.lastDue && (
                            <Typography.Text>
                                Due dates run from <b>{formatDate(r.firstDue)}</b> to <b>{formatDate(r.lastDue)}</b>.
                            </Typography.Text>
                        )}
                        {r.firstDue && r.firstDue < today && (
                            <Alert
                                type="warning"
                                showIcon
                                message="Some of these items are already past their due date"
                                description="They will show as non compliance straight away, until the owner submits them."
                            />
                        )}
                        {r.eventBasedSkipped > 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message="Event-based compliances start from a triggering event, not from the calendar. They are not generated here."
                            />
                        )}

                        {monthRows.length > 0 && (
                            <Table
                                size="small"
                                rowKey="month"
                                dataSource={monthRows}
                                pagination={false}
                                columns={[
                                    { title: 'Due month', dataIndex: 'month', key: 'month' },
                                    { title: 'Items', dataIndex: 'count', key: 'count', width: 100 },
                                ]}
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