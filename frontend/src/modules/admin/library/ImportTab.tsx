import { useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Statistic, Table, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { apiRaw } from '../../../core/api/client';
import { errorText } from '../../../shared/errors';

type Summary = {
    ok: true;
    dryRun: boolean;
    ignoredColumns: string[];
    totalRows: number;
    compliancesNew: number;
    compliancesUpdated: number;
    compliancesUnchanged: number;
    newLawCategories: number;
    newStatutoryAuthorities: number;
    newNatures: number;
    newTypes: number;
    newActs: number;
    newRules: number;
    sampleUpdates: { code: string; changed: string[] }[];
    mapped?: number; // Complinity export only: compliances mapped to the company there
    inactive?: number;
    warnings?: string[];
};
type RowError = { row: number; field?: string; message: string };
type Failure = { ok: false; errorCount: number; errors: RowError[]; ignoredColumns: string[]; fileErrors?: string[]; warnings?: string[] };
type Outcome = Summary | Failure;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isFailure = (o: Outcome | null): o is Failure => o !== null && o.ok === false;
const isSummary = (o: Outcome | null): o is Summary => o !== null && o.ok === true;

async function send(file: File, dryRun: boolean): Promise<Outcome> {
    const form = new FormData();
    form.append('file', file);
    // A CSV in this app's format, or Complinity's compliance details export (.xlsx) as it is
    const path = file.name.toLowerCase().endsWith('.xlsx') ? '/library/import-complinity' : '/library/import';
    const res = await apiRaw(`${path}?dryRun=${dryRun}`, { method: 'POST', form });

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

    const text = isObject(data) && typeof data.error === 'string' ? data.error : `The import failed (${res.status})`;
    throw new Error(text);
}

export function ImportTab() {
    const qc = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'preview' | 'import'>(null);

    const run = async (dryRun: boolean) => {
        if (!file) return;
        setError(null);
        setBusy(dryRun ? 'preview' : 'import');
        try {
            const result = await send(file, dryRun);
            setOutcome(result);
            if (isSummary(result) && !result.dryRun) await qc.invalidateQueries({ queryKey: ['library'] });
        } catch (e) {
            setOutcome(null);
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const fileList: UploadFile[] = file ? [{ uid: 'file', name: file.name, status: 'done' }] : [];
    const summary = isSummary(outcome) ? outcome : null;
    const failure = isFailure(outcome) ? outcome : null;
    const readyToImport = !!summary && summary.dryRun && summary.compliancesNew + summary.compliancesUpdated > 0;

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Card size="small" title="Before you start">
                <Typography.Paragraph style={{ margin: 0 }}>
                    Save the sheet as <b>CSV UTF-8</b>. Required columns: <b>code, act, law category, jurisdiction, title, frequency</b>. Add{' '}
                    <b>state</b> for state laws, and <b>due day</b> for recurring items. Header names are matched loosely, so
                    &quot;Law Category&quot; and &quot;law_category&quot; both work. Each code is permanent: re-importing a code updates
                    that item. Format any code column as Text first, or Excel may turn long numbers into 1.2E+10.
                </Typography.Paragraph>
                <Typography.Paragraph style={{ margin: '8px 0 0' }}>
                    <b>From Complinity:</b> upload the compliance details export (.xlsx) as it is. Its mapped, unmapped and inactivated
                    sheets are all read, and Complinity&apos;s Compliance ID becomes each item&apos;s code.
                </Typography.Paragraph>
            </Card>

            <Upload
                accept=".csv,.xlsx"
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
                    setError(null);
                }}
            >
                <Button icon={<UploadOutlined />}>Choose a CSV or Complinity Excel file</Button>
            </Upload>

            <Space>
                <Button type="primary" disabled={!file} loading={busy === 'preview'} onClick={() => void run(true)}>
                    Preview (nothing is saved)
                </Button>
                {readyToImport && (
                    <Button type="primary" danger loading={busy === 'import'} onClick={() => void run(false)}>
                        Import now
                    </Button>
                )}
            </Space>

            {error && <Alert type="error" showIcon message={error} />}
            {outcome?.warnings?.map((w) => (
                <Alert key={w} type="warning" showIcon message={w} />
            ))}

            {failure && (
                <Card size="small" title={`${failure.errorCount + (failure.fileErrors?.length ?? 0)} problem(s) found. Nothing was imported.`}>
                    {failure.fileErrors?.map((m) => (
                        <Alert key={m} type="error" showIcon message={m} style={{ marginBottom: 12 }} />
                    ))}
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
                        <Typography.Text type="secondary">Showing the first {failure.errors.length}. Fix these and preview again.</Typography.Text>
                    )}
                    <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                        For a CSV, row 1 is the first row under the header. For an Excel file, row numbers match Excel.
                    </Typography.Paragraph>
                </Card>
            )}

            {summary && (
                <Card
                    size="small"
                    title={summary.dryRun ? 'Preview: this is what the import would do' : 'Imported'}
                >
                    <Space direction="vertical" style={{ width: '100%' }}>
                        {!summary.dryRun && <Alert type="success" showIcon message="The library was updated." />}
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
                                <Statistic title="New" value={summary.compliancesNew} valueStyle={{ color: '#389e0d' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Updated" value={summary.compliancesUpdated} valueStyle={{ color: '#d46b08' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Unchanged" value={summary.compliancesUnchanged} />
                            </Col>
                        </Row>
                        {summary.mapped !== undefined && (
                            <Typography.Text>
                                Mapped to your company in Complinity: <b>{summary.mapped}</b>. Inactive: <b>{summary.inactive ?? 0}</b>. Assigning
                                them to people comes next, with Complinity&apos;s assignment data.
                            </Typography.Text>
                        )}
                        <Typography.Text type="secondary">
                            New Acts {summary.newActs}, rules {summary.newRules}, law categories {summary.newLawCategories}, authorities{' '}
                            {summary.newStatutoryAuthorities}, natures {summary.newNatures}, types {summary.newTypes}.
                        </Typography.Text>
                        {summary.sampleUpdates.length > 0 && (
                            <Table
                                size="small"
                                rowKey="code"
                                dataSource={summary.sampleUpdates}
                                pagination={false}
                                columns={[
                                    { title: 'Updated item', dataIndex: 'code', key: 'code', width: 180 },
                                    { title: 'Fields that change', key: 'changed', render: (_, r) => r.changed.join(', ') },
                                ]}
                            />
                        )}
                        {summary.dryRun && summary.compliancesNew + summary.compliancesUpdated === 0 && (
                            <Alert type="info" showIcon message="Nothing to import. Every row matches what is already in the library." />
                        )}
                    </Space>
                </Card>
            )}
        </Space>
    );
}