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
};
type RowError = { row: number; field?: string; message: string };
type Failure = { ok: false; errorCount: number; errors: RowError[]; ignoredColumns: string[] };
type Outcome = Summary | Failure;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

async function send(file: File, dryRun: boolean): Promise<Outcome> {
    const form = new FormData();
    form.append('file', file);
    const res = await apiRaw(`/library/import?dryRun=${dryRun}`, { method: 'POST', form });

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
            if (result.ok && !result.dryRun) await qc.invalidateQueries({ queryKey: ['library'] });
        } catch (e) {
            setOutcome(null);
            setError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const fileList: UploadFile[] = file ? [{ uid: 'file', name: file.name, status: 'done' }] : [];
    const readyToImport =
        outcome?.ok === true && outcome.dryRun && outcome.compliancesNew + outcome.compliancesUpdated > 0;

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Card size="small" title="Before you start">
                <Typography.Paragraph style={{ margin: 0 }}>
                    Save the sheet as <b>CSV UTF-8</b>. Required columns: <b>code, act, law category, jurisdiction, title, frequency</b>. Add{' '}
                    <b>state</b> for state laws, and <b>due day</b> for recurring items. Header names are matched loosely, so
                    &quot;Law Category&quot; and &quot;law_category&quot; both work. Each code is permanent: re-importing a code updates
                    that item. Format any code column as Text first, or Excel may turn long numbers into 1.2E+10.
                </Typography.Paragraph>
            </Card>

            <Upload
                accept=".csv"
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
                <Button icon={<UploadOutlined />}>Choose a CSV file</Button>
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

            {outcome && !outcome.ok && (
                <Card size="small" title={`${outcome.errorCount} problem${outcome.errorCount === 1 ? '' : 's'} found. Nothing was imported.`}>
                    {outcome.ignoredColumns.length > 0 && (
                        <Alert
                            type="info"
                            showIcon
                            style={{ marginBottom: 12 }}
                            message={`Columns that were not recognised and ignored: ${outcome.ignoredColumns.join(', ')}`}
                        />
                    )}
                    <Table<RowError>
                        size="small"
                        rowKey={(r) => `${r.row}:${r.field ?? ''}:${r.message}`}
                        dataSource={outcome.errors}
                        pagination={{ pageSize: 20, hideOnSinglePage: true }}
                        columns={[
                            { title: 'Row', dataIndex: 'row', key: 'row', width: 80 },
                            { title: 'Column', key: 'field', width: 160, render: (_, r) => r.field ?? '' },
                            { title: 'Problem', dataIndex: 'message', key: 'message' },
                        ]}
                    />
                    {outcome.errorCount > outcome.errors.length && (
                        <Typography.Text type="secondary">Showing the first {outcome.errors.length}. Fix these and preview again.</Typography.Text>
                    )}
                    <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                        Row 1 is the first row under the header.
                    </Typography.Paragraph>
                </Card>
            )}

            {outcome?.ok && (
                <Card
                    size="small"
                    title={outcome.dryRun ? 'Preview: this is what the import would do' : 'Imported'}
                >
                    <Space direction="vertical" style={{ width: '100%' }}>
                        {!outcome.dryRun && <Alert type="success" showIcon message="The library was updated." />}
                        {outcome.ignoredColumns.length > 0 && (
                            <Alert
                                type="info"
                                showIcon
                                message={`Columns that were not recognised and ignored: ${outcome.ignoredColumns.join(', ')}`}
                            />
                        )}
                        <Row gutter={[12, 12]}>
                            <Col xs={12} md={6}>
                                <Statistic title="Rows" value={outcome.totalRows} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="New" value={outcome.compliancesNew} valueStyle={{ color: '#389e0d' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Updated" value={outcome.compliancesUpdated} valueStyle={{ color: '#d46b08' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <Statistic title="Unchanged" value={outcome.compliancesUnchanged} />
                            </Col>
                        </Row>
                        <Typography.Text type="secondary">
                            New Acts {outcome.newActs}, rules {outcome.newRules}, law categories {outcome.newLawCategories}, authorities{' '}
                            {outcome.newStatutoryAuthorities}, natures {outcome.newNatures}, types {outcome.newTypes}.
                        </Typography.Text>
                        {outcome.sampleUpdates.length > 0 && (
                            <Table
                                size="small"
                                rowKey="code"
                                dataSource={outcome.sampleUpdates}
                                pagination={false}
                                columns={[
                                    { title: 'Updated item', dataIndex: 'code', key: 'code', width: 180 },
                                    { title: 'Fields that change', key: 'changed', render: (_, r) => r.changed.join(', ') },
                                ]}
                            />
                        )}
                        {outcome.dryRun && outcome.compliancesNew + outcome.compliancesUpdated === 0 && (
                            <Alert type="info" showIcon message="Nothing to import. Every row matches what is already in the library." />
                        )}
                    </Space>
                </Card>
            )}
        </Space>
    );
}