import { useState } from 'react';
import { Alert, Button, Input, Popconfirm, Segmented, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { MessageInstance } from 'antd/es/message/interface';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { api } from '../../core/api/client';
import { useAuth } from '../../core/auth/AuthContext';
import { formatDate } from '../../core/format';
import { ACCESS_COLOR, ACCESS_LABEL, downloadDocument, formatSize } from '../../shared/documents';
import type { DocItem, DocPage } from '../../shared/documents';
import { errorText } from '../../shared/errors';
import { RepositoryTab } from './RepositoryTab';

type MissingRow = {
    id: string;
    dueDate: string;
    overdue: boolean;
    compliance: { code: string; title: string };
    entity: { id: string; name: string };
    location: { id: string; name: string };
    owner: { id: string; name: string };
    manager: { id: string; name: string };
};
type MissingPage = { items: MissingRow[]; total: number };

function MissingTab() {
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const q = useQuery({
        queryKey: ['documents', 'missing', page, limit],
        queryFn: ({ signal }) => api<MissingPage>(`/documents/missing?page=${page}&limit=${limit}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const columns: TableProps<MissingRow>['columns'] = [
        {
            title: 'Compliance',
            key: 'c',
            render: (_, r) => (
                <div>
                    <div>{r.compliance.title}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.compliance.code}
                    </Typography.Text>
                </div>
            ),
        },
        { title: 'Location', key: 'l', render: (_, r) => `${r.entity.name} / ${r.location.name}` },
        { title: 'Owner', key: 'o', render: (_, r) => r.owner.name },
        { title: 'Manager', key: 'm', render: (_, r) => r.manager.name },
        {
            title: 'Due date',
            key: 'd',
            render: (_, r) => (
                <Space>
                    {formatDate(r.dueDate)}
                    {r.overdue && <Tag color="red">Overdue</Tag>}
                </Space>
            ),
        },
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary">
                Open items that need proof and have no valid document yet. Click a row to open it.
            </Typography.Text>
            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The list could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}
            <Table<MissingRow>
                rowKey="id"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                onRow={(r) => ({ onClick: () => navigate(`/records?open=${r.id}`), style: { cursor: 'pointer' } })}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (t) => `${t} items`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />
        </Space>
    );
}

// Proof attached to compliance items (and older standalone uploads)
function ProofsTab({ notify }: { notify: MessageInstance }) {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { user } = useAuth();
    const [search, setSearch] = useState('');
    const [view, setView] = useState<'ALL' | 'EXPIRED' | 'SOON' | 'STANDALONE'>('ALL');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);

    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    if (view === 'EXPIRED') params.set('expired', 'true');
    if (view === 'SOON') params.set('expiringInDays', '30');
    if (view === 'STANDALONE') params.set('standalone', 'true');
    const qs = params.toString();

    const q = useQuery({
        queryKey: ['documents', 'list', qs],
        queryFn: ({ signal }) => api<DocPage>(`/documents?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const refreshAll = () =>
        Promise.all([
            qc.invalidateQueries({ queryKey: ['documents'] }),
            qc.invalidateQueries({ queryKey: ['record'] }),
            qc.invalidateQueries({ queryKey: ['records'] }),
        ]);

    const remove = async (id: string) => {
        try {
            await api(`/documents/${id}`, { method: 'DELETE' });
            notify.success('Document removed');
            await refreshAll();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const download = async (id: string) => {
        try {
            await downloadDocument(id);
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<DocItem>['columns'] = [
        {
            title: 'Title',
            key: 't',
            render: (_, d) => (
                <div>
                    <div>{d.title}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {d.fileName} · {formatSize(d.sizeBytes)}
                    </Typography.Text>
                </div>
            ),
        },
        { title: 'Number', key: 'n', render: (_, d) => d.docNumber ?? '' },
        {
            title: 'Access',
            key: 'a',
            render: (_, d) => <Tag color={ACCESS_COLOR[d.accessLevel]}>{ACCESS_LABEL[d.accessLevel]}</Tag>,
        },
        {
            title: 'Expires',
            key: 'e',
            render: (_, d) =>
                d.expiresAt ? (
                    <Space>
                        {formatDate(d.expiresAt)}
                        {d.expired && <Tag color="red">Expired</Tag>}
                    </Space>
                ) : (
                    ''
                ),
        },
        { title: 'Uploaded by', key: 'u', render: (_, d) => d.uploadedBy.name },
        { title: 'Uploaded on', key: 'c', render: (_, d) => formatDate(d.createdAt) },
        {
            title: 'Linked to',
            key: 'l',
            render: (_, d) =>
                d.instanceId ? (
                    <Button type="link" size="small" onClick={() => navigate(`/records?open=${d.instanceId}`)}>
                        Open item
                    </Button>
                ) : (
                    'Standalone'
                ),
        },
        {
            title: '',
            key: 'x',
            render: (_, d) => (
                <Space>
                    <Button size="small" icon={<DownloadOutlined />} onClick={() => void download(d.id)}>
                        Download
                    </Button>
                    {user?.role !== 'VIEWER' && (
                        <Popconfirm
                            title="Remove this document?"
                            okText="Remove"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => void remove(d.id)}
                        >
                            <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap>
                <Input.Search
                    allowClear
                    maxLength={100}
                    placeholder="Search by title, file name or number"
                    style={{ width: 320 }}
                    onSearch={(v) => {
                        setSearch(v.trim());
                        setPage(1);
                    }}
                />
                <Segmented
                    value={view}
                    onChange={(v) => {
                        setView(v as typeof view);
                        setPage(1);
                    }}
                    options={[
                        { label: 'All', value: 'ALL' },
                        { label: 'Expired', value: 'EXPIRED' },
                        { label: 'Expiring in 30 days', value: 'SOON' },
                        { label: 'Older standalone uploads', value: 'STANDALONE' },
                    ]}
                />
            </Space>

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
            <Table<DocItem>
                rowKey="id"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                scroll={{ x: 1000 }}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    showTotal: (t) => `${t} documents`,
                    onChange: (p, s) => {
                        setPage(p);
                        setLimit(s);
                    },
                }}
            />

        </Space>
    );
}

export default function DocumentsPage() {
    const [notify, holder] = message.useMessage();
    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {holder}
            <Typography.Title level={4} style={{ margin: 0 }}>
                Documents
            </Typography.Title>

            <Tabs
                destroyInactiveTabPane
                items={[
                    {
                        key: 'repository',
                        label: 'Documents',
                        children: (
                            <ModuleBoundary compact label="This list">
                                <RepositoryTab />
                            </ModuleBoundary>
                        ),
                    },
                    {
                        key: 'proofs',
                        label: 'Compliance proofs',
                        children: (
                            <ModuleBoundary compact label="This list">
                                <ProofsTab notify={notify} />
                            </ModuleBoundary>
                        ),
                    },
                    {
                        key: 'missing',
                        label: 'Items missing proof',
                        children: (
                            <ModuleBoundary compact label="This list">
                                <MissingTab />
                            </ModuleBoundary>
                        ),
                    },
                ]}
            />
        </Space>
    );
}