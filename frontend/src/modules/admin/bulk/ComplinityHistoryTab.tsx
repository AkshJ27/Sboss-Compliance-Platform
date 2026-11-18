import { useState } from 'react';
import { Alert, Button, Card, Col, Popconfirm, Row, Space, Statistic, Table, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { apiRaw } from '../../../core/api/client';
import { formatDate } from '../../../core/format';

type RowError = { file: string; row: number; field?: string; message: string };
type Failure = { ok: false; fileErrors: string[]; errorCount: number; errors: RowError[]; warnings: string[] };
type Summary = {
    ok: true;
    dryRun: boolean;
    rows: number;
    from: string;
    to: string;
    assignmentsAdded: number;
    toCreate: number;
    toUpdate: number;
    onTime: number;
    late: number;
    notApplicable: number;
    pending: number;
    open: number;
    warnings: string[];
};

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isFailure = (o: Summary | Failure | null): o is Failure => o !== null && o.ok === false;
const isSummary = (o: Summary | Failure | null): o is Summary => o !== null && o.ok === true;

async function send(files: File[], dryRun: boolean): Promise<Summary | Failure> {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const res = await apiRaw(`/compliance/bulk/import-complinity-history?dryRun=${dryRun}`, { method: 'POST', form });
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

// Complinity's Dashboard Data exports with every status: the past due items, with done dates and remarks
export function ComplinityHistoryTab() {
    const qc = useQueryClient();
    const [files, setFiles] = useState<File[]>([]);
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
            const out = await send(files, dryRun);
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
            <Card size="small" title="Bring the past items across from Complinity">
                <Typography.Paragraph style={{ margin: 0 }}>
                    In Complinity, export <b>Dashboard Data</b> from the main Excel icon with <b>no status selected</b>, for the past
                    period you want (for example April 2025 to today), and choose the files here. Each past item comes across with its
                    status, done date, reference number and remarks. Items still open in Complinity stay open here, so they show as Non
                    Compliance until they are done.
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                    Upload the assignments first (the From Complinity tab), and before changing any location&apos;s name. Uploading
                    again is safe: items already here are not added twice, and items someone has worked on here are left alone.
                </Typography.Paragraph>
            </Card>

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

            <Space>
                <Button disabled={!files.length || !!saved} loading={busy === 'check'} onClick={() => void run(true)}>
                    Check (nothing is saved)
                </Button>
                <Popconfirm
                    title={`Add ${summary?.toCreate ?? 0} past item(s)?`}
                    description="This can take a few minutes for a large file."
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
                                    ? `Saved: ${summary.toCreate} past item(s) added${summary.toUpdate ? `, ${summary.toUpdate} filled in` : ''}.`
                                    : `The check passed for periods from ${formatDate(summary.from)} to ${formatDate(summary.to)}. Click Upload to save.`
                            }
                        />
                        <Row gutter={16}>
                            <Col span={4}><Statistic title="Rows read" value={summary.rows} /></Col>
                            <Col span={4}><Statistic title={saved ? 'Added' : 'To add'} value={summary.toCreate} /></Col>
                            <Col span={4}><Statistic title="On time" value={summary.onTime} /></Col>
                            <Col span={4}><Statistic title="Late closure" value={summary.late} /></Col>
                            <Col span={4}><Statistic title="Not applicable" value={summary.notApplicable} /></Col>
                            <Col span={4}><Statistic title="Still open" value={summary.open + summary.pending} /></Col>
                        </Row>
                        <Typography.Text type="secondary">
                            Still open: {summary.open} not done yet (shown as Non Compliance), {summary.pending} waiting for approval.
                            {summary.assignmentsAdded > 0 && ` ${summary.assignmentsAdded} older assignment(s) are added as stopped, to hold their history.`}
                        </Typography.Text>
                    </Space>
                </Card>
            )}
        </Space>
    );
}