import { useState } from 'react';
import { Alert, Button, Card, Col, Modal, Popconfirm, Row, Space, Statistic, Table, Tag, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { DownloadOutlined, FileExcelOutlined, FileZipOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { apiDownload, apiRaw } from '../../core/api/client';
import { formatDate } from '../../core/format';
import { ACCESS_LABEL } from '../../shared/documents';
import type { AccessLevel } from '../../shared/documents';
import { errorText } from '../../shared/errors';

type RowError = { row: number; field?: string; message: string };
type Failure = { ok: false; fileErrors: string[]; errorCount: number; errors: RowError[]; warnings: string[] };
type Sample = { row: number; name: string; location: string; accessLevel: AccessLevel; owner: string; files: number; expiryDate: string | null };
type Summary = { ok: true; dryRun: boolean; totalRows: number; toCreate: number; files: number; warnings: string[]; sample: Sample[] };

const MAX_ZIP_MB = 100;
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isFailure = (o: Summary | Failure | null): o is Failure => o !== null && o.ok === false;
const isSummary = (o: Summary | Failure | null): o is Summary => o !== null && o.ok === true;

// Sends both files. A checked file with problems comes back as 422 with every problem listed.
async function send(details: File, zip: File | null, dryRun: boolean): Promise<Summary | Failure> {
    const form = new FormData();
    form.append('details', details);
    if (zip) form.append('zip', zip);
    const res = await apiRaw(`/documents/records/upload?dryRun=${dryRun}`, { method: 'POST', form });
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

function Problems({ f }: { f: Failure }) {
    return (
        <Card size="small" title={`${f.errorCount + f.fileErrors.length} problem(s) found. Nothing was saved.`}>
            <Space direction="vertical" style={{ width: '100%' }}>
                {f.fileErrors.map((m) => (
                    <Alert key={m} type="error" showIcon message={m} />
                ))}
                {f.errors.length > 0 && (
                    <Table<RowError>
                        size="small"
                        rowKey={(r) => `${r.row}:${r.field ?? ''}:${r.message}`}
                        dataSource={f.errors}
                        pagination={{ pageSize: 10, hideOnSinglePage: true }}
                        columns={[
                            { title: 'Row', dataIndex: 'row', key: 'row', width: 60 },
                            { title: 'Column', key: 'field', width: 180, render: (_, r) => r.field ?? '' },
                            { title: 'Problem', dataIndex: 'message', key: 'message' },
                        ]}
                    />
                )}
                {f.errorCount > f.errors.length && (
                    <Typography.Text type="secondary">Showing the first {f.errors.length}. Fix these and check again.</Typography.Text>
                )}
                <Typography.Text type="secondary">Row numbers match the rows in Excel. Row 1 is the heading.</Typography.Text>
            </Space>
        </Card>
    );
}

export function DocumentDataUploadModal({ onClose }: { onClose: () => void }) {
    const qc = useQueryClient();
    const [zip, setZip] = useState<File | null>(null);
    const [details, setDetails] = useState<File | null>(null);
    const [outcome, setOutcome] = useState<Summary | Failure | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'format' | 'check' | 'save'>(null);

    const reset = () => {
        setOutcome(null);
        setError(null);
    };

    const downloadFormat = async () => {
        setBusy('format');
        setError(null);
        try {
            await apiDownload('/documents/records/upload-format');
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const run = async (dryRun: boolean) => {
        if (!details) return;
        setError(null);
        setBusy(dryRun ? 'check' : 'save');
        try {
            const out = await send(details, zip, dryRun);
            setOutcome(out);
            if (isSummary(out) && !out.dryRun) await qc.invalidateQueries({ queryKey: ['documents'] });
        } catch (e) {
            setOutcome(null);
            setError(e instanceof Error ? e.message : 'The upload failed');
        } finally {
            setBusy(null);
        }
    };

    const fileItem = (f: File | null, uid: string): UploadFile[] => (f ? [{ uid, name: f.name, status: 'done' }] : []);
    const summary = isSummary(outcome) ? outcome : null;
    const failure = isFailure(outcome) ? outcome : null;
    const saved = summary && !summary.dryRun;
    const ready = summary?.dryRun && summary.toCreate > 0;

    return (
        <Modal
            open
            width={900}
            title="Upload Document Data"
            onCancel={onClose}
            destroyOnClose
            maskClosable={false}
            footer={
                <Space>
                    <Button onClick={onClose}>{saved ? 'Done' : 'Close'}</Button>
                    {!saved && (
                        <Button disabled={!details || !zip} loading={busy === 'check'} onClick={() => void run(true)}>
                            Check (nothing is saved)
                        </Button>
                    )}
                    {!saved && (
                        <Popconfirm
                            title={`Add ${summary?.toCreate ?? 0} document(s) with ${summary?.files ?? 0} file(s)?`}
                            okText="Upload"
                            disabled={!ready}
                            onConfirm={() => void run(false)}
                        >
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
                    type="warning"
                    showIcon
                    message="Before you upload"
                    description={
                        <ol style={{ margin: 0, paddingLeft: 18 }}>
                            <li>Download the format below. It lists your entities, locations, categories and users to copy from.</li>
                            <li>Fill in one row per document on the first sheet. In "Attachment Filename", write the file names, separated with ; for more than one.</li>
                            <li>Put all those files into one zip (up to {MAX_ZIP_MB} MB).</li>
                            <li>Choose both files and click Check. If anything is wrong, every problem is listed and nothing is saved. When the check passes, click Upload.</li>
                        </ol>
                    }
                />

                <Button icon={<DownloadOutlined />} loading={busy === 'format'} onClick={() => void downloadFormat()}>
                    Download Data Upload Format
                </Button>

                <Row gutter={16}>
                    <Col xs={24} md={12}>
                        <Typography.Text strong>Upload Document in Zip Format</Typography.Text>
                        <div style={{ marginTop: 8 }}>
                            <Upload
                                accept=".zip"
                                maxCount={1}
                                fileList={fileItem(zip, 'zip')}
                                beforeUpload={(f) => {
                                    if (f.size > MAX_ZIP_MB * 1024 * 1024) {
                                        setError(`The zip is larger than ${MAX_ZIP_MB} MB. Split it into smaller uploads.`);
                                        return Upload.LIST_IGNORE;
                                    }
                                    setZip(f);
                                    reset();
                                    return false;
                                }}
                                onRemove={() => {
                                    setZip(null);
                                    reset();
                                }}
                            >
                                <Button icon={<FileZipOutlined />}>Choose File</Button>
                            </Upload>
                        </div>
                    </Col>
                    <Col xs={24} md={12}>
                        <Typography.Text strong>Upload Document Details</Typography.Text>
                        <div style={{ marginTop: 8 }}>
                            <Upload
                                accept=".xlsx"
                                maxCount={1}
                                fileList={fileItem(details, 'details')}
                                beforeUpload={(f) => {
                                    setDetails(f);
                                    reset();
                                    return false;
                                }}
                                onRemove={() => {
                                    setDetails(null);
                                    reset();
                                }}
                            >
                                <Button icon={<FileExcelOutlined />}>Choose File</Button>
                            </Upload>
                        </div>
                    </Col>
                </Row>

                {error && <Alert type="error" showIcon message={error} />}
                {outcome?.warnings.map((w) => (
                    <Alert key={w} type="warning" showIcon message={w} />
                ))}
                {failure && <Problems f={failure} />}

                {summary && (
                    <Card size="small">
                        <Space direction="vertical" style={{ width: '100%' }}>
                            {saved ? (
                                <Alert type="success" showIcon message={`${summary.toCreate} document(s) added with ${summary.files} file(s)`} />
                            ) : (
                                <Alert type="success" showIcon message="The check passed. Click Upload to save." />
                            )}
                            <Row gutter={16}>
                                <Col span={8}>
                                    <Statistic title="Rows in the sheet" value={summary.totalRows} />
                                </Col>
                                <Col span={8}>
                                    <Statistic title={saved ? 'Documents added' : 'Documents to add'} value={summary.toCreate} />
                                </Col>
                                <Col span={8}>
                                    <Statistic title="Files" value={summary.files} />
                                </Col>
                            </Row>
                            <Table<Sample>
                                size="small"
                                rowKey="row"
                                pagination={false}
                                dataSource={summary.sample}
                                title={() => (summary.toCreate > summary.sample.length ? `The first ${summary.sample.length}` : undefined)}
                                columns={[
                                    { title: 'Row', dataIndex: 'row', key: 'r', width: 60 },
                                    { title: 'Document', dataIndex: 'name', key: 'n' },
                                    { title: 'Location', dataIndex: 'location', key: 'l' },
                                    { title: 'Type', key: 't', width: 100, render: (_, s) => <Tag>{ACCESS_LABEL[s.accessLevel]}</Tag> },
                                    { title: 'Owner', dataIndex: 'owner', key: 'o' },
                                    { title: 'Files', dataIndex: 'files', key: 'f', width: 60 },
                                    { title: 'Expiry', key: 'e', width: 110, render: (_, s) => formatDate(s.expiryDate) },
                                ]}
                            />
                        </Space>
                    </Card>
                )}
            </Space>
        </Modal>
    );
}