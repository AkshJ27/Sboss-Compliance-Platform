import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Key } from 'react';
import {
    Alert, Badge, Button, DatePicker, Dropdown, Input, Segmented, Space, Table, Tag, Typography, message,
} from 'antd';
import type { TableColumnType, TableProps } from 'antd';
import type { SortOrder } from 'antd/es/table/interface';
import { DownloadOutlined, FilterFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { api, apiDownload } from '../../core/api/client';
import { DIMENSIONS, STATUS_META, STATUS_ORDER, dimsToParams, parseDims } from '../../core/filters';
import type { DashStatus, Dims } from '../../core/filters';
import { formatDate, titleCase } from '../../core/format';
import { FilterPanel } from '../../shared/FilterPanel';
import { ColumnRuleFilter, parseColumnFilters } from './ColumnRuleFilter';
import type { ColumnFilter, FilterKey } from './ColumnRuleFilter';

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
    entity: { name: string };
    vertical: { name: string } | null;
    department: { name: string } | null;
    location: { name: string; state: string };
    owner: { name: string };
    manager: { name: string };
    _count: { documents: number };
};
type Page = { items: Row[]; total: number; page: number; limit: number };

const RISK_COLOR = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' } as const;
const PAGE_SIZES = [10, 25, 50, 100];
const SORT_KEYS = ['dueDate', 'owner', 'manager', 'entity', 'vertical', 'department', 'location', 'act', 'title', 'frequency', 'risk'] as const;
type SortKey = (typeof SORT_KEYS)[number];
const MAX_SELECTED = 100;
const isSortKey = (v: string | null): v is SortKey => SORT_KEYS.some((k) => k === v);

export default function RecordsPage() {
    const [sp, setSp] = useSearchParams();
    const [messageApi, contextHolder] = message.useMessage();
    const [exporting, setExporting] = useState(false);
    const [selected, setSelected] = useState<Key[]>([]);
    const spKey = sp.toString();

    const dims = useMemo(() => parseDims(new URLSearchParams(spKey)), [spKey]);
    const rawStatus = sp.get('dashboardStatus');
    const status: DashStatus | 'ALL' = rawStatus && rawStatus in STATUS_META ? (rawStatus as DashStatus) : 'ALL';
    const dueFrom = sp.get('dueFrom') ?? '';
    const dueTo = sp.get('dueTo') ?? '';
    const search = sp.get('search') ?? '';
    const order = sp.get('order') === 'desc' ? 'desc' : 'asc';
    const rawSort = sp.get('sort');
    const sort: SortKey = isSortKey(rawSort) ? rawSort : 'dueDate';
    const rawCf = sp.get('cf');
    const columnFilters = useMemo(() => parseColumnFilters(rawCf), [rawCf]);
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
        if (columnFilters.length) p.set('cf', JSON.stringify(columnFilters));
        if (sort !== 'dueDate') p.set('sort', sort);
        p.set('order', order);
        return p;
    }, [dims, status, dueFrom, dueTo, search, columnFilters, sort, order]);
    const filterKey = filterParams.toString();

    // Ticked rows belong to one set of filters. When the filters change, start again.
    useEffect(() => {
        setSelected([]);
    }, [filterKey]);

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

    const setColumnFilter = (col: FilterKey, f: ColumnFilter | undefined) => {
        const next = [...columnFilters.filter((x) => x.col !== col), ...(f ? [f] : [])];
        patch({ cf: next.length ? JSON.stringify(next) : null });
    };

    const onTableChange: TableProps<Row>['onChange'] = (pagination, _filters, sorter) => {
        const s = Array.isArray(sorter) ? sorter[0] : sorter;
        const next = new URLSearchParams(spKey);
        next.set('page', String(pagination.current ?? 1));
        next.set('limit', String(pagination.pageSize ?? 25));
        const key = typeof s?.columnKey === 'string' && isSortKey(s.columnKey) ? s.columnKey : null;
        if (key && s?.order) {
            if (key === 'dueDate') next.delete('sort');
            else next.set('sort', key);
            if (s.order === 'descend') next.set('order', 'desc');
            else next.delete('order');
        } else {
            next.delete('sort');
            next.delete('order');
        }
        setSp(next, { replace: true });
    };

    const doExport = async (format: string) => {
        setExporting(true);
        try {
            const p = new URLSearchParams(filterParams);
            if (selected.length) p.set('ids', selected.join(','));
            p.set('format', format);
            await apiDownload(`/reports/instances?${p.toString()}`);
        } catch (e) {
            messageApi.error(e instanceof Error ? e.message : 'The export failed');
        } finally {
            setExporting(false);
        }
    };

    const sortable = (key: SortKey): Partial<TableColumnType<Row>> => ({
        key,
        sorter: true,
        sortDirections: ['ascend', 'descend'] as SortOrder[],
        sortOrder: sort === key ? (order === 'desc' ? 'descend' : 'ascend') : null,
    });

    const filterable = (col: FilterKey): Partial<TableColumnType<Row>> => {
        const value = columnFilters.find((f) => f.col === col);
        return {
            filtered: !!value,
            filterIcon: (on: boolean) => <FilterFilled style={{ color: on ? '#1677ff' : undefined }} />,
            filterDropdown: ({ close }) => (
                <ColumnRuleFilter
                    key={JSON.stringify(value ?? null)}
                    col={col}
                    value={value}
                    onApply={(f) => setColumnFilter(col, f)}
                    close={close}
                />
            ),
        };
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
        { title: 'Owner', width: 140, ...sortable('owner'), ...filterable('owner'), render: (_, r) => r.owner.name },
        { title: 'Manager', width: 140, ...sortable('manager'), ...filterable('manager'), render: (_, r) => r.manager.name },
        { title: 'Entity', width: 190, ellipsis: true, ...sortable('entity'), ...filterable('entity'), render: (_, r) => r.entity.name },
        { title: 'Vertical', width: 120, ...sortable('vertical'), ...filterable('vertical'), render: (_, r) => r.vertical?.name ?? '' },
        { title: 'Dept', width: 140, ...sortable('department'), ...filterable('department'), render: (_, r) => r.department?.name ?? '' },
        {
            title: 'Location',
            width: 170,
            ...sortable('location'),
            ...filterable('location'),
            render: (_, r) => `${r.location.name}, ${r.location.state}`,
        },
        {
            title: 'Act',
            width: 240,
            ellipsis: true,
            ...sortable('act'),
            ...filterable('act'),
            render: (_, r) =>
                r.compliance.act.state ? `${r.compliance.act.name} (${r.compliance.act.state})` : r.compliance.act.name,
        },
        {
            title: 'Compliance',
            width: 320,
            ...sortable('title'),
            ...filterable('title'),
            render: (_, r) => (
                <div>
                    <div>{r.compliance.title}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.compliance.code}
                    </Typography.Text>
                </div>
            ),
        },
        { title: 'Due date', width: 125, ...sortable('dueDate'), render: (_, r) => formatDate(r.dueDate) },
        {
            title: 'Period',
            key: 'period',
            width: 200,
            render: (_, r) =>
                r.compliance.frequency === 'EVENT_BASED'
                    ? `Event on ${formatDate(r.periodStart)}`
                    : `${formatDate(r.periodStart)} to ${formatDate(r.periodEnd)}`,
        },
        { title: 'Periodicity', width: 125, ...sortable('frequency'), render: (_, r) => titleCase(r.compliance.frequency) },
        {
            title: 'Risk',
            width: 95,
            ...sortable('risk'),
            render: (_, r) => <Tag color={RISK_COLOR[r.compliance.risk]}>{titleCase(r.compliance.risk)}</Tag>,
        },
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
                            { key: 'xlsx', label: 'Excel file' },
                            { key: 'csv', label: 'CSV file' },
                            { key: 'pdf', label: 'PDF (one sheet per record, up to 200)' },
                        ],
                        onClick: ({ key }) => void doExport(key),
                    }}
                >
                    <Button icon={<DownloadOutlined />} loading={exporting}>
                        {selected.length ? `Export ${selected.length} selected` : 'Export'}
                    </Button>
                </Dropdown>
                {columnFilters.length > 0 && (
                    <Button type="link" onClick={() => patch({ cf: null })}>
                        Clear column filters ({columnFilters.length})
                    </Button>
                )}
            </Space>

            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {selected.length
                    ? `${selected.length} row(s) ticked. Exports include only these. `
                    : 'To export every record that matches the filters, leave all the boxes unticked. '}
                {selected.length > 0 && (
                    <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setSelected([])}>
                        Clear the ticks
                    </Button>
                )}
            </Typography.Text>

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
                scroll={{ x: 2100 }}
                onChange={onTableChange}
                rowSelection={{
                    selectedRowKeys: selected,
                    preserveSelectedRowKeys: true,
                    onChange: (keys) => {
                        if (keys.length > MAX_SELECTED) {
                            messageApi.warning(`You can tick up to ${MAX_SELECTED} rows. To export more, untick all and use the filters.`);
                            setSelected(keys.slice(0, MAX_SELECTED));
                        } else {
                            setSelected(keys);
                        }
                    },
                }}
                onRow={(r) => ({
                    // A click on the tick box only ticks the row; anywhere else opens it
                    onClick: (e) => {
                        if ((e.target as HTMLElement).closest('.ant-table-selection-column')) return;
                        setOpen(r.id);
                    },
                    style: { cursor: 'pointer' },
                })}
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