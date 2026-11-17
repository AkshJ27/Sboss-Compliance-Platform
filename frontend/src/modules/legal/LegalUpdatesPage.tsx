import { useState } from 'react';
import {
    Alert, Badge, Button, Card, Col, Collapse, DatePicker, Dropdown, Input, Row, Select, Space, Table, Tooltip, Typography, message,
} from 'antd';
import type { TableProps } from 'antd';
import type { SorterResult } from 'antd/es/table/interface';
import { DownOutlined, FileExcelOutlined, FlagFilled, PaperClipOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api, apiDownload } from '../../core/api/client';
import { useMe } from '../../core/auth/useMe';
import { formatDate } from '../../core/format';
import { errorText } from '../../shared/errors';
import { regionLabel, useLegalFilters, useLegalRules } from './api';
import type { LegalPage, LegalRow } from './api';
import { AttachmentsModal } from './AttachmentsModal';
import { LegalDetailDrawer } from './LegalDetailDrawer';
import { LegalUpdateForm } from './LegalUpdateForm';
import { LegalUploadModal } from './LegalUploadModal';

type Filters = {
    region?: string;
    lawCategoryId?: string;
    actId?: string;
    ruleId?: string;
    impact?: 'yes' | 'no';
    from?: Dayjs | null;
    to?: Dayjs | null;
};
type SortField = 'notificationDate' | 'publishedDate' | 'referenceNumber' | 'title';

const IMPACT_ROW = '#ffd6d6';

export default function LegalUpdatesPage() {
    const navigate = useNavigate();
    const me = useMe();
    const platformAdmin = !!me.data?.isPlatformAdmin;
    const [notify, holder] = message.useMessage();
    const [view, setView] = useState<'mapped' | 'all'>('mapped');
    const [filters, setFilters] = useState<Filters>({});
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<{ field: SortField; order: 'asc' | 'desc' }>({ field: 'notificationDate', order: 'desc' });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [openId, setOpenId] = useState<string | null>(null);
    const [filesOf, setFilesOf] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [exporting, setExporting] = useState(false);

    const options = useLegalFilters();
    const rules = useLegalRules(filters.actId);
    const set = (patch: Partial<Filters>) => {
        setFilters((f) => ({ ...f, ...patch }));
        setPage(1);
    };

    const params = new URLSearchParams({ view, page: String(page), limit: String(limit), sort: sort.field, order: sort.order });
    for (const k of ['region', 'lawCategoryId', 'actId', 'ruleId', 'impact'] as const) {
        const v = filters[k];
        if (v) params.set(k, v);
    }
    if (filters.from) params.set('from', filters.from.format('YYYY-MM-DD'));
    if (filters.to) params.set('to', filters.to.format('YYYY-MM-DD'));
    if (search) params.set('search', search);
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['legal', 'list', qs],
        queryFn: ({ signal }) => api<LegalPage>(`/legal-updates?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const exportXlsx = async () => {
        setExporting(true);
        try {
            const p = new URLSearchParams(qs);
            p.delete('page');
            p.delete('limit');
            await apiDownload(`/legal-updates/export?${p.toString()}`);
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setExporting(false);
        }
    };

    const sortable = (field: SortField) => ({
        sorter: true,
        sortOrder: sort.field === field ? (sort.order === 'asc' ? ('ascend' as const) : ('descend' as const)) : null,
    });

    const columns: TableProps<LegalRow>['columns'] = [
        { title: 'Notification Date', key: 'notificationDate', width: 140, ...sortable('notificationDate'), render: (_, r) => formatDate(r.notificationDate) },
        { title: 'Notification No', key: 'referenceNumber', dataIndex: 'referenceNumber', width: 180, ellipsis: true, ...sortable('referenceNumber') },
        { title: 'Published Date', key: 'publishedDate', width: 130, ...sortable('publishedDate'), render: (_, r) => formatDate(r.publishedDate) },
        { title: 'Law Category', key: 'cat', width: 160, ellipsis: true, render: (_, r) => r.act.lawCategory.name },
        { title: 'Act', key: 'act', width: 240, ellipsis: true, render: (_, r) => <Tooltip title={r.act.name}>{r.act.name}</Tooltip> },
        { title: 'Cent/State', key: 'region', width: 120, render: (_, r) => regionLabel(r.act) },
        { title: 'Title', key: 'title', dataIndex: 'title', ellipsis: true, ...sortable('title'), render: (t: string) => <Tooltip title={t}>{t}</Tooltip> },
        {
            title: 'Attachment',
            key: 'files',
            width: 100,
            render: (_, r) =>
                r.fileCount ? (
                    <Badge count={r.fileCount} size="small" color="#1f3a68">
                        <Button
                            type="text"
                            size="small"
                            icon={<PaperClipOutlined />}
                            onClick={(e) => {
                                e.stopPropagation();
                                setFilesOf(r.id);
                            }}
                        />
                    </Badge>
                ) : (
                    ''
                ),
        },
    ];

    const opt = (list: { id: string; name: string }[] | undefined) => (list ?? []).map((x) => ({ value: x.id, label: x.name }));
    const acts = (options.data?.acts ?? []).filter(
        (a) =>
            (!filters.lawCategoryId || a.lawCategoryId === filters.lawCategoryId) &&
            (!filters.region || (filters.region === 'CENTRAL' ? !a.state : a.state === filters.region)),
    );
    const activeFilters = Object.values(filters).filter(Boolean).length;

    const viewButton = (key: 'mapped' | 'all', label: string, count: number | undefined, color: string) => (
        <Button
            size="large"
            style={{
                minWidth: 220,
                background: color,
                borderColor: view === key ? '#1f3a68' : color,
                borderWidth: view === key ? 2 : 1,
                fontWeight: view === key ? 600 : 400,
            }}
            onClick={() => {
                setView(key);
                setPage(1);
            }}
        >
            {label} &nbsp; {count ?? 0}
        </Button>
    );

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {holder}
            <Row justify="space-between" align="middle" gutter={[8, 8]}>
                <Col>
                    <Typography.Title level={4} style={{ margin: 0 }}>
                        Legal Update
                    </Typography.Title>
                </Col>
                <Col>
                    <Space wrap>
                        <Button type="primary" style={{ background: '#52a447' }} icon={<SettingOutlined />} onClick={() => navigate('/legal-updates/configure')}>
                            Configure LU Page
                        </Button>
                        {platformAdmin && (
                            <Dropdown
                                menu={{
                                    items: [
                                        { key: 'add', label: 'Add legal update' },
                                        { key: 'upload', label: 'Upload legal updates (Excel)' },
                                    ],
                                    onClick: ({ key }) => (key === 'add' ? setAdding(true) : setUploading(true)),
                                }}
                            >
                                <Button type="primary">
                                    LU Masters <DownOutlined />
                                </Button>
                            </Dropdown>
                        )}
                    </Space>
                </Col>
            </Row>

            <Collapse
                items={[
                    {
                        key: 'f',
                        label: `Filters${activeFilters ? ` (${activeFilters} applied)` : ''}`,
                        extra: (
                            <Tooltip title="Clear filters">
                                <Button
                                    size="small"
                                    icon={<ReloadOutlined />}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setFilters({});
                                        setPage(1);
                                    }}
                                />
                            </Tooltip>
                        ),
                        children: (
                            <Row gutter={[12, 8]}>
                                <Col xs={24} sm={12} lg={5}>
                                    <Typography.Text strong>Central/State</Typography.Text>
                                    <Select
                                        allowClear
                                        showSearch
                                        placeholder="Select"
                                        style={{ width: '100%' }}
                                        value={filters.region}
                                        options={[{ value: 'CENTRAL', label: 'Central' }, ...(options.data?.states ?? []).map((s) => ({ value: s, label: s }))]}
                                        onChange={(v) => set({ region: v, actId: undefined, ruleId: undefined })}
                                    />
                                </Col>
                                <Col xs={24} sm={12} lg={5}>
                                    <Typography.Text strong>Law Category</Typography.Text>
                                    <Select
                                        allowClear
                                        showSearch
                                        optionFilterProp="label"
                                        placeholder="Select"
                                        style={{ width: '100%' }}
                                        value={filters.lawCategoryId}
                                        options={opt(options.data?.lawCategories)}
                                        onChange={(v) => set({ lawCategoryId: v, actId: undefined, ruleId: undefined })}
                                    />
                                </Col>
                                <Col xs={24} sm={12} lg={5}>
                                    <Typography.Text strong>Act</Typography.Text>
                                    <Select
                                        allowClear
                                        showSearch
                                        optionFilterProp="label"
                                        placeholder="Select"
                                        style={{ width: '100%' }}
                                        value={filters.actId}
                                        options={opt(acts)}
                                        onChange={(v) => set({ actId: v, ruleId: undefined })}
                                    />
                                </Col>
                                <Col xs={24} sm={12} lg={5}>
                                    <Typography.Text strong>Rule</Typography.Text>
                                    <Select
                                        allowClear
                                        showSearch
                                        optionFilterProp="label"
                                        placeholder={filters.actId ? 'Select' : 'Choose the Act first'}
                                        disabled={!filters.actId}
                                        style={{ width: '100%' }}
                                        value={filters.ruleId}
                                        options={opt(rules.data)}
                                        onChange={(v) => set({ ruleId: v })}
                                    />
                                </Col>
                                <Col xs={24} sm={12} lg={4}>
                                    <Typography.Text strong>Compliance Impact</Typography.Text>
                                    <Select
                                        allowClear
                                        placeholder="Select"
                                        style={{ width: '100%' }}
                                        value={filters.impact}
                                        options={[
                                            { value: 'yes', label: 'Yes' },
                                            { value: 'no', label: 'No' },
                                        ]}
                                        onChange={(v) => set({ impact: v })}
                                    />
                                </Col>
                                <Col xs={12} lg={5}>
                                    <Typography.Text strong>From Date</Typography.Text>
                                    <DatePicker
                                        format="DD-MMM-YYYY"
                                        style={{ width: '100%' }}
                                        value={filters.from}
                                        disabledDate={(d) => !!filters.to && d.isAfter(filters.to, 'day')}
                                        onChange={(d) => set({ from: d })}
                                    />
                                </Col>
                                <Col xs={12} lg={5}>
                                    <Typography.Text strong>To Date</Typography.Text>
                                    <DatePicker
                                        format="DD-MMM-YYYY"
                                        style={{ width: '100%' }}
                                        value={filters.to}
                                        disabledDate={(d) => !!filters.from && d.isBefore(filters.from, 'day')}
                                        onChange={(d) => set({ to: d })}
                                    />
                                </Col>
                            </Row>
                        ),
                    },
                ]}
            />

            <Card size="small">
                <Space direction="vertical" style={{ width: '100%' }}>
                    <Space wrap style={{ justifyContent: 'center', width: '100%' }}>
                        {viewButton('mapped', 'Mapped', q.data?.mappedTotal, '#d6e4f0')}
                        {viewButton('all', 'ALL', q.data?.allTotal, '#fadb14')}
                    </Space>
                    <Typography.Text strong>
                        <FlagFilled style={{ color: '#ff9c9c' }} /> Compliances are impacted by these Legal Updates
                    </Typography.Text>
                    {view === 'mapped' && q.data && q.data.mappedTotal === 0 && !activeFilters && !search && (
                        <Alert
                            type="info"
                            showIcon
                            message="You are not following any Acts yet"
                            description="Choose the Acts that matter to you on the Configure LU Page. Their updates then show here."
                            action={
                                <Button size="small" onClick={() => navigate('/legal-updates/configure')}>
                                    Configure
                                </Button>
                            }
                        />
                    )}
                    <Row gutter={8} align="middle" justify="center">
                        <Col xs={20} lg={14}>
                            <Input.Search
                                allowClear
                                maxLength={100}
                                placeholder={view === 'mapped' ? 'Search in Mapped' : 'Search in All'}
                                onSearch={(v) => {
                                    setSearch(v.trim());
                                    setPage(1);
                                }}
                            />
                        </Col>
                        <Col>
                            <Tooltip title="Download as Excel">
                                <Button icon={<FileExcelOutlined style={{ color: '#1d6f42' }} />} loading={exporting} onClick={() => void exportXlsx()} />
                            </Tooltip>
                        </Col>
                    </Row>

                    {q.isError && (
                        <Alert
                            type="error"
                            showIcon
                            message="The legal updates could not be loaded"
                            description={q.error.message}
                            action={
                                <Button size="small" onClick={() => void q.refetch()}>
                                    Retry
                                </Button>
                            }
                        />
                    )}

                    <Table<LegalRow>
                        rowKey="id"
                        size="middle"
                        columns={columns}
                        dataSource={q.data?.items ?? []}
                        loading={q.isFetching}
                        scroll={{ x: 1400 }}
                        onRow={(r) => ({
                            onClick: () => setOpenId(r.id),
                            style: { cursor: 'pointer', background: r.complianceImpact ? IMPACT_ROW : undefined },
                        })}
                        onChange={(_, __, sorter, extra) => {
                            if (extra.action !== 'sort') return;
                            const s = sorter as SorterResult<LegalRow>;
                            setSort(s.order && s.columnKey ? { field: s.columnKey as SortField, order: s.order === 'ascend' ? 'asc' : 'desc' } : { field: 'notificationDate', order: 'desc' });
                            setPage(1);
                        }}
                        pagination={{
                            current: page,
                            pageSize: limit,
                            total: q.data?.total ?? 0,
                            showSizeChanger: true,
                            pageSizeOptions: [10, 25, 50, 100],
                            showTotal: (t, range) => `Showing ${range[0]} to ${range[1]} of ${t} entries`,
                            onChange: (p, s) => {
                                setPage(p);
                                setLimit(s);
                            },
                        }}
                    />
                </Space>
            </Card>

            {openId && <LegalDetailDrawer id={openId} onClose={() => setOpenId(null)} />}
            {filesOf && <AttachmentsModal id={filesOf} onClose={() => setFilesOf(null)} />}
            {adding && (
                <LegalUpdateForm
                    id="new"
                    onClose={() => setAdding(false)}
                    onSaved={(id) => {
                        setAdding(false);
                        setOpenId(id);
                    }}
                />
            )}
            {uploading && <LegalUploadModal onClose={() => setUploading(false)} />}
        </Space>
    );
}