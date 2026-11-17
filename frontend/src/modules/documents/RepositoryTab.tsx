import { useState } from 'react';
import {
    Alert, Badge, Button, Card, Col, Collapse, DatePicker, Dropdown, Input, Popconfirm, Row, Select, Space, Table, Tag,
    Tooltip, Typography, message,
} from 'antd';
import type { TableProps } from 'antd';
import type { SorterResult } from 'antd/es/table/interface';
import {
    DeleteOutlined, DownOutlined, DownloadOutlined, EditOutlined, EyeOutlined, FileExcelOutlined, PlusOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { api, apiDownload } from '../../core/api/client';
import { useAuth } from '../../core/auth/AuthContext';
import { formatDate } from '../../core/format';
import { ACCESS_LABEL, downloadDocument } from '../../shared/documents';
import type { AccessLevel } from '../../shared/documents';
import { errorText } from '../../shared/errors';
import { useEntities, useSimple } from '../admin/api';
import { ACCESS_DOT, ACCESS_HELP, useDocCategories, useEntityLocations, useRecordSummary } from './api';
import type { DocRecord, RecordPage } from './api';
import { DocumentDataUploadModal } from './DocumentDataUploadModal';
import { DocumentMastersDrawer } from './DocumentMastersDrawer';
import type { MastersTab } from './DocumentMastersDrawer';
import { RecordFormModal } from './RecordFormModal';

type Filters = {
    entityId?: string;
    locationId?: string;
    departmentId?: string;
    accessLevel?: AccessLevel;
    categoryId?: string;
    subCategoryId?: string;
    subSubCategoryId?: string;
    from?: Dayjs | null;
    to?: Dayjs | null;
};
type Quick = 'none' | 'expired' | 'withoutFiles';
type SortField = 'name' | 'docNumber' | 'createdAt' | 'expiryDate' | 'reviewDate';

const LEVELS: AccessLevel[] = ['PUBLIC', 'PRIVATE', 'PROTECTED', 'RESTRICTED'];
const Dot = ({ level }: { level: AccessLevel }) => (
    <Tooltip title={`${ACCESS_LABEL[level]}: ${ACCESS_HELP[level]}`}>
        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: ACCESS_DOT[level], verticalAlign: 'middle' }} />
    </Tooltip>
);

export function RepositoryTab() {
    const qc = useQueryClient();
    const { user } = useAuth();
    const writer = user?.role !== 'VIEWER';
    const [notify, holder] = message.useMessage();

    const [filters, setFilters] = useState<Filters>({});
    const [quick, setQuick] = useState<Quick>('none');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<{ field: SortField; order: 'asc' | 'desc' }>({ field: 'createdAt', order: 'desc' });
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [open, setOpen] = useState<string | 'new' | null>(null);
    const [masters, setMasters] = useState<MastersTab | null>(null);
    const [uploading, setUploading] = useState(false);
    const [exporting, setExporting] = useState(false);

    const entities = useEntities(true);
    const departments = useSimple('departments', true);
    const locations = useEntityLocations(filters.entityId);
    const cats = useDocCategories(1, null, true);
    const subs = useDocCategories(2, filters.categoryId, true);
    const subSubs = useDocCategories(3, filters.subCategoryId, true);
    const summary = useRecordSummary();

    const set = (patch: Partial<Filters>) => {
        setFilters((f) => ({ ...f, ...patch }));
        setPage(1);
    };

    const params = new URLSearchParams({ page: String(page), limit: String(limit), sort: sort.field, order: sort.order });
    for (const k of ['entityId', 'locationId', 'departmentId', 'accessLevel', 'categoryId', 'subCategoryId', 'subSubCategoryId'] as const) {
        const v = filters[k];
        if (v) params.set(k, v);
    }
    if (filters.from) params.set('from', filters.from.format('YYYY-MM-DD'));
    if (filters.to) params.set('to', filters.to.format('YYYY-MM-DD'));
    if (quick === 'expired') params.set('expired', 'true');
    if (quick === 'withoutFiles') params.set('withoutFiles', 'true');
    if (search) params.set('search', search);
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['documents', 'records', 'list', qs],
        queryFn: ({ signal }) => api<RecordPage>(`/documents/records?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const refresh = () => qc.invalidateQueries({ queryKey: ['documents'] });

    const remove = async (r: DocRecord) => {
        try {
            await api(`/documents/records/${r.id}`, { method: 'DELETE' });
            notify.success('Document deleted');
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const download = async (r: DocRecord) => {
        try {
            for (const f of r.files) await downloadDocument(f.id);
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const exportXlsx = async () => {
        setExporting(true);
        try {
            const p = new URLSearchParams(qs);
            p.delete('page');
            p.delete('limit');
            await apiDownload(`/documents/records/export?${p.toString()}`);
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

    const columns: TableProps<DocRecord>['columns'] = [
        {
            title: 'Action',
            key: 'action',
            fixed: 'left',
            width: 130,
            render: (_, r) => (
                <Space size={2}>
                    <Tooltip title={r.can.edit ? 'Modify' : 'View'}>
                        <Button type="text" size="small" icon={r.can.edit ? <EditOutlined /> : <EyeOutlined />} onClick={() => setOpen(r.id)} />
                    </Tooltip>
                    <Tooltip title={!r.can.open ? 'Only the named people can open these files' : r.files.length ? `Download ${r.files.length} file(s)` : 'No files yet'}>
                        <Button type="text" size="small" icon={<DownloadOutlined />} disabled={!r.can.open || !r.files.length} onClick={() => void download(r)} />
                    </Tooltip>
                    {r.can.delete && (
                        <Popconfirm title="Delete this document?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => void remove(r)}>
                            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                    )}
                </Space>
            ),
        },
        { title: '', key: 'level', width: 34, render: (_, r) => <Dot level={r.accessLevel} /> },
        { title: 'Entity', key: 'entity', width: 160, render: (_, r) => r.entity.name },
        { title: 'Department', key: 'dept', width: 160, render: (_, r) => r.department.name },
        { title: 'Location', key: 'loc', width: 140, render: (_, r) => r.location.name },
        {
            title: 'Category',
            key: 'cat',
            width: 180,
            render: (_, r) => (
                <div>
                    <div>{r.category.name}</div>
                    {(r.subCategory || r.subSubCategory) && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {[r.subCategory?.name, r.subSubCategory?.name].filter(Boolean).join(' / ')}
                        </Typography.Text>
                    )}
                </div>
            ),
        },
        { title: 'Doc Number', key: 'docNumber', dataIndex: 'docNumber', width: 140, ...sortable('docNumber') },
        { title: 'Doc Name', key: 'name', dataIndex: 'name', width: 220, ...sortable('name') },
        {
            title: 'File Name',
            key: 'files',
            width: 220,
            ellipsis: true,
            render: (_, r) =>
                !r.fileCount ? (
                    <Tag color="red">No file</Tag>
                ) : r.can.open ? (
                    <Tooltip title={r.files.map((f) => f.fileName).join(', ')}>
                        {r.files[0].fileName}
                        {r.files.length > 1 && <Badge count={`+${r.files.length - 1}`} style={{ marginLeft: 6, background: '#1677ff' }} />}
                    </Tooltip>
                ) : (
                    <Typography.Text type="secondary">{r.fileCount} file(s)</Typography.Text>
                ),
        },
        { title: 'Owner', key: 'owner', width: 150, render: (_, r) => r.owner.name },
        { title: 'Created Date', key: 'createdAt', width: 130, ...sortable('createdAt'), render: (_, r) => dayjs(r.createdAt).format('DD-MMM-YYYY') },
        { title: 'Review Date', key: 'reviewDate', width: 130, ...sortable('reviewDate'), render: (_, r) => formatDate(r.reviewDate) },
        {
            title: 'Expiry Date',
            key: 'expiryDate',
            width: 150,
            ...sortable('expiryDate'),
            render: (_, r) =>
                r.expiryDate ? (
                    <Space>
                        {formatDate(r.expiryDate)}
                        {r.expired && <Tag color="red">Expired</Tag>}
                    </Space>
                ) : (
                    ''
                ),
        },
    ];

    const option = (rows: { id: string; name: string; isActive: boolean }[] | undefined) =>
        (rows ?? []).map((x) => ({ value: x.id, label: x.isActive ? x.name : `${x.name} (inactive)` }));

    const quickButton = (key: Exclude<Quick, 'none'>, label: string, count: number | undefined, danger: boolean) => (
        <Button
            danger={danger}
            type={quick === key ? 'primary' : 'default'}
            onClick={() => {
                setQuick(quick === key ? 'none' : key);
                setPage(1);
            }}
        >
            {label} ({count ?? 0})
        </Button>
    );

    const filtersCard = (
        <Row gutter={[12, 8]}>
            <Col xs={24} sm={12} lg={6}>
                <Typography.Text strong>Entity</Typography.Text>
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select"
                    style={{ width: '100%' }}
                    value={filters.entityId}
                    options={option(entities.data)}
                    onChange={(v) => set({ entityId: v, locationId: undefined })}
                />
            </Col>
            <Col xs={24} sm={12} lg={6}>
                <Typography.Text strong>Location</Typography.Text>
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder={filters.entityId ? 'Select' : 'Choose the entity first'}
                    disabled={!filters.entityId}
                    style={{ width: '100%' }}
                    value={filters.locationId}
                    options={option(locations.data?.items)}
                    onChange={(v) => set({ locationId: v })}
                />
            </Col>
            <Col xs={24} sm={12} lg={6}>
                <Typography.Text strong>Department</Typography.Text>
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select"
                    style={{ width: '100%' }}
                    value={filters.departmentId}
                    options={option(departments.data)}
                    onChange={(v) => set({ departmentId: v })}
                />
            </Col>
            <Col xs={24} sm={12} lg={6}>
                <Typography.Text strong>Document Type</Typography.Text>
                <Select
                    allowClear
                    placeholder="Select"
                    style={{ width: '100%' }}
                    value={filters.accessLevel}
                    options={LEVELS.map((l) => ({ value: l, label: ACCESS_LABEL[l] }))}
                    onChange={(v) => set({ accessLevel: v })}
                />
            </Col>
            <Col xs={24} sm={12} lg={6}>
                <Typography.Text strong>Category</Typography.Text>
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select"
                    style={{ width: '100%' }}
                    value={filters.categoryId}
                    options={option(cats.data)}
                    onChange={(v) => set({ categoryId: v, subCategoryId: undefined, subSubCategoryId: undefined })}
                />
            </Col>
            <Col xs={24} sm={12} lg={6}>
                <Typography.Text strong>Sub Category</Typography.Text>
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select"
                    disabled={!filters.categoryId}
                    style={{ width: '100%' }}
                    value={filters.subCategoryId}
                    options={option(subs.data)}
                    onChange={(v) => set({ subCategoryId: v, subSubCategoryId: undefined })}
                />
            </Col>
            <Col xs={24} sm={12} lg={6}>
                <Typography.Text strong>Sub Sub Category</Typography.Text>
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select"
                    disabled={!filters.subCategoryId}
                    style={{ width: '100%' }}
                    value={filters.subSubCategoryId}
                    options={option(subSubs.data)}
                    onChange={(v) => set({ subSubCategoryId: v })}
                />
            </Col>
            <Col xs={12} lg={3}>
                <Typography.Text strong>From Date</Typography.Text>
                <DatePicker
                    format="DD-MMM-YYYY"
                    style={{ width: '100%' }}
                    placeholder="Choose Date"
                    value={filters.from}
                    disabledDate={(d) => !!filters.to && d.isAfter(filters.to, 'day')}
                    onChange={(d) => set({ from: d })}
                />
            </Col>
            <Col xs={12} lg={3}>
                <Typography.Text strong>To Date</Typography.Text>
                <DatePicker
                    format="DD-MMM-YYYY"
                    style={{ width: '100%' }}
                    placeholder="Choose Date"
                    value={filters.to}
                    disabledDate={(d) => !!filters.from && d.isBefore(filters.from, 'day')}
                    onChange={(d) => set({ to: d })}
                />
            </Col>
        </Row>
    );

    const activeFilters = Object.values(filters).filter(Boolean).length;

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {holder}
            <Space wrap style={{ justifyContent: 'flex-end', width: '100%' }}>
                {writer && (
                    <Tooltip title="Add Document">
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen('new')} />
                    </Tooltip>
                )}
                {quickButton('withoutFiles', 'Data without Documents', summary.data?.withoutFiles, true)}
                {quickButton('expired', 'Expired', summary.data?.expired, true)}
                <Dropdown
                    menu={{
                        items: [
                            ...(user?.role === 'ORG_ADMIN'
                                ? [
                                    {
                                        key: 'actions',
                                        type: 'group' as const,
                                        label: 'Document Actions',
                                        children: [{ key: 'data-upload', label: 'Document Data Upload' }],
                                    },
                                ]
                                : []),
                            {
                                key: 'masters',
                                type: 'group',
                                label: 'Document Masters',
                                children: [
                                    { key: 'category', label: 'Category' },
                                    { key: 'sub', label: 'Sub Category' },
                                    { key: 'subsub', label: 'Sub Sub Category' },
                                    ...(user?.role === 'ORG_ADMIN' ? [{ key: 'owner-swap', label: 'Document Owner Swap' }] : []),
                                ],
                            },
                        ],
                        onClick: ({ key }) => (key === 'data-upload' ? setUploading(true) : setMasters(key as MastersTab)),
                    }}
                >
                    <Button type="primary">
                        Document Master <DownOutlined />
                    </Button>
                </Dropdown>
            </Space>

            <Collapse
                defaultActiveKey={['f']}
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
                                        setQuick('none');
                                        setPage(1);
                                    }}
                                />
                            </Tooltip>
                        ),
                        children: filtersCard,
                    },
                ]}
            />

            <Card size="small">
                <Space direction="vertical" style={{ width: '100%' }}>
                    <Row gutter={[12, 8]} align="middle">
                        <Col xs={24} lg={8}>
                            <Space wrap>
                                {LEVELS.map((l) => (
                                    <Space key={l} size={4}>
                                        <Dot level={l} />
                                        <Typography.Text strong>{ACCESS_LABEL[l]}</Typography.Text>
                                    </Space>
                                ))}
                            </Space>
                        </Col>
                        <Col xs={20} lg={14}>
                            <Input.Search
                                allowClear
                                maxLength={100}
                                placeholder="Search in Documents (name, number, file name, remarks)"
                                onSearch={(v) => {
                                    setSearch(v.trim());
                                    setPage(1);
                                }}
                            />
                        </Col>
                        <Col xs={4} lg={2} style={{ textAlign: 'right' }}>
                            <Tooltip title="Download these documents as Excel">
                                <Button icon={<FileExcelOutlined style={{ color: '#1d6f42' }} />} loading={exporting} onClick={() => void exportXlsx()} />
                            </Tooltip>
                        </Col>
                    </Row>

                    {quick !== 'none' && (
                        <Alert
                            type="warning"
                            showIcon
                            message={quick === 'expired' ? 'Showing expired documents only' : 'Showing documents with no file attached'}
                            action={
                                <Button size="small" onClick={() => setQuick('none')}>
                                    Show all
                                </Button>
                            }
                        />
                    )}
                    {q.isError && (
                        <Alert
                            type="error"
                            showIcon
                            message="The documents could not be loaded"
                            description={q.error.message}
                            action={
                                <Button size="small" onClick={() => void q.refetch()}>
                                    Retry
                                </Button>
                            }
                        />
                    )}

                    <Table<DocRecord>
                        rowKey="id"
                        size="middle"
                        columns={columns}
                        dataSource={q.data?.items ?? []}
                        loading={q.isFetching}
                        scroll={{ x: 2000 }}
                        onChange={(_, __, sorter, extra) => {
                            if (extra.action !== 'sort') return; // paging is handled below
                            const s = sorter as SorterResult<DocRecord>;
                            if (s.order && s.columnKey) {
                                setSort({ field: s.columnKey as SortField, order: s.order === 'ascend' ? 'asc' : 'desc' });
                            } else {
                                setSort({ field: 'createdAt', order: 'desc' });
                            }
                            setPage(1);
                        }}
                        pagination={{
                            current: page,
                            pageSize: limit,
                            total: q.data?.total ?? 0,
                            showSizeChanger: true,
                            showTotal: (t, range) => `Showing ${range[0]} to ${range[1]} of ${t} entries`,
                            onChange: (p, s) => {
                                setPage(p);
                                setLimit(s);
                            },
                        }}
                    />
                </Space>
            </Card>

            {open && <RecordFormModal recordId={open} onClose={() => setOpen(null)} />}
            {uploading && <DocumentDataUploadModal onClose={() => setUploading(false)} />}
            {masters && <DocumentMastersDrawer tab={masters} onTabChange={setMasters} onClose={() => setMasters(null)} />}
        </Space>
    );
}