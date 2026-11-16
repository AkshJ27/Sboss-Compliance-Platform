import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Card, Col, Popconfirm, Row, Space, Statistic, Table, Tag, Typography, Upload, message } from 'antd';
import type { TableProps, UploadFile } from 'antd';
import { DownloadOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { apiDownload } from '../../../core/api/client';
import { formatDate, titleCase } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { RISK_COLOR } from '../api';
import { AddInternalModal } from './InternalForm';
import { isFailure, sendFile, useRefreshLibrary } from './internal';
import type { CreateSample, CreateSummary, Failure, RowError, UpdateSummary } from './internal';

const FIELD_NAME: Record<string, string> = {
    title: 'Name',
    description: 'Description',
    attachment: 'Attachment',
    proofOfCompliance: 'Proof of compliance',
    risk: 'Risk',
    applicability: 'Applicability',
    penalty: 'Penalty',
    alertOwnerDays: 'Owner alert days',
    alertManagerDays: 'Manager alert days',
    isActive: 'Active',
};

function Problems({ failure }: { failure: Failure }) {
    return (
        <Card size="small" title={`${failure.errorCount + failure.fileErrors.length} problem(s) found. Nothing was saved.`}>
            <Space direction="vertical" style={{ width: '100%' }}>
                {failure.fileErrors.map((m) => (
                    <Alert key={m} type="error" showIcon message={m} />
                ))}
                {failure.errors.length > 0 && (
                    <Table<RowError>
                        size="small"
                        rowKey={(r) => `${r.row}:${r.field ?? ''}:${r.message}`}
                        dataSource={failure.errors}
                        pagination={{ pageSize: 20, hideOnSinglePage: true }}
                        columns={[
                            { title: 'Row', dataIndex: 'row', key: 'row', width: 70 },
                            { title: 'Column', key: 'field', width: 200, render: (_, r) => r.field ?? '' },
                            { title: 'Problem', dataIndex: 'message', key: 'message' },
                        ]}
                    />
                )}
                {failure.errorCount > failure.errors.length && (
                    <Typography.Text type="secondary">Showing the first {failure.errors.length}. Fix these and check again.</Typography.Text>
                )}
                <Typography.Text type="secondary">Row numbers match the rows in Excel. Row 1 is the header.</Typography.Text>
            </Space>
        </Card>
    );
}

function Warnings({ warnings }: { warnings: string[] }) {
    return (
        <>
            {warnings.map((w) => (
                <Alert key={w} type="warning" showIcon message={w} />
            ))}
        </>
    );
}

// Choose a file, check it without saving, then save. The same steps for both files.
function FileStep<T extends { ok: true; dryRun: boolean }>({
    kind,
    noun,
    willDo,
    onDone,
    children,
}: {
    kind: 'upload' | 'update';
    noun: string;
    willDo: (s: T) => number;
    onDone?: () => void;
    children: (s: T) => ReactNode;
}) {
    const refresh = useRefreshLibrary();
    const [file, setFile] = useState<File | null>(null);
    const [outcome, setOutcome] = useState<T | Failure | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'check' | 'save'>(null);

    const reset = () => {
        setOutcome(null);
        setError(null);
    };
    const run = async (dryRun: boolean) => {
        if (!file) return;
        setError(null);
        setBusy(dryRun ? 'check' : 'save');
        try {
            const out = await sendFile<T>(kind, file, dryRun);
            setOutcome(out);
            if (!isFailure(out) && !out.dryRun) {
                await refresh();
                onDone?.();
            }
        } catch (e) {
            setOutcome(null);
            setError(e instanceof Error ? e.message : 'The upload failed');
        } finally {
            setBusy(null);
        }
    };

    const fileList: UploadFile[] = file ? [{ uid: 'file', name: file.name, status: 'done' }] : [];
    const summary = outcome && !isFailure(outcome) ? (outcome as T) : null;
    const failure = outcome && isFailure(outcome) ? outcome : null;
    const ready = summary !== null && summary.dryRun && willDo(summary) > 0;

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space wrap>
                <Upload
                    accept=".xlsx"
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
                    <Button icon={<UploadOutlined />}>Choose the Excel file</Button>
                </Upload>
                <Button type="primary" disabled={!file} loading={busy === 'check'} onClick={() => void run(true)}>
                    Check (nothing is saved)
                </Button>
                {ready && (
                    <Popconfirm
                        title={`Save ${willDo(summary)} ${noun}?`}
                        okText="Save"
                        onConfirm={() => void run(false)}
                    >
                        <Button type="primary" danger loading={busy === 'save'}>
                            Save now
                        </Button>
                    </Popconfirm>
                )}
            </Space>
            {error && <Alert type="error" showIcon message={error} />}
            {failure && <Problems failure={failure} />}
            {summary && children(summary)}
        </Space>
    );
}

export function InternalTab() {
    const navigate = useNavigate();
    const [messageApi, holder] = message.useMessage();
    const [adding, setAdding] = useState(false);
    const [downloading, setDownloading] = useState<null | 'upload' | 'update'>(null);

    const download = async (kind: 'upload' | 'update') => {
        setDownloading(kind);
        try {
            await apiDownload(`/library/internal/${kind}-format`);
        } catch (e) {
            messageApi.error(errorText(e));
        } finally {
            setDownloading(null);
        }
    };

    const sampleColumns: TableProps<CreateSample>['columns'] = [
        { title: 'Row', dataIndex: 'row', key: 'row', width: 60 },
        {
            title: 'Compliance',
            key: 'c',
            render: (_, r) => (
                <div>
                    <div>{r.title}</div>
                    {r.code && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {r.code}
                        </Typography.Text>
                    )}
                </div>
            ),
        },
        { title: 'Location', dataIndex: 'location', key: 'l', width: 170 },
        { title: 'Periodicity', key: 'f', width: 110, render: (_, r) => titleCase(r.frequency) },
        { title: 'Risk', key: 'r', width: 80, render: (_, r) => <Tag color={RISK_COLOR[r.risk]}>{titleCase(r.risk)}</Tag> },
        { title: 'Owner', dataIndex: 'owner', key: 'o', width: 130 },
        { title: 'Manager', dataIndex: 'manager', key: 'm', width: 130 },
        { title: 'Effective', key: 'e', width: 110, render: (_, r) => formatDate(r.effectiveDate) },
    ];

    const generateHint = (
        <Alert
            type="success"
            showIcon
            message="Saved"
            description="The dated items do not exist yet. Open Setup, Schedules and use Generate items."
            action={
                <Button size="small" onClick={() => navigate('/admin/schedules')}>
                    Open Schedules
                </Button>
            }
        />
    );

    return (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {holder}
            <Space wrap>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
                    Add internal compliance
                </Button>
                <Typography.Text type="secondary">
                    Internal compliances are your company's own obligations. Only your company can see them.
                </Typography.Text>
            </Space>

            <Card
                size="small"
                title="Upload new internal compliances"
                extra={
                    <Button icon={<DownloadOutlined />} loading={downloading === 'upload'} onClick={() => void download('upload')}>
                        Internal compliance upload format
                    </Button>
                }
            >
                <Typography.Paragraph type="secondary">
                    Each row creates one compliance and schedules it at one location. The format has your entities, locations,
                    departments, verticals and users on separate sheets, and instructions. Complinity's own upload format also
                    works. If any row has a problem, nothing is saved.
                </Typography.Paragraph>
                <FileStep<CreateSummary> kind="upload" noun="internal compliance(s)" willDo={(s) => s.toCreate}>
                    {(s) => (
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            {!s.dryRun && generateHint}
                            <Warnings warnings={s.warnings} />
                            <Row gutter={12}>
                                <Col xs={12} md={6}>
                                    <Statistic title="Rows" value={s.totalRows} />
                                </Col>
                                <Col xs={12} md={6}>
                                    <Statistic title={s.dryRun ? 'Will be created' : 'Created'} value={s.dryRun ? s.toCreate : s.created} />
                                </Col>
                                <Col xs={12} md={6}>
                                    <Statistic title="Locations" value={s.locations} />
                                </Col>
                                <Col xs={12} md={6}>
                                    <Statistic title="High risk" value={s.highRisk} />
                                </Col>
                            </Row>
                            <Table<CreateSample>
                                size="small"
                                rowKey="row"
                                columns={sampleColumns}
                                dataSource={s.sample}
                                pagination={false}
                                scroll={{ x: 900 }}
                                title={() => (s.sample.length < s.toCreate ? `The first ${s.sample.length} rows` : undefined)}
                            />
                        </Space>
                    )}
                </FileStep>
            </Card>

            <Card
                size="small"
                title="Update existing internal compliances"
                extra={
                    <Button icon={<DownloadOutlined />} loading={downloading === 'update'} onClick={() => void download('update')}>
                        Internal compliance update format
                    </Button>
                }
            >
                <Typography.Paragraph type="secondary">
                    The update format lists your internal compliances as they are now. Change the name, description, risk,
                    attachment, proof, applicability, penalty, alert days or active flag, then upload it here. Do not change the
                    code column. Periodicity, due day, location and people cannot be changed this way.
                </Typography.Paragraph>
                <FileStep<UpdateSummary> kind="update" noun="change(s)" willDo={(s) => s.changed}>
                    {(s) => (
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            {!s.dryRun && <Alert type="success" showIcon message={`${s.changed} compliance(s) updated`} />}
                            <Row gutter={12}>
                                <Col xs={8}>
                                    <Statistic title="Rows" value={s.totalRows} />
                                </Col>
                                <Col xs={8}>
                                    <Statistic title={s.dryRun ? 'Will change' : 'Changed'} value={s.changed} />
                                </Col>
                                <Col xs={8}>
                                    <Statistic title="No change" value={s.unchanged} />
                                </Col>
                            </Row>
                            {s.dryRun && s.changed === 0 && <Alert type="info" showIcon message="Nothing in this file differs from what is saved" />}
                            {s.sample.length > 0 && (
                                <Table
                                    size="small"
                                    rowKey="code"
                                    pagination={false}
                                    dataSource={s.sample}
                                    columns={[
                                        { title: 'Code', dataIndex: 'code', key: 'c', width: 170 },
                                        { title: 'Fields that change', key: 'f', render: (_, r) => r.fields.map((f) => FIELD_NAME[f] ?? f).join(', ') },
                                    ]}
                                />
                            )}
                        </Space>
                    )}
                </FileStep>
            </Card>

            <AddInternalModal
                open={adding}
                onClose={() => setAdding(false)}
                onCreated={(code) => {
                    setAdding(false);
                    messageApi.success(`Added ${code}. Generate items under Setup, Schedules to create its dates.`);
                }}
            />
        </Space>
    );
}