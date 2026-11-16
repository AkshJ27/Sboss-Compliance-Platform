import { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Card, Dropdown, Empty, Select, Skeleton, Space, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { apiDownload } from '../../core/api/client';
import { dimsToParams, parseDims, parsePeriod, periodToParams } from '../../core/filters';
import type { DashStatus, Dims, PeriodState } from '../../core/filters';
import { formatDate } from '../../core/format';
import { FilterPanel } from '../../shared/FilterPanel';
import { PeriodBar } from '../dashboard/PeriodBar';
import { useSummaryReport } from './api';
import { SummaryChart } from './SummaryChart';
import { SummaryTable } from './SummaryTable';
import { GROUP_OPTIONS, isGroupBy } from './types';
import type { GroupBy, SummaryRow } from './types';

export default function ReportsPage() {
    const [sp, setSp] = useSearchParams();
    const navigate = useNavigate();
    const [messageApi, contextHolder] = message.useMessage();
    const [exporting, setExporting] = useState(false);
    const spKey = sp.toString();

    const dims = useMemo(() => parseDims(new URLSearchParams(spKey)), [spKey]);
    const period = useMemo(() => parsePeriod(new URLSearchParams(spKey)), [spKey]);
    const rawGroup = sp.get('groupBy');
    const groupBy: GroupBy = isGroupBy(rawGroup) ? rawGroup : 'entityId';

    const params = useMemo(() => {
        const p = periodToParams(period, dimsToParams(dims));
        p.set('groupBy', groupBy);
        return p.toString();
    }, [dims, period, groupBy]);

    const report = useSummaryReport(params);
    const data = report.data;

    const update = useCallback(
        (next: { dims?: Dims; period?: PeriodState; groupBy?: GroupBy }) => {
            const p = periodToParams(next.period ?? period, dimsToParams(next.dims ?? dims));
            const g = next.groupBy ?? groupBy;
            if (g !== 'entityId') p.set('groupBy', g);
            setSp(p, { replace: true });
        },
        [dims, period, groupBy, setSp],
    );
    const onDims = useCallback((next: Dims) => update({ dims: next }), [update]);

    // A count opens the record list with the same filters, narrowed to that group and status
    const openRecords = useCallback(
        (row: SummaryRow, status?: DashStatus) => {
            if (!data) return;
            const q = dimsToParams(dims);
            if (row.key !== null) q.set(data.groupBy, row.key);
            if (status) q.set('dashboardStatus', status);
            q.set('dueFrom', data.period.from);
            q.set('dueTo', data.period.to);
            navigate(`/records?${q.toString()}`);
        },
        [data, dims, navigate],
    );

    const doExport = async (key: string) => {
        if (!data) return;
        const [what, format] = key.split(':');
        setExporting(true);
        try {
            if (what === 'summary') {
                await apiDownload(`/reports/summary/export?${params}&format=${format}`);
            } else {
                // Every record behind the summary, using the period the server worked out
                const q = dimsToParams(dims);
                q.set('dueFrom', data.period.from);
                q.set('dueTo', data.period.to);
                q.set('format', format);
                await apiDownload(`/reports/instances?${q.toString()}`);
            }
        } catch (e) {
            messageApi.error(e instanceof Error ? e.message : 'The export failed');
        } finally {
            setExporting(false);
        }
    };

    const groupLabel = data?.groupLabel ?? GROUP_OPTIONS.find((o) => o.value === groupBy)!.label;

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {contextHolder}
            <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                <Typography.Title level={4} style={{ margin: 0 }}>
                    Reports
                </Typography.Title>
                <Dropdown
                    disabled={!data}
                    menu={{
                        onClick: ({ key }) => void doExport(key),
                        items: [
                            {
                                type: 'group',
                                label: `Summary by ${groupLabel.toLowerCase()}`,
                                children: [
                                    { key: 'summary:xlsx', label: 'Excel (.xlsx)' },
                                    { key: 'summary:csv', label: 'CSV' },
                                ],
                            },
                            { type: 'divider' },
                            {
                                type: 'group',
                                label: 'Every record in this report',
                                children: [
                                    { key: 'records:xlsx', label: 'Excel (.xlsx)' },
                                    { key: 'records:csv', label: 'CSV' },
                                ],
                            },
                        ],
                    }}
                >
                    <Button icon={<DownloadOutlined />} loading={exporting}>
                        Export
                    </Button>
                </Dropdown>
            </Space>

            <Space wrap size="middle">
                <PeriodBar period={period} onChange={(next) => update({ period: next })} />
                <Space>
                    <Typography.Text type="secondary">Group by</Typography.Text>
                    <Select<GroupBy>
                        style={{ width: 160 }}
                        value={groupBy}
                        options={GROUP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                        onChange={(g) => update({ groupBy: g })}
                    />
                </Space>
            </Space>

            <ModuleBoundary compact label="The filters" resetKey={spKey}>
                <FilterPanel dims={dims} onChange={onDims} />
            </ModuleBoundary>

            {report.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The report could not be loaded"
                    description={report.error instanceof Error ? report.error.message : undefined}
                    action={
                        <Button size="small" onClick={() => void report.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            {!data && report.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}

            {data && (
                <>
                    <Typography.Text type="secondary">
                        {data.totals.total} items due {formatDate(data.period.from)} to {formatDate(data.period.to)}
                        {data.period.financialYear ? ` (FY ${data.period.financialYear})` : ''}, grouped by{' '}
                        {data.groupLabel.toLowerCase()}. Status as of {formatDate(data.asOf)}.
                    </Typography.Text>

                    {data.rows.length > 1 && (
                        <ModuleBoundary compact label="The chart" resetKey={spKey}>
                            <Card size="small" title={`Largest ${Math.min(12, data.rows.length)} by number of items`}>
                                <SummaryChart rows={data.rows} onOpen={openRecords} />
                            </Card>
                        </ModuleBoundary>
                    )}

                    {data.rows.length === 0 ? (
                        <Card>
                            <Empty description="No items match these filters in this period" />
                        </Card>
                    ) : (
                        <SummaryTable
                            rows={data.rows}
                            totals={data.totals}
                            groupLabel={data.groupLabel}
                            loading={report.isFetching}
                            onOpen={openRecords}
                        />
                    )}
                </>
            )}
        </Space>
    );
}