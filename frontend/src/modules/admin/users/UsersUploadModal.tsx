import { useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Modal, Popconfirm, Row, Space, Statistic, Table, Tag, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { DownloadOutlined, FileExcelOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { apiDownload, apiRaw } from '../../../core/api/client';
import { errorText } from '../../../shared/errors';

type RowError = { row: number; field?: string; message: string };
type Failure = { ok: false; fileErrors: string[]; errorCount: number; errors: RowError[]; warnings: string[] };
type Sample = { row: number; name: string; email: string; role: string; status: string; manager: string; approver: string; action: string };
type Summary = {
    ok: true;
    dryRun: boolean;
    totalRows: number;
    toCreate: number;
    toUpdate: number;
    unchanged: number;
    admins: number;
    inactive: number;
    withManager: number;
    withApprover: number;
    invited: number;
    inviteFailed: number;
    warnings: string[];
    sample: Sample[];
};

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isFailure = (o: Summary | Failure | null): o is Failure => o !== null && o.ok === false;
const isSummary = (o: Summary | Failure | null): o is Summary => o !== null && o.ok === true;

async function send(file: File, dryRun: boolean, invite: boolean): Promise<Summary | Failure> {
    const form = new FormData();
    form.append('file', file);
    const res = await apiRaw(`/users/upload?dryRun=${dryRun}&invite=${invite}`, { method: 'POST', form });
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

const ACTION_COLOR = (a: string) => (a === 'New' ? 'green' : a === 'No change' ? 'default' : 'blue');

// Add or update many users at once from Complinity's users list (or the format). Checked first; nothing is saved if anything is wrong.
export function UsersUploadModal({ onClose }: { onClose: () => void }) {
    const qc = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [invite, setInvite] = useState(false);
    const [outcome, setOutcome] = useState<Summary | Failure | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'format' | 'check' | 'save'>(null);

    const run = async (dryRun: boolean) => {
        if (!file) return;
        setError(null);
        setBusy(dryRun ? 'check' : 'save');
        try {
            const out = await send(file, dryRun, invite);
            setOutcome(out);
            if (isSummary(out) && !out.dryRun) await qc.invalidateQueries({ queryKey: ['users'] });
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
            await apiDownload('/users/upload-format');
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const summary = isSummary(outcome) ? outcome : null;
    const failure = isFailure(outcome) ? outcome : null;
    const saved = summary && !summary.dryRun;
    const ready = summary?.dryRun && summary.toCreate + summary.toUpdate > 0;
    const fileList: UploadFile[] = file ? [{ uid: 'f', name: file.name, status: 'done' }] : [];

    return (
        <Modal
            open
            width={1000}
            title="Upload users"
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
                        <Popconfirm
                            title={`Add ${summary?.toCreate ?? 0} and update ${summary?.toUpdate ?? 0} user(s)?`}
                            description={invite ? 'New active users get an invitation email.' : 'No emails are sent.'}
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
                    type="info"
                    showIcon
                    message="Complinity's users list can be uploaded as it is"
                    description="People are matched by email: new ones are added, existing ones are updated (name, role, status, manager, approver). People not in the file are left alone. To set someone's approver, add an Approver column with the approver's name or email on that person's row."
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
                    <Checkbox checked={invite} onChange={(e) => setInvite(e.target.checked)}>
                        Send invitation emails to new users
                    </Checkbox>
                </Space>
                {!invite && (
                    <Typography.Text type="secondary">
                        Without invitations, new users cannot sign in until you click "Resend invite" on their row. Use this to load everyone first and invite them on go-live day.
                    </Typography.Text>
                )}

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
                                    { title: 'Column', key: 'c', width: 160, render: (_, r) => r.field ?? '' },
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
                                        ? `Saved: ${summary.toCreate} added, ${summary.toUpdate} updated.${invite ? ` ${summary.invited} invitation(s) sent${summary.inviteFailed ? `, ${summary.inviteFailed} could not be sent` : ''}.` : ''}`
                                        : 'The check passed. Click Upload to save.'
                                }
                            />
                            <Row gutter={16}>
                                <Col span={3}><Statistic title="Rows" value={summary.totalRows} /></Col>
                                <Col span={3}><Statistic title={saved ? 'Added' : 'New'} value={summary.toCreate} /></Col>
                                <Col span={4}><Statistic title={saved ? 'Updated' : 'To update'} value={summary.toUpdate} /></Col>
                                <Col span={3}><Statistic title="Admins" value={summary.admins} /></Col>
                                <Col span={3}><Statistic title="Inactive" value={summary.inactive} /></Col>
                                <Col span={4}><Statistic title="With manager" value={summary.withManager} /></Col>
                                <Col span={4}><Statistic title="With approver" value={summary.withApprover} /></Col>
                            </Row>
                            <Table<Sample>
                                size="small"
                                rowKey="row"
                                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                                dataSource={summary.sample}
                                columns={[
                                    { title: 'Row', dataIndex: 'row', key: 'r', width: 60 },
                                    { title: 'Name', dataIndex: 'name', key: 'n' },
                                    { title: 'Email', dataIndex: 'email', key: 'e' },
                                    { title: 'Role', dataIndex: 'role', key: 'ro', width: 90 },
                                    { title: 'Status', dataIndex: 'status', key: 's', width: 90 },
                                    { title: 'Manager', dataIndex: 'manager', key: 'm' },
                                    { title: 'Approver', dataIndex: 'approver', key: 'ap' },
                                    { title: '', key: 'a', width: 170, render: (_, s) => <Tag color={ACTION_COLOR(s.action)}>{s.action}</Tag> },
                                ]}
                            />
                        </Space>
                    </Card>
                )}
            </Space>
        </Modal>
    );
}