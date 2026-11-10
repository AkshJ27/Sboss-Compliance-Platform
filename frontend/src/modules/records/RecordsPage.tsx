import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
    Alert, Badge, Button, DatePicker, Dropdown, Input, Segmented, Space, Table, Tag, Typography, message,
} from 'antd';
import type { TableProps } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { api, apiDownload } from '../../core/api/client';
import { DIMENSIONS, STATUS_META, STATUS_ORDER, dimsToParams, parseDims } from '../../core/filters';
import type { DashStatus, Dims } from '../../core/filters';
import { formatDate, titleCase } from '../../core/format';
import { FilterPanel } from '../../shared/FilterPanel';

const RecordDrawer = lazy(() => import('./RecordDrawer'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
    id: string;
    dashboardStatus: DashStatus;
    dueDate: string;
    periodStart: string;
    periodEnd: string;
    compliance: {
        code: string;
        title: string;
        risk: 'HIGH' | 'MEDIUM' | 'LOW';
        frequency: string;
        act: { name: string; state: string | null };
    };
    location: { name: string; state: string };
    owner: { name: string };
    manager: { name: string };
    _count: { documents: number };
};
type Page = { items: Row[]; total: number; page: number; limit: number };

const RISK_COLOR = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' } as const;
const PAGE_SIZES = [10, 25, 50, 100];

export default function RecordsPage() {
    const [sp, setSp] = useSearchParams();
    const [messageApi, contextHolder] = message.useMessage();
    const [exporting, setExporting] = useState(false);
    const spKey = sp.toString();

    const dims = useMemo(() => parseDims(new URLSearchParams(spKey)), [spKey]);
    const rawStatus = sp.get('dashboardStatus');
    const status: DashStatus | 'ALL' = rawStatus && rawStatus in STATUS_META ? (rawStatus as DashStatus) : 'ALL';
    const dueFrom = sp.get('dueFrom') ?? '';
    const dueTo = sp.get('dueTo') ?? '';
    const search = sp.get('search') ?? '';
    const order = sp.get('order') === 'desc' ? 'desc' : 'asc';
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const requested = Number(sp.get('limit'));
    const limit = PAGE_SIZES.includes(requested) ? requested : 25;
    const rawOpen = sp.get('open');
    const openId = rawOpen && UUID.test(rawOpen) ? rawOpen : null;

    // The filters sent to the server, without page numbers
    const filterParams = useMemo(() => {
        const p = dimsToParams(dims);
        if (status !== 'ALL') p.set('dashboardStatus', status);
        if (dueFrom && dueTo) {
            p.set('dueFrom', dueFrom);
            p.set('dueTo', dueTo);
        }
        if (search) p.set('search', search);
        p.set('order', order);
        return p;
    }, [dims, status, dueFrom, dueTo, search, order]);

    const listQs = useMemo(() => {
        const p = new URLSearchParams(filterParams);
        p.set('page', String(page));
        p.set('limit', String(limit));
        return p.toString();
    }, [filterParams, page, limit]);

    const q = useQuery({
        queryKey: ['records', listQs],
        queryFn: ({ signal }) => api<Page>(`/compliance/instances?${listQs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const patch = useCallback(
        (changes: Record<string, string | null>) => {
            const next = new URLSearchParams(spKey);
            for (const [k, v] of Object.entries(changes)) {
                if (v) next.set(k, v);
                else next.delete(k);
            }
            next.delete('page');
            setSp(next, { replace: true });
        },
        [spKey, setSp],
    );

    const setOpen = useCallback(
        (id: string | null) => {
            const next = new URLSearchParams(spKey);
            if (id) next.set('open', id);
            else next.delete('open');
            setSp(next, { replace: id === null });
        },
        [spKey, setSp],
    );

    const onDims = useCallback(
        (d: Dims) => {
            const next = new URLSearchParams(spKey);
            for (const { key } of DIMENSIONS) next.delete(key);
            dimsToParams(d, next);
            next.delete('page');
            setSp(next, { replace: true });
        },
        [spKey, setSp],
    );

    const onTableChange: TableProps<Row>['onChange'] = (pagination, _filters, sorter) => {
        const s = Array.isArray(sorter) ? sorter[0] : sorter;
        const next = new URLSearchParams(spKey);
        next.set('page', String(pagination.current ?? 1));
        next.set('limit', String(pagination.pageSize ?? 25));
        if (s?.order === 'descend') next.set('order', 'desc');
        else next.delete('order');
        setSp(next, { replace: true });
    };

    const doExport = async (format: string) => {
        setExporting(true);
        try {
            await apiDownload(`/reports/instances?${filterParams.toString()}&format=${format}`);
        } catch (e) {
            messageApi.error(e instanceof Error ? e.message : 'The export failed');
        } finally {
            setExporting(false);
        }
    };

    const columns: TableProps<Row>['columns'] = [
        {
            title: 'Status',
            key: 'status',
            width: 150,
            render: (_, r) => (
                <Badge color={STATUS_META[r.dashboardStatus].color} text={STATUS_META[r.dashboardStatus].label} />
            ),
        },
        {
            title: 'Compliance',
            key: 'title',
            width: 320,
            render: (_, r) => (
                <div>
                    <div>{r.compliance.title}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.compliance.code}
                    </Typography.Text>
                </div>
            ),
        },
        {
            title: 'Act',
            key: 'act',
            width: 240,
            render: (_, r) =>
                r.compliance.act.state ? `${r.compliance.act.name} (${r.compliance.act.state})` : r.compliance.act.name,
        },
        { title: 'Location', key: 'location', width: 170, render: (_, r) => `${r.location.name}, ${r.location.state}` },
        { title: 'Owner', key: 'owner', width: 140, render: (_, r) => r.owner.name },
        { title: 'Manager', key: 'manager', width: 140, render: (_, r) => r.manager.name },
        {
            title: 'Due date',
            key: 'due',
            width: 120,
            sorter: true,
            sortDirections: ['ascend', 'descend'],
            sortOrder: order === 'desc' ? 'descend' : 'ascend',
            render: (_, r) => formatDate(r.dueDate),
        },
        {
            title: 'Period',
            key: 'period',
            width: 200,
            render: (_, r) => `${formatDate(r.periodStart)} to ${formatDate(r.periodEnd)}`,
        },
        {
            title: 'Risk',
            key: 'risk',
            width: 90,
            render: (_, r) => <Tag color={RISK_COLOR[r.compliance.risk]}>{titleCase(r.compliance.risk)}</Tag>,
        },
        { title: 'Periodicity', key: 'freq', width: 120, render: (_, r) => titleCase(r.compliance.frequency) },
        { title: 'Proof', key: 'proof', width: 70, render: (_, r) => r._count.documents },
    ];

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {contextHolder}
            <Typography.Title level={4} style={{ margin: 0 }}>
                Compliance records
            </Typography.Title>

            <ModuleBoundary compact label="The filters" resetKey={spKey}>
                <FilterPanel dims={dims} onChange={onDims} />
            </ModuleBoundary>

            <Segmented
                value={status}
                onChange={(v) => patch({ dashboardStatus: v === 'ALL' ? null : String(v) })}
                options={[
                    { label: 'All', value: 'ALL' },
                    ...STATUS_ORDER.map((s) => ({ label: STATUS_META[s].label, value: s })),
                ]}
            />

            <Space wrap>
                <Input.Search
                    key={search}
                    allowClear
                    maxLength={100}
                    placeholder="Search by title, code or Act"
                    defaultValue={search}
                    style={{ width: 300 }}
                    onSearch={(value) => patch({ search: value.trim() || null })}
                />
                <DatePicker.RangePicker
                    value={dueFrom && dueTo ? [dayjs(dueFrom), dayjs(dueTo)] : null}
                    onChange={(range) => {
                        if (range?.[0] && range[1]) {
                            patch({ dueFrom: range[0].format('YYYY-MM-DD'), dueTo: range[1].format('YYYY-MM-DD') });
                        } else {
                            patch({ dueFrom: null, dueTo: null });
                        }
                    }}
                />
                <Dropdown
                    menu={{
                        items: [
                            { key: 'csv', label: 'CSV file' },
                            { key: 'xlsx', label: 'Excel file' },
                        ],
                        onClick: ({ key }) => void doExport(key),
                    }}
                >
                    <Button icon={<DownloadOutlined />} loading={exporting}>
                        Export
                    </Button>
                </Dropdown>
            </Space>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The records could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<Row>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                scroll={{ x: 1500 }}
                onChange={onTableChange}
                onRow={(r) => ({ onClick: () => setOpen(r.id), style: { cursor: 'pointer' } })}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    pageSizeOptions: PAGE_SIZES,
                    showTotal: (total) => `${total} records`,
                }}
            />

            {openId && (
                <ModuleBoundary compact label="The record panel" resetKey={openId}>
                    <Suspense fallback={null}>
                        <RecordDrawer id={openId} onClose={() => setOpen(null)} onNavigate={(id) => setOpen(id)} />
                    </Suspense>
                </ModuleBoundary>
            )}
        </Space>
    );
}