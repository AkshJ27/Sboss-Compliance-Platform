import { useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Popconfirm, Skeleton, Space, Table, Tag, Typography, Upload, message } from 'antd';
import type { UploadFile } from 'antd';
import { DeleteOutlined, DownloadOutlined, EditOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../core/api/client';
import { useMe } from '../../core/auth/useMe';
import { formatDate } from '../../core/format';
import { checkFileBeforeUpload } from '../../shared/documents';
import { errorText } from '../../shared/errors';
import { downloadLegalFile, downloadLegalZip, kb, regionLabel, useLegalDetail } from './api';
import type { LegalFile } from './api';
import { LegalUpdateForm } from './LegalUpdateForm';

const yn = (b: boolean) => (b ? <Tag color="red">Yes</Tag> : <Tag>No</Tag>);

export function LegalDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
    const qc = useQueryClient();
    const me = useMe();
    const canEdit = !!me.data?.isPlatformAdmin;
    const q = useLegalDetail(id);
    const [notify, holder] = message.useMessage();
    const [editing, setEditing] = useState(false);
    const [files, setFiles] = useState<UploadFile[]>([]);
    const [busy, setBusy] = useState(false);
    const refresh = () => qc.invalidateQueries({ queryKey: ['legal'] });

    const act = async (fn: () => Promise<unknown>, done: string, after?: () => void) => {
        try {
            await fn();
            notify.success(done);
            await refresh();
            after?.();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const upload = async () => {
        setBusy(true);
        const form = new FormData();
        for (const f of files) form.append('files', f.originFileObj as File);
        await act(() => api(`/legal-updates/${id}/files`, { method: 'POST', form }), 'Files added', () => setFiles([]));
        setBusy(false);
    };

    const d = q.data;
    return (
        <Drawer
            open
            width={820}
            title="Legal Update"
            onClose={onClose}
            destroyOnClose
            extra={
                canEdit &&
                d && (
                    <Space>
                        <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                            Modify
                        </Button>
                        <Popconfirm
                            title="Delete this legal update?"
                            description="Every company stops seeing it. Its files are removed too."
                            okText="Delete"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => void act(() => api(`/legal-updates/${id}`, { method: 'DELETE' }), 'Deleted', onClose)}
                        >
                            <Button danger icon={<DeleteOutlined />}>
                                Delete
                            </Button>
                        </Popconfirm>
                    </Space>
                )
            }
        >
            {holder}
            {q.isLoading && <Skeleton active />}
            {q.isError && <Alert type="error" showIcon message="The update could not be loaded" description={q.error.message} />}
            {d && (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <div>
                        <Typography.Title level={5} style={{ marginTop: 0 }}>
                            {d.complianceImpact && <Tag color="red">Compliance impact</Tag>}
                            {d.title}
                        </Typography.Title>
                        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{d.description}</Typography.Paragraph>
                    </div>
                    <Descriptions size="small" bordered column={2}>
                        <Descriptions.Item label="Notification Date">{formatDate(d.notificationDate)}</Descriptions.Item>
                        <Descriptions.Item label="Published Date">{formatDate(d.publishedDate)}</Descriptions.Item>
                        <Descriptions.Item label="Effective Date">{formatDate(d.effectiveDate)}</Descriptions.Item>
                        <Descriptions.Item label="Notification No">{d.referenceNumber ?? ''}</Descriptions.Item>
                        <Descriptions.Item label="Law Category">{d.act.lawCategory.name}</Descriptions.Item>
                        <Descriptions.Item label="Central/State">{regionLabel(d.act)}</Descriptions.Item>
                        <Descriptions.Item label="Act" span={2}>{d.act.name}</Descriptions.Item>
                        <Descriptions.Item label="Rule" span={2}>{d.rule?.name ?? ''}</Descriptions.Item>
                        <Descriptions.Item label="Ministry" span={2}>{d.ministry ?? ''}</Descriptions.Item>
                        <Descriptions.Item label="Compliance Impact">{yn(d.complianceImpact)}</Descriptions.Item>
                        <Descriptions.Item label="Change">{yn(d.isChange)}</Descriptions.Item>
                        <Descriptions.Item label="Addition">{yn(d.isAddition)}</Descriptions.Item>
                        <Descriptions.Item label="Deletion">{yn(d.isDeletion)}</Descriptions.Item>
                        <Descriptions.Item label="Schedule">{yn(d.isSchedule)}</Descriptions.Item>
                        <Descriptions.Item label="Impacted Compliance">{d.impactedCompliance ?? ''}</Descriptions.Item>
                    </Descriptions>

                    <div>
                        <Space style={{ marginBottom: 8 }}>
                            <Typography.Title level={5} style={{ margin: 0 }}>
                                Attachments
                            </Typography.Title>
                            {d.files.length > 1 && (
                                <Button size="small" icon={<DownloadOutlined />} onClick={() => void act(() => downloadLegalZip(id, []), 'Downloaded')}>
                                    Download all as ZIP
                                </Button>
                            )}
                        </Space>
                        <Table<LegalFile>
                            rowKey="id"
                            size="small"
                            pagination={false}
                            dataSource={d.files}
                            locale={{ emptyText: 'No attachments' }}
                            columns={[
                                { title: 'File Name', dataIndex: 'fileName', key: 'f' },
                                { title: 'File Size', key: 's', width: 120, render: (_, f) => kb(f.sizeBytes) },
                                { title: 'Uploaded On', key: 'u', width: 190, render: (_, f) => dayjs(f.createdAt).format('DD-MMM-YYYY hh:mm A') },
                                {
                                    title: '',
                                    key: 'x',
                                    width: canEdit ? 90 : 50,
                                    render: (_, f) => (
                                        <Space size={0}>
                                            <Button type="link" icon={<DownloadOutlined />} onClick={() => void downloadLegalFile(f.id).catch((e) => notify.error(errorText(e)))} />
                                            {canEdit && (
                                                <Popconfirm
                                                    title={`Remove ${f.fileName}?`}
                                                    okText="Remove"
                                                    okButtonProps={{ danger: true }}
                                                    onConfirm={() => void act(() => api(`/legal-updates/${id}/files/${f.id}`, { method: 'DELETE' }), 'File removed')}
                                                >
                                                    <Button type="link" danger icon={<DeleteOutlined />} />
                                                </Popconfirm>
                                            )}
                                        </Space>
                                    ),
                                },
                            ]}
                        />
                        {canEdit && (
                            <Space style={{ marginTop: 12 }} align="start">
                                <Upload
                                    multiple
                                    fileList={files}
                                    beforeUpload={(file) => {
                                        const problem = checkFileBeforeUpload(file);
                                        if (problem) {
                                            notify.error(`${file.name}: ${problem}`);
                                            return Upload.LIST_IGNORE;
                                        }
                                        return false;
                                    }}
                                    onChange={({ fileList }) => setFiles(fileList.slice(0, 10))}
                                >
                                    <Button icon={<PaperClipOutlined />}>Choose Files</Button>
                                </Upload>
                                <Button type="primary" disabled={!files.length} loading={busy} onClick={() => void upload()}>
                                    Upload
                                </Button>
                            </Space>
                        )}
                    </div>
                </Space>
            )}

            {editing && <LegalUpdateForm id={id} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
        </Drawer>
    );
}