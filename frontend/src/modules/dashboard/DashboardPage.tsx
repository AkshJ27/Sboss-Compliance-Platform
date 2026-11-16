import { useCallback, useMemo } from 'react';
import { Space, Tabs, Typography } from 'antd';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { STATUS_META, dimsToParams, parseDims, parsePeriod, periodToParams } from '../../core/filters';
import type { DashStatus, Dims, PeriodState } from '../../core/filters';
import { FilterPanel } from '../../shared/FilterPanel';
import { DataTab } from './DataTab';
import type { DataState } from './DataTab';
import { PeriodBar } from './PeriodBar';
import { StatusCards } from './StatusCards';
import { StatusCharts } from './StatusCharts';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The Data tab's own choices, kept in the address so a refresh or a shared link keeps them
function parseData(sp: URLSearchParams): DataState {
    const m = sp.get('month');
    const month = m && MONTH.test(m) ? m : dayjs().format('YYYY-MM');
    const d = sp.get('day');
    const day = d && DAY.test(d) && d.startsWith(month) ? d : null;
    const s = sp.get('dstatus');
    const status = s && s in STATUS_META ? (s as DashStatus) : null;
    return { month, day, status };
}

export default function DashboardPage() {
    const [sp, setSp] = useSearchParams();
    const navigate = useNavigate();
    const spKey = sp.toString();

    const view = sp.get('view') === 'data' ? 'data' : 'charts';
    const dims = useMemo(() => parseDims(new URLSearchParams(spKey)), [spKey]);
    const period = useMemo(() => parsePeriod(new URLSearchParams(spKey)), [spKey]);
    const data = useMemo(() => parseData(new URLSearchParams(spKey)), [spKey]);
    const params = useMemo(() => periodToParams(period, dimsToParams(dims)).toString(), [dims, period]);

    // Writes everything back to the address, so one change never drops another
    const update = useCallback(
        (next: { dims?: Dims; period?: PeriodState; view?: 'charts' | 'data'; data?: Partial<DataState> }) => {
            const p = periodToParams(next.period ?? period, dimsToParams(next.dims ?? dims));
            const v = next.view ?? view;
            if (v === 'data') p.set('view', 'data');
            const d = { ...data, ...next.data };
            if (v === 'data' || next.data) {
                p.set('month', d.month);
                if (d.day) p.set('day', d.day);
                if (d.status) p.set('dstatus', d.status);
            }
            setSp(p, { replace: true });
        },
        [dims, period, view, data, setSp],
    );
    const onDims = useCallback((next: Dims) => update({ dims: next }), [update]);

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

            <ModuleBoundary compact label="The filters" resetKey={spKey}>
                <FilterPanel dims={dims} onChange={onDims} />
            </ModuleBoundary>

            <Tabs
                activeKey={view}
                onChange={(k) => update({ view: k === 'data' ? 'data' : 'charts' })}
                items={[
                    {
                        key: 'charts',
                        label: 'Charts',
                        children: (
                            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                                <PeriodBar period={period} onChange={(next) => update({ period: next })} />
                                <ModuleBoundary compact label="The status cards" resetKey={spKey}>
                                    <StatusCards params={params} onOpen={openRecords} />
                                </ModuleBoundary>
                                <ModuleBoundary compact label="The charts" resetKey={spKey}>
                                    <StatusCharts params={params} onOpen={openRecords} />
                                </ModuleBoundary>
                            </Space>
                        ),
                    },
                    {
                        key: 'data',
                        label: 'Data',
                        children: (
                            <ModuleBoundary compact label="The data view" resetKey={spKey}>
                                <DataTab dims={dims} state={data} onChange={(next) => update({ data: next })} />
                            </ModuleBoundary>
                        ),
                    },
                ]}
            />
        </Space>
    );
}