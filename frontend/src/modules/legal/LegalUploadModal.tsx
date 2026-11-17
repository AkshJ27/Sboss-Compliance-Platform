import { useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Modal, Popconfirm, Row, Space, Statistic, Table, Tag, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { DownloadOutlined, FileExcelOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { apiDownload, apiRaw } from '../../core/api/client';
import { formatDate } from '../../core/format';
import { errorText } from '../../shared/errors';

type RowError = { row: number; field?: string; message: string };
type Failure = { ok: false; fileErrors: string[]; errorCount: number; errors: RowError[]; warnings: string[] };
type Sample = { row: number; notificationDate: string; act: string; title: string; region: string; complianceImpact: boolean };
type Summary = {
    ok: true;
    dryRun: boolean;
    totalRows: number;
    toCreate: number;
    duplicates: number;
    newActs: number;
    newRules: number;
    newCategories: number;
    impacted: number;
    notified: number;
    warnings: string[];
    sample: Sample[];
};

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isFailure = (o: Summary | Failure | null): o is Failure => o !== null && o.ok === false;
const isSummary = (o: Summary | Failure | null): o is Summary => o !== null && o.ok === true;

async function send(file: File, dryRun: boolean, notify: boolean): Promise<Summary | Failure> {
    const form = new FormData();
    form.append('file', file);
    const res = await apiRaw(`/legal-updates/upload?dryRun=${dryRun}&notify=${notify}`, { method: 'POST', form });
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

// Upload a Legal Updates Register (platform administrator). Checked first; nothing is saved if anything is wrong.
export function LegalUploadModal({ onClose }: { onClose: () => void }) {
    const qc = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [notifyFollowers, setNotifyFollowers] = useState(true);
    const [outcome, setOutcome] = useState<Summary | Failure | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'format' | 'check' | 'save'>(null);

    const run = async (dryRun: boolean) => {
        if (!file) return;
        setError(null);
        setBusy(dryRun ? 'check' : 'save');
        try {
            const out = await send(file, dryRun, notifyFollowers);
            setOutcome(out);
            if (isSummary(out) && !out.dryRun) await qc.invalidateQueries({ queryKey: ['legal'] });
        } catch (e) {
            setOutcome(null);
            setError(e instanceof Error ? e.message : 'The upload failed');
        } finally {
            setBusy(null);
        }
    };

    const format = async () => {
        setBusy('format');
        try {
            await apiDownload('/legal-updates/upload-format');
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const summary = isSummary(outcome) ? outcome : null;
    const failure = isFailure(outcome) ? outcome : null;
    const saved = summary && !summary.dryRun;
    const ready = summary?.dryRun && summary.toCreate > 0;
    const fileList: UploadFile[] = file ? [{ uid: 'f', name: file.name, status: 'done' }] : [];

    return (
        <Modal
            open
            width={950}
            title="Upload Legal Updates"
            onCancel={onClose}
            destroyOnClose
            maskClosable={false}
            footer={
                <Space>
                    <Button onClick={onClose}>{saved ? 'Done' : 'Close'}</Button>
                    {!saved && (
                        <Button disabled={!file} loading={busy === 'check'} onClick={() => void run(true)}>
                            Check (nothing is saved)
                        </Button>
                    )}
                    {!saved && (
                        <Popconfirm title={`Add ${summary?.toCreate ?? 0} legal update(s)?`} okText="Upload" disabled={!ready} onConfirm={() => void run(false)}>
                            <Button type="primary" disabled={!ready} loading={busy === 'save'}>
                                Upload
                            </Button>
                        </Popconfirm>
                    )}
                </Space>
            }
        >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                    type="info"
                    showIcon
                    message="Upload a Legal Updates Register"
                    description="Use the format below, or a register exported from here or from Complinity as it is. Acts, Rules and law categories not yet in the library are added. Rows already in the system are skipped."
                />
                <Space wrap>
                    <Button icon={<DownloadOutlined />} loading={busy === 'format'} onClick={() => void format()}>
                        Download format
                    </Button>
                    <Upload
                        accept=".xlsx"
                        maxCount={1}
                        fileList={fileList}
                        beforeUpload={(f) => {
                            setFile(f);
                            setOutcome(null);
                            setError(null);
                            return false;
                        }}
                        onRemove={() => {
                            setFile(null);
                            setOutcome(null);
                        }}
                    >
                        <Button icon={<FileExcelOutlined />}>Choose the Excel file</Button>
                    </Upload>
                    <Checkbox checked={notifyFollowers} onChange={(e) => setNotifyFollowers(e.target.checked)}>
                        Tell followers about updates published in the last 7 days
                    </Checkbox>
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
                                rowKey={(r) => `${r.row}:${r.field ?? ''}:${r.message}`}
                                dataSource={failure.errors}
                                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                                columns={[
                                    { title: 'Row', dataIndex: 'row', key: 'r', width: 60 },
                                    { title: 'Column', key: 'c', width: 170, render: (_, r) => r.field ?? '' },
                                    { title: 'Problem', dataIndex: 'message', key: 'm' },
                                ]}
                            />
                        )}
                        <Typography.Text type="secondary">Row numbers match the rows in Excel.</Typography.Text>
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
                                        ? `${summary.toCreate} legal update(s) added${summary.notified ? `, ${summary.notified} follower notice(s) sent` : ''}`
                                        : 'The check passed. Click Upload to save.'
                                }
                            />
                            <Row gutter={16}>
                                <Col span={5}><Statistic title="Rows" value={summary.totalRows} /></Col>
                                <Col span={5}><Statistic title={saved ? 'Added' : 'To add'} value={summary.toCreate} /></Col>
                                <Col span={5}><Statistic title="Skipped repeats" value={summary.duplicates} /></Col>
                                <Col span={5}><Statistic title="Compliance impact" value={summary.impacted} /></Col>
                                <Col span={4}><Statistic title="New Acts" value={summary.newActs} /></Col>
                            </Row>
                            <Table<Sample>
                                size="small"
                                rowKey="row"
                                pagination={false}
                                dataSource={summary.sample}
                                title={() => (summary.toCreate > summary.sample.length ? `The first ${summary.sample.length}` : undefined)}
                                columns={[
                                    { title: 'Row', dataIndex: 'row', key: 'r', width: 60 },
                                    { title: 'Notification Date', key: 'd', width: 130, render: (_, s) => formatDate(s.notificationDate) },
                                    { title: 'Act', dataIndex: 'act', key: 'a', ellipsis: true },
                                    { title: 'Title', dataIndex: 'title', key: 't', ellipsis: true },
                                    { title: 'Cent/State', dataIndex: 'region', key: 's', width: 110 },
                                    { title: 'Impact', key: 'i', width: 80, render: (_, s) => (s.complianceImpact ? <Tag color="red">Yes</Tag> : 'No') },
                                ]}
                            />
                        </Space>
                    </Card>
                )}
            </Space>
        </Modal>
    );
}