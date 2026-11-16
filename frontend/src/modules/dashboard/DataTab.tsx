import { lazy, Suspense, useMemo, useState } from 'react';
import { Alert, Badge, Button, Dropdown, Select, Skeleton, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { DownloadOutlined, LeftOutlined, RightOutlined, UnorderedListOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { api, apiDownload } from '../../core/api/client';
import { CARD_KEY, STATUS_META, STATUS_ORDER, dimsToParams } from '../../core/filters';
import type { DashStatus, Dims } from '../../core/filters';
import { formatDate, titleCase } from '../../core/format';
import { useMonthDays } from './api';
import type { Counts } from './types';

const RecordDrawer = lazy(() => import('../records/RecordDrawer'));

type Row = {
    id: string;
    dashboardStatus: DashStatus;
    dueDate: string;
    compliance: { code: string; title: string; risk: 'HIGH' | 'MEDIUM' | 'LOW'; frequency: string; act: { name: string } };
    entity: { name: string };
    vertical: { name: string } | null;
    department: { name: string } | null;
    location: { name: string };
    owner: { name: string };
    manager: { name: string };
};
type Page = { items: Row[]; total: number };

export type DataState = { month: string; day: string | null; status: DashStatus | null };

type Props = {
    dims: Dims;
    state: DataState;
    onChange: (next: Partial<DataState>) => void;
};

const RISK_COLOR = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' } as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// The colour under a day: the most urgent status that has items that day
const URGENCY: DashStatus[] = ['NON_COMPLIANCE', 'DUE', 'PENDING_APPROVAL', 'LATE_CLOSURE', 'ON_TIME', 'NOT_APPLICABLE'];

const worstOf = (c: Counts): DashStatus | null => URGENCY.find((s) => c[CARD_KEY[s]] > 0) ?? null;

export function DataTab({ dims, state, onChange }: Props) {
    const navigate = useNavigate();
    const [notify, holder] = message.useMessage();
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [open, setOpen] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);

    const month = dayjs(`${state.month}-01`);
    const dimsQs = dimsToParams(dims).toString();

    const daysParams = useMemo(() => {
        const p = new URLSearchParams(dimsQs);
        p.set('month', state.month);
        return p.toString();
    }, [dimsQs, state.month]);
    const days = useMonthDays(daysParams);
    const byDate = useMemo(() => new Map((days.data?.days ?? []).map((d) => [d.date, d])), [days.data]);

    // What the table and the status bar show: one day, or the whole month
    const range = state.day ? { from: state.day, to: state.day } : { from: month.format('YYYY-MM-DD'), to: month.endOf('month').format('YYYY-MM-DD') };
    const barCounts: Counts | undefined = state.day ? byDate.get(state.day)?.counts : days.data?.totals;

    const filterParams = useMemo(() => {
        const p = new URLSearchParams(dimsQs);
        p.set('dueFrom', range.from);
        p.set('dueTo', range.to);
        if (state.status) p.set('dashboardStatus', state.status);
        return p;
    }, [dimsQs, range.from, range.to, state.status]);
    const listQs = `${filterParams.toString()}&page=${page}&limit=${limit}`;

    const list = useQuery({
        queryKey: ['records', 'dashboard-data', listQs],
        queryFn: ({ signal }) => api<Page>(`/compliance/instances?${listQs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const change = (next: Partial<DataState>) => {
        setPage(1);
        onChange(next);
    };
    const goMonth = (m: Dayjs) => change({ month: m.format('YYYY-MM'), day: null });

    const doExport = async (format: string) => {
        setExporting(true);
        try {
            await apiDownload(`/reports/instances?${filterParams.toString()}&format=${format}`);
        } catch (e) {
            notify.error(e instanceof Error ? e.message : 'The export failed');
        } finally {
            setExporting(false);
        }
    };

    const today = dayjs().format('YYYY-MM-DD');
    const year = month.year();
    const years = Array.from({ length: 7 }, (_, i) => dayjs().year() - 4 + i);
    const dayList = Array.from({ length: month.daysInMonth() }, (_, i) => month.date(i + 1));

    const columns: TableProps<Row>['columns'] = [
        {
            title: 'Status',
            key: 's',
            width: 150,
            render: (_, r) => <Badge color={STATUS_META[r.dashboardStatus].color} text={STATUS_META[r.dashboardStatus].label} />,
        },
        { title: 'Owner', key: 'o', width: 130, render: (_, r) => r.owner.name },
        { title: 'Manager', key: 'm', width: 130, render: (_, r) => r.manager.name },
        { title: 'Entity', key: 'e', width: 180, ellipsis: true, render: (_, r) => r.entity.name },
        { title: 'Vertical', key: 'v', width: 110, render: (_, r) => r.vertical?.name ?? '' },
        { title: 'Dept', key: 'd', width: 130, render: (_, r) => r.department?.name ?? '' },
        { title: 'Location', key: 'l', width: 140, render: (_, r) => r.location.name },
        { title: 'Act', key: 'a', width: 200, ellipsis: true, render: (_, r) => r.compliance.act.name },
        {
            title: 'Compliance',
            key: 'c',
            width: 260,
            render: (_, r) => (
                <div>
                    <div>{r.compliance.title}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.compliance.code}
                    </Typography.Text>
                </div>
            ),
        },
        { title: 'Due date', key: 'due', width: 110, render: (_, r) => formatDate(r.dueDate) },
        { title: 'Periodicity', key: 'f', width: 110, render: (_, r) => titleCase(r.compliance.frequency) },
        { title: 'Risk', key: 'r', width: 80, render: (_, r) => <Tag color={RISK_COLOR[r.compliance.risk]}>{titleCase(r.compliance.risk)}</Tag> },
    ];

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {holder}

            <Space style={{ width: '100%', justifyContent: 'center' }}>
                <Select
                    style={{ width: 140 }}
                    value={month.month()}
                    options={MONTHS.map((m, i) => ({ value: i, label: m }))}
                    onChange={(m: number) => goMonth(month.month(m))}
                />
                <Select
                    style={{ width: 100 }}
                    value={year}
                    options={years.map((y) => ({ value: y, label: String(y) }))}
                    onChange={(y: number) => goMonth(month.year(y))}
                />
            </Space>

            <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
                <Button icon={<LeftOutlined />} aria-label="Previous month" onClick={() => goMonth(month.subtract(1, 'month'))} style={{ height: 'auto' }} />
                <div style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 1, paddingBottom: 4 }}>
                    {dayList.map((d) => {
                        const key = d.format('YYYY-MM-DD');
                        const info = byDate.get(key);
                        const worst = info ? worstOf(info.counts) : null;
                        const selected = state.day === key;
                        const weekend = d.day() === 0 || d.day() === 6;
                        return (
                            <Tooltip key={key} title={info ? `${info.total} item(s) due` : 'Nothing due'}>
                                <button
                                    type="button"
                                    onClick={() => change({ day: selected ? null : key })}
                                    aria-pressed={selected}
                                    style={{
                                        minWidth: 44,
                                        padding: '6px 4px 4px',
                                        border: selected ? '2px solid #1677ff' : '1px solid rgba(0,0,0,0.08)',
                                        borderRadius: 6,
                                        background: selected ? 'rgba(22,119,255,0.08)' : weekend ? 'rgba(0,0,0,0.03)' : 'transparent',
                                        cursor: 'pointer',
                                        textAlign: 'center',
                                        fontWeight: key === today ? 700 : 400,
                                    }}
                                >
                                    <div style={{ fontSize: 11, opacity: 0.7 }}>{d.format('ddd')}</div>
                                    <div style={{ fontSize: 15 }}>{d.date()}</div>
                                    <div style={{ height: 3, marginTop: 3, borderRadius: 2, background: worst ? STATUS_META[worst].color : 'transparent' }} />
                                </button>
                            </Tooltip>
                        );
                    })}
                </div>
                <Button icon={<RightOutlined />} aria-label="Next month" onClick={() => goMonth(month.add(1, 'month'))} style={{ height: 'auto' }} />
            </div>

            {days.isError && <Alert type="warning" showIcon message="The day counts could not be loaded" />}

            {!barCounts && days.isLoading ? (
                <Skeleton.Button active block />
            ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {STATUS_ORDER.map((s) => {
                        const n = barCounts ? barCounts[CARD_KEY[s]] : 0;
                        const on = state.status === s;
                        return (
                            <button
                                key={s}
                                type="button"
                                aria-pressed={on}
                                onClick={() => change({ status: on ? null : s })}
                                style={{
                                    flex: '1 1 140px',
                                    padding: '8px 10px',
                                    background: STATUS_META[s].color,
                                    color: s === 'DUE' || s === 'NOT_APPLICABLE' || s === 'PENDING_APPROVAL' ? '#1f1f1f' : '#fff',
                                    border: on ? '3px solid #1f1f1f' : '3px solid transparent',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                }}
                            >
                                {STATUS_META[s].label} {n}
                            </button>
                        );
                    })}
                </div>
            )}

            <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                <Typography.Text type="secondary">
                    {state.day ? `Due on ${formatDate(state.day)}` : `Due in ${month.format('MMMM YYYY')}`}
                    {state.status ? `, ${STATUS_META[state.status].label.toLowerCase()}` : ', every status'}. Click a day or a
                    status to narrow the list, and click it again to clear.
                </Typography.Text>
                <Space>
                    <Button
                        icon={<UnorderedListOutlined />}
                        onClick={() => navigate(`/records?${filterParams.toString()}`)}
                    >
                        Open in Records
                    </Button>
                    <Dropdown
                        menu={{
                            items: [
                                { key: 'xlsx', label: 'Excel file' },
                                { key: 'csv', label: 'CSV file' },
                                { key: 'pdf', label: 'PDF (up to 200 records)' },
                            ],
                            onClick: ({ key }) => void doExport(key),
                        }}
                    >
                        <Button icon={<DownloadOutlined />} loading={exporting}>
                            Export
                        </Button>
                    </Dropdown>
                </Space>
            </Space>

            {list.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The records could not be loaded"
                    description={list.error.message}
                    action={
                        <Button size="small" onClick={() => void list.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<Row>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={list.data?.items ?? []}
                loading={list.isFetching}
                scroll={{ x: 1730 }}
                onRow={(r) => ({ onClick: () => setOpen(r.id), style: { cursor: 'pointer' } })}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: list.data?.total ?? 0,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 25, 50, 100],
                    showTotal: (t) => `${t} records`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />

            {open && (
                <ModuleBoundary compact label="The record panel" resetKey={open}>
                    <Suspense fallback={null}>
                        <RecordDrawer id={open} onClose={() => setOpen(null)} onNavigate={(id) => setOpen(id)} />
                    </Suspense>
                </ModuleBoundary>
            )}
        </Space>
    );
}