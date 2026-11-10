import { useCallback, useMemo } from 'react';
import { Space, Typography } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { dimsToParams, parseDims, parsePeriod, periodToParams } from '../../core/filters';
import type { DashStatus, Dims, PeriodState } from '../../core/filters';
import { FilterPanel } from '../../shared/FilterPanel';
import { PeriodBar } from './PeriodBar';
import { StatusCards } from './StatusCards';
import { StatusCharts } from './StatusCharts';

export default function DashboardPage() {
    const [sp, setSp] = useSearchParams();
    const navigate = useNavigate();
    const spKey = sp.toString();

    const dims = useMemo(() => parseDims(new URLSearchParams(spKey)), [spKey]);
    const period = useMemo(() => parsePeriod(new URLSearchParams(spKey)), [spKey]);
    const params = useMemo(() => periodToParams(period, dimsToParams(dims)).toString(), [dims, period]);

    const update = useCallback(
        (nextDims: Dims, nextPeriod: PeriodState) => {
            setSp(periodToParams(nextPeriod, dimsToParams(nextDims)), { replace: true });
        },
        [setSp],
    );
    const onDims = useCallback((next: Dims) => update(next, period), [update, period]);

    // Cards and chart bars both open the record list with the same filters
    const openRecords = useCallback(
        (status: DashStatus, range: { from: string; to: string }) => {
            const q = dimsToParams(dims);
            q.set('dashboardStatus', status);
            q.set('dueFrom', range.from);
            q.set('dueTo', range.to);
            navigate(`/records?${q.toString()}`);
        },
        [dims, navigate],
    );

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
                Compliance dashboard
            </Typography.Title>

            <PeriodBar period={period} onChange={(next) => update(dims, next)} />

            <ModuleBoundary compact label="The filters" resetKey={spKey}>
                <FilterPanel dims={dims} onChange={onDims} />
            </ModuleBoundary>

            <ModuleBoundary compact label="The status cards" resetKey={spKey}>
                <StatusCards params={params} onOpen={openRecords} />
            </ModuleBoundary>

            <ModuleBoundary compact label="The charts" resetKey={spKey}>
                <StatusCharts params={params} onOpen={openRecords} />
            </ModuleBoundary>
        </Space>
    );
}