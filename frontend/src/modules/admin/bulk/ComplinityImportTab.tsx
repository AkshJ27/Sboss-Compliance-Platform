import { useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Descriptions, Popconfirm, Row, Space, Statistic, Table, Tag, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { apiRaw } from '../../../core/api/client';

type RowError = { file: string; row: number; field?: string; message: string };
type Failure = { ok: false; fileErrors: string[]; errorCount: number; errors: RowError[]; warnings: string[] };
type Sample = { id: string; code: string; location: string; owner: string; manager: string; status: string; action: string };
type Summary = {
    ok: true;
    dryRun: boolean;
    startDate: string;
    rows: number;
    files: number;
    assignments: number;
    active: number;
    inactive: number;
    toCreate: number;
    toUpdate: number;
    unchanged: number;
    withApprover: number;
    newMasters: { entities: string[]; departments: string[]; verticals: string[]; locationTypes: string[]; locations: number };
    warnings: string[];
    sample: Sample[];
};

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isFailure = (o: Summary | Failure | null): o is Failure => o !== null && o.ok === false;
const isSummary = (o: Summary | Failure | null): o is Summary => o !== null && o.ok === true;

async function send(files: File[], dryRun: boolean, startDate: string): Promise<Summary | Failure> {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const res = await apiRaw(`/compliance/bulk/import-complinity?dryRun=${dryRun}&startDate=${startDate}`, { method: 'POST', form });
    let data: unknown = null;
    try {
        data = await res.json();
    } catch {
        // The reply was not JSON
    }
    if (res.status === 422 && isObject(data) && data.ok === false) return data as unknown as Failure;
    if (res.ok && isObject(data) && data.ok === true) return data as unknown as Summary;
    throw new Error(isObject(data) && typeof data.error === 'string' ? data.error : `The upload failed (${res.status})`);
}

const list = (items: string[]) => (items.length ? items.join(', ') : 'None');

// Complinity's Dashboard Data exports, as they are: entities, departments, verticals, locations and assignments in one go
export function ComplinityImportTab() {
    const qc = useQueryClient();
    const [files, setFiles] = useState<File[]>([]);
    const [startDate, setStartDate] = useState<Dayjs>(dayjs().startOf('month'));
    const [outcome, setOutcome] = useState<Summary | Failure | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'check' | 'save'>(null);

    const reset = () => {
        setOutcome(null);
        setError(null);
    };
    const run = async (dryRun: boolean) => {
        if (!files.length) return;
        setError(null);
        setBusy(dryRun ? 'check' : 'save');
        try {
            const out = await send(files, dryRun, startDate.format('YYYY-MM-DD'));
            setOutcome(out);
            if (isSummary(out) && !out.dryRun) await qc.invalidateQueries();
        } catch (e) {
            setOutcome(null);
            setError(e instanceof Error ? e.message : 'The upload failed');
        } finally {
            setBusy(null);
        }
    };

    const summary = isSummary(outcome) ? outcome : null;
    const failure = isFailure(outcome) ? outcome : null;
    const saved = summary && !summary.dryRun;
    const ready = summary?.dryRun && summary.toCreate + summary.toUpdate > 0;
    const fileList: UploadFile[] = files.map((f, i) => ({ uid: String(i), name: f.name, status: 'done' }));

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Card size="small" title="Bring your assignments across from Complinity">
                <Typography.Paragraph style={{ margin: 0 }}>
                    In Complinity, export <b>Dashboard Data</b> without any filter, for periods that together cover the past year and the
                    year ahead, and choose all the files here (up to 6). Each Complinity assignment becomes one here, with its owner,
                    manager, department and vertical. Entities, departments, verticals and locations that do not exist yet are added.
                    Where several vendors work in the same state, each gets its own location, such as <i>Quess - Karnataka</i>.
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                    Load the users and the compliance library first. Uploading again is safe: assignments already here are updated.
                </Typography.Paragraph>
            </Card>

            <Space wrap align="start">
                <Upload
                    accept=".xlsx"
                    multiple
                    fileList={fileList}
                    beforeUpload={(f) => {
                        setFiles((prev) => [...prev.filter((p) => p.name !== f.name), f].slice(0, 6));
                        reset();
                        return false;
                    }}
                    onRemove={(f) => {
                        setFiles((prev) => prev.filter((p) => p.name !== f.name));
                        reset();
                    }}
                >
                    <Button icon={<FileExcelOutlined />}>Choose the Excel files</Button>
                </Upload>
                <div>
                    <DatePicker
                        allowClear={false}
                        value={startDate}
                        onChange={(d) => {
                            if (d) setStartDate(d);
                            reset();
                        }}
                    />
                    <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            Assignments start from this date. Periods ending before it are not generated.
                        </Typography.Text>
                    </div>
                </div>
            </Space>

            <Space>
                <Button disabled={!files.length || !!saved} loading={busy === 'check'} onClick={() => void run(true)}>
                    Check (nothing is saved)
                </Button>
                <Popconfirm
                    title={`Add ${summary?.toCreate ?? 0} and update ${summary?.toUpdate ?? 0} assignment(s)?`}
                    description="New entities, departments, verticals and locations are added too."
                    okText="Upload"
                    disabled={!ready}
                    onConfirm={() => void run(false)}
                >
                    <Button type="primary" disabled={!ready} loading={busy === 'save'}>
                        Upload
                    </Button>
                </Popconfirm>
            </Space>

            {error && <Alert type="error" showIcon message={error} />}
            {outcome?.warnings.map((w) => (
                <Alert key={w} type="warning" showIcon message={w} />
            ))}

            {failure && (
                <Card size="small" title={`${failure.errorCount + failure.fileErrors.length} problem(s) found. Nothing was saved.`}>
                    {failure.fileErrors.map((m) => (
                        <Alert key={m} type="error" showIcon message={m} style={{ marginBottom: 8 }} />
                    ))}
                    {failure.errors.length > 0 && (
                        <Table<RowError>
                            size="small"
                            rowKey={(r) => `${r.file}:${r.row}:${r.field ?? ''}:${r.message}`}
                            dataSource={failure.errors}
                            pagination={{ pageSize: 10, hideOnSinglePage: true }}
                            columns={[
                                { title: 'File', dataIndex: 'file', key: 'f', width: 200 },
                                { title: 'Row', key: 'r', width: 70, render: (_, r) => (r.row ? r.row : '') },
                                { title: 'Column', key: 'c', width: 170, render: (_, r) => r.field ?? '' },
                                { title: 'Problem', dataIndex: 'message', key: 'm' },
                            ]}
                        />
                    )}
                </Card>
            )}

            {summary && (
                <Card size="small">
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <Alert
                            type="success"
                            showIcon
                            message={
                                saved
                                    ? `Saved: ${summary.toCreate} added, ${summary.toUpdate} updated. Next, go to Schedules > 2. Generate items to create the due items from ${summary.startDate}.`
                                    : 'The check passed. Click Upload to save.'
                            }
                        />
                        <Row gutter={16}>
                            <Col span={4}><Statistic title="Rows read" value={summary.rows} /></Col>
                            <Col span={4}><Statistic title="Assignments" value={summary.assignments} /></Col>
                            <Col span={4}><Statistic title="Active" value={summary.active} /></Col>
                            <Col span={4}><Statistic title="Stopped" value={summary.inactive} /></Col>
                            <Col span={4}><Statistic title={saved ? 'Added' : 'New'} value={summary.toCreate} /></Col>
                            <Col span={4}><Statistic title={saved ? 'Updated' : 'To update'} value={summary.toUpdate} /></Col>
                        </Row>
                        <Descriptions size="small" column={1} bordered title={saved ? 'Masters added' : 'Masters to add'}>
                            <Descriptions.Item label="Entities">{list(summary.newMasters.entities)}</Descriptions.Item>
                            <Descriptions.Item label="Departments">{list(summary.newMasters.departments)}</Descriptions.Item>
                            <Descriptions.Item label="Verticals">{list(summary.newMasters.verticals)}</Descriptions.Item>
                            <Descriptions.Item label="Location types">{list(summary.newMasters.locationTypes)}</Descriptions.Item>
                            <Descriptions.Item label="Locations">{summary.newMasters.locations}</Descriptions.Item>
                        </Descriptions>
                        <Table<Sample>
                            size="small"
                            rowKey="id"
                            dataSource={summary.sample}
                            pagination={{ pageSize: 10, hideOnSinglePage: true }}
                            title={() => (summary.assignments > summary.sample.length ? `The first ${summary.sample.length}` : undefined)}
                            columns={[
                                { title: 'Compliance ID', dataIndex: 'code', key: 'c', width: 120 },
                                { title: 'Location', dataIndex: 'location', key: 'l' },
                                { title: 'Owner', dataIndex: 'owner', key: 'o' },
                                { title: 'Manager', dataIndex: 'manager', key: 'm' },
                                { title: 'Status', key: 's', width: 90, render: (_, s) => <Tag color={s.status === 'Active' ? 'green' : 'default'}>{s.status}</Tag> },
                                { title: '', key: 'a', width: 160, render: (_, s) => <Tag color={s.action === 'New' ? 'blue' : undefined}>{s.action}</Tag> },
                            ]}
                        />
                    </Space>
                </Card>
            )}
        </Space>
    );
}