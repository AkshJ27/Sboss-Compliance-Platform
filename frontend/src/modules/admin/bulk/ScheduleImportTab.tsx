import { useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Popconfirm, Row, Space, Statistic, Table, Tag, Typography, Upload } from 'antd';
import type { TableProps, UploadFile } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { apiDownload, apiRaw } from '../../../core/api/client';
import { formatDate, titleCase } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { RISK_COLOR } from '../api';
import type { Level } from '../api';
import { useRefreshAfterBulk } from './api';

type SampleRow = {
    row: number;
    location: string;
    code: string;
    title: string;
    risk: Level;
    owner: string;
    manager: string;
    startDate: string;
};
type Summary = {
    ok: true;
    dryRun: boolean;
    ignoredColumns: string[];
    totalRows: number;
    toCreate: number;
    alreadyActive: number;
    alreadyInactive: number;
    locations: number;
    compliances: number;
    highRisk: number;
    byLocation: { location: string; toCreate: number }[];
    sample: SampleRow[];
    created: number;
};
type RowError = { row: number; field?: string; message: string };
type Failure = { ok: false; errorCount: number; errors: RowError[]; ignoredColumns: string[] };
type Outcome = Summary | Failure;

// Type guards, so the screen never has to rely on TypeScript guessing which kind of result it has
const isFailure = (o: Outcome): o is Failure => o.ok === false;
const isSummary = (o: Outcome): o is Summary => o.ok === true;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function messageFrom(data: unknown, status: number): string {
    if (!isObject(data) || typeof data.error !== 'string') return `The import failed (${status})`;
    const details = data.details;
    if (Array.isArray(details) && details.length > 0) {
        const parts = details.flatMap((d) => {
            if (!isObject(d) || typeof d.message !== 'string') return [];
            return [typeof d.field === 'string' && d.field ? `${d.field}: ${d.message}` : d.message];
        });
        if (parts.length > 0) return `${data.error}. ${parts.join('; ')}`;
    }
    return data.error;
}

async function send(file: File, dryRun: boolean, startDate: string | null): Promise<Outcome> {
    const form = new FormData();
    form.append('file', file);
    const query = `dryRun=${dryRun}${startDate ? `&startDate=${startDate}` : ''}`;
    const res = await apiRaw(`/compliance/bulk/import?${query}`, { method: 'POST', form });

    let data: unknown = null;
    try {
        data = await res.json();
    } catch {
        // The reply was not JSON
    }

    if (res.status === 422 && isObject(data) && data.ok === false && Array.isArray(data.errors)) {
        return data as unknown as Failure;
    }
    if (res.ok && isObject(data) && data.ok === true) return data as unknown as Summary;
    throw new Error(messageFrom(data, res.status));
}

export function ScheduleImportTab() {
    const navigate = useNavigate();
    const refresh = useRefreshAfterBulk();
    const [file, setFile] = useState<File | null>(null);
    const [startDate, setStartDate] = useState<Dayjs | null>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'preview' | 'import'>(null);
    const [downloading, setDownloading] = useState(false);

    const defaultStart = startDate ? startDate.format('YYYY-MM-DD') : null;

    // One typed value for each kind of result. The screen below reads only these.
    const failure: Failure | null = outcome !== null && isFailure(outcome) ? outcome : null;
    const summary: Summary | null = outcome !== null && isSummary(outcome) ? outcome : null;
    const readyToImport = summary !== null && summary.dryRun && summary.toCreate > 0;

    const run = async (dryRun: boolean) => {
        if (!file) return;
        setError(null);
        setBusy(dryRun ? 'preview' : 'import');
        try {
            const result = await send(file, dryRun, defaultStart);
            setOutcome(result);
            if (isSummary(result) && !result.dryRun) await refresh();
        } catch (e) {
            setOutcome(null);
            setError(e instanceof Error ? e.message : 'The import failed');
        } finally {
            setBusy(null);
        }
    };

    const downloadTemplate = async () => {
        setDownloading(true);
        setError(null);
        try {
            await apiDownload('/compliance/bulk/import/template');
        } catch (e) {
            setError(errorText(e));
        } finally {
            setDownloading(false);
        }
    };

    const reset = () => {
        setOutcome(null);
        setError(null);
    };

    const fileList: UploadFile[] = file ? [{ uid: 'file', name: file.name, status: 'done' }] : [];

    const sampleColumns: TableProps<SampleRow>['columns'] = [
        { title: 'Row', dataIndex: 'row', key: 'row', width: 70 },
        { title: 'Location', dataIndex: 'location', key: 'location', width: 190 },
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
        {
            title: 'Risk',
            key: 'risk',
            width: 90,
            render: (_, r) => <Tag color={RISK_COLOR[r.risk]}>{titleCase(r.risk)}</Tag>,
        },
        { title: 'Owner', dataIndex: 'owner', key: 'owner', width: 140 },
        { title: 'Manager', dataIndex: 'manager', key: 'manager', width: 140 },
        { title: 'Starts', key: 'start', width: 120, render: (_, r) => formatDate(r.startDate) },
    ];

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Card size="small" title="Before you start">
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    <Typography.Paragraph style={{ margin: 0 }}>
                        Each row creates one schedule. Required columns: <b>entity</b>, <b>location</b>, <b>compliance code</b>,{' '}
                        <b>owner email</b> and <b>manager email</b>. Optional: <b>approver email</b> (required for high-risk laws),{' '}
                        <b>department</b>, <b>vertical</b> and <b>start date</b>.
                    </Typography.Paragraph>
                    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                        The entity can be its code or its name. The location is its name under that entity. People are found by their
                        email and must be active and not viewers. Dates can be YYYY-MM-DD or DD-MM-YYYY, with the day first. A state
                        law only works at a location in that state. Save the sheet as CSV UTF-8. If any row has a problem, nothing is
                        imported. Schedules that already exist are left alone, so running a file again is safe.
                    </Typography.Paragraph>
                    <Button
                        icon={<DownloadOutlined />}
                        loading={downloading}
                        onClick={() => void downloadTemplate()}
                        style={{ width: 'fit-content' }}
                    >
                        Download the template
                    </Button>
                </Space>
            </Card>

            <Space wrap align="start">
                <Upload
                    accept=".csv"
                    maxCount={1}
                    fileList={fileList}
                    beforeUpload={(f) => {
                        setFile(f);
                        reset();
                        return false;
                    }}
                    onRemove={() => {
                        setFile(null);
                        reset();
                    }}
                >
                    <Button icon={<UploadOutlined />}>Choose a CSV file</Button>
                </Upload>
                <div>
                    <DatePicker
                        value={startDate}
                        placeholder="Default start date (optional)"
                        onChange={(d) => {
                            setStartDate(d);
                            reset();
                        }}
                    />
                    <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            Used for rows that have no start date.
                        </Typography.Text>
                    </div>
                </div>
            </Space>

            <Space>
                <Button type="primary" disabled={!file} loading={busy === 'preview'} onClick={() => void run(true)}>
                    Preview (nothing is saved)
                </Button>
                {readyToImport && (
                    <Popconfirm
                        title="Import this file?"
                        description={`${summary?.toCreate ?? 0} schedule(s) will be created.`}
                        okText="Import"
                        onConfirm={() => void run(false)}
                    >
                        <Button type="primary" danger loading={busy === 'import'}>
                            Import now
                        </Button>
                    </Popconfirm>
                )}
            </Space>

            {error && <Alert type="error" showIcon message={error} />}

            {failure && (
                <Card
                    size="small"
                    title={`${failure.errorCount} problem${failure.errorCount === 1 ? '' : 's'} found. Nothing was imported.`}
                >
                    {failure.ignoredColumns.length > 0 && (
                        <Alert
                            type="info"
                            showIcon
                            style={{ marginBottom: 12 }}
                            message={`Columns that were not recognised and ignored: ${failure.ignoredColumns.join(', ')}`}
                        />
                    )}
                    <Table<RowError>
                        size="small"
                        rowKey={(r) => `${r.row}:${r.field ?? ''}:${r.message}`}
                        dataSource={failure.errors}
                        pagination={{ pageSize: 20, hideOnSinglePage: true }}
                        columns={[
                            { title: 'Row', dataIndex: 'row', key: 'row', width: 80 },
                            { title: 'Column', key: 'field', width: 160, render: (_, r) => r.field ?? '' },
                            { title: 'Problem', dataIndex: 'message', key: 'message' },
                        ]}
                    />
                    {failure.errorCount > failure.errors.length && (
                        <Typography.Text type="secondary">
                            Showing the first {failure.errors.length}. Fix these and preview again.
                        </Typography.Text>
                    )}
                    <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                        Row 1 is the first row under the header.
                    </Typography.Paragraph>
                </Card>
            )}

            {summary && (
                <Card size="small" title={summary.dryRun ? 'Preview: this is what the import would do' : 'Imported'}>
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                        {!summary.dryRun && (
                            <Alert
                                type="success"
                                showIcon
                                message={`${summary.created} schedule${summary.created === 1 ? '' : 's'} created`}
                                description="The dated items do not exist yet. Open Setup, Schedules and use the Generate items tab."
                                action={
                                    <Button size="small" onClick={() => navigate('/admin/schedules')}>
                                        Open Schedules
                                    </Button>
                                }
                            />
                        )}
                        {summary.ignoredColumns.length > 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message={`Columns that were not recognised and ignored: ${summary.ignoredColumns.join(', ')}`}
                            />
                        )}

                        <Row gutter={[12, 12]}>
                            <Col xs={12} md={6}>
                                <Statistic title="Rows" value={summary.totalRows} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Will be created" value={summary.toCreate} valueStyle={{ color: '#1d4e89' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Already active" value={summary.alreadyActive} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Already inactive" value={summary.alreadyInactive} />
                            </Col>
                        </Row>
                        <Typography.Text type="secondary">
                            {summary.toCreate} schedule(s) across {summary.locations} location(s) and {summary.compliances} law(s),{' '}
                            {summary.highRisk} of them high risk.
                        </Typography.Text>

                        {summary.dryRun && summary.toCreate === 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message="Nothing to import"
                                description="Every row matches a schedule that already exists."
                            />
                        )}
                        {summary.alreadyInactive > 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message={`${summary.alreadyInactive} schedule(s) existed before and were deactivated`}
                                description="They stay inactive. Reactivate them on the Schedules tab."
                            />
                        )}

                        {summary.byLocation.length > 1 && (
                            <Table
                                size="small"
                                rowKey="location"
                                dataSource={summary.byLocation}
                                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                                columns={[
                                    { title: 'Location', dataIndex: 'location', key: 'location' },
                                    { title: 'Schedules', dataIndex: 'toCreate', key: 'toCreate', width: 120 },
                                ]}
                            />
                        )}
                        {summary.sample.length > 0 && (
                            <div>
                                <Typography.Text type="secondary">
                                    {summary.toCreate > summary.sample.length
                                        ? `The first ${summary.sample.length} of ${summary.toCreate} rows`
                                        : 'All the rows'}
                                </Typography.Text>
                                <Table<SampleRow>
                                    size="small"
                                    rowKey="row"
                                    columns={sampleColumns}
                                    dataSource={summary.sample}
                                    pagination={false}
                                    scroll={{ x: 900 }}
                                    style={{ marginTop: 4 }}
                                />
                            </div>
                        )}
                    </Space>
                </Card>
            )}
        </Space>
    );
}