import { Alert, Button, Empty, List, Popconfirm, Skeleton, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { MessageInstance } from 'antd/es/message/interface';
import { api } from '../../core/api/client';
import { useAuth } from '../../core/auth/AuthContext';
import { formatDate } from '../../core/format';
import { ACCESS_COLOR, ACCESS_LABEL, downloadDocument, formatSize } from '../../shared/documents';
import type { DocPage } from '../../shared/documents';
import { errorText } from '../../shared/errors';
import { ProofUploader } from '../../shared/ProofUploader';
import { useRefreshAfterChange } from './api';
import { capabilities } from './capabilities';
import type { RecordDetail } from './types';

type Props = { record: RecordDetail; notify: MessageInstance };

export function ProofSection({ record, notify }: Props) {
    const { user } = useAuth();
    const refresh = useRefreshAfterChange();
    const docs = useQuery({
        queryKey: ['documents', 'instance', record.id],
        queryFn: ({ signal }) => api<DocPage>(`/documents?instanceId=${record.id}&limit=100`, { signal }),
    });

    if (!user) return null;
    const caps = capabilities(record, user);
    const mandatory = record.compliance.attachment === 'MANDATORY';

    const remove = async (id: string) => {
        try {
            await api(`/documents/${id}`, { method: 'DELETE' });
            notify.success('Document removed');
            await refresh(record.id);
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

    if (docs.isError) {
        return (
            <Alert
                type="error"
                showIcon
                message="The documents could not be loaded"
                description={docs.error.message}
                action={
                    <Button size="small" onClick={() => void docs.refetch()}>
                        Retry
                    </Button>
                }
            />
        );
    }
    if (!docs.data) return <Skeleton active />;

    const valid = docs.data.items.filter((d) => !d.expired).length;

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {mandatory && (
                <Alert
                    type={valid > 0 ? 'success' : 'warning'}
                    showIcon
                    message={valid > 0 ? 'Proof is attached' : 'Proof is mandatory for this item'}
                    description={
                        valid > 0
                            ? `${valid} valid document(s) attached. Expired documents do not count.`
                            : 'At least one valid, non-expired document must be attached before it can be submitted as applicable.'
                    }
                />
            )}

            {caps.canEdit ? (
                <ProofUploader
                    instanceId={record.id}
                    isAdmin={false}
                    notify={notify}
                    onUploaded={() => void refresh(record.id)}
                />
            ) : (
                <Alert
                    type="info"
                    showIcon
                    message={
                        caps.open
                            ? 'Only the owner can attach proof to this item.'
                            : 'Proof cannot be changed while this item is in review or after it is closed.'
                    }
                />
            )}

            {docs.data.items.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No documents attached" />
            ) : (
                <List
                    size="small"
                    bordered
                    dataSource={docs.data.items}
                    renderItem={(d) => (
                        <List.Item
                            actions={[
                                <Button key="dl" size="small" icon={<DownloadOutlined />} onClick={() => void download(d.id)}>
                                    Download
                                </Button>,
                                ...(caps.canRemoveProof
                                    ? [
                                        <Popconfirm
                                            key="rm"
                                            title="Remove this document?"
                                            okText="Remove"
                                            okButtonProps={{ danger: true }}
                                            onConfirm={() => void remove(d.id)}
                                        >
                                            <Button size="small" danger icon={<DeleteOutlined />} />
                                        </Popconfirm>,
                                    ]
                                    : []),
                            ]}
                        >
                            <List.Item.Meta
                                title={
                                    <Space wrap>
                                        {d.title}
                                        <Tag color={ACCESS_COLOR[d.accessLevel]}>{ACCESS_LABEL[d.accessLevel]}</Tag>
                                        {d.expired && <Tag color="red">Expired</Tag>}
                                    </Space>
                                }
                                description={
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                        {d.fileName} · {formatSize(d.sizeBytes)} · uploaded by {d.uploadedBy.name} on {formatDate(d.createdAt)}
                                        {d.docNumber ? ` · No. ${d.docNumber}` : ''}
                                        {d.expiresAt ? ` · expires ${formatDate(d.expiresAt)}` : ''}
                                    </Typography.Text>
                                }
                            />
                        </List.Item>
                    )}
                />
            )}
        </Space>
    );
}