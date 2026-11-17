import { useState } from 'react';
import { Alert, Button, Modal, Skeleton, Table, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { errorText } from '../../shared/errors';
import { downloadLegalFile, downloadLegalZip, kb, useLegalDetail } from './api';
import type { LegalFile } from './api';

// The files of one legal update: download one, or tick several and get them as a zip
export function AttachmentsModal({ id, onClose }: { id: string; onClose: () => void }) {
    const q = useLegalDetail(id);
    const [notify, holder] = message.useMessage();
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);

    const one = async (f: LegalFile) => {
        try {
            await downloadLegalFile(f.id);
        } catch (e) {
            notify.error(errorText(e));
        }
    };
    const zip = async () => {
        setBusy(true);
        try {
            await downloadLegalZip(id, selected);
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open
            width={900}
            title="Attachments"
            onCancel={onClose}
            footer={[
                <Button key="zip" type="primary" disabled={!selected.length} loading={busy} onClick={() => void zip()}>
                    Download Selected Files in ZIP
                </Button>,
                <Button key="close" onClick={onClose}>
                    Close
                </Button>,
            ]}
        >
            {holder}
            {q.isLoading && <Skeleton active />}
            {q.isError && <Alert type="error" showIcon message="The files could not be loaded" description={q.error.message} />}
            {q.data && (
                <Table<LegalFile>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={q.data.files}
                    locale={{ emptyText: 'This update has no attachments' }}
                    rowSelection={{ selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]) }}
                    columns={[
                        { title: 'S.no', key: 'n', width: 60, render: (_, __, i) => i + 1 },
                        { title: 'File Name', dataIndex: 'fileName', key: 'f' },
                        { title: 'File Size', key: 's', width: 130, render: (_, f) => kb(f.sizeBytes) },
                        { title: 'Uploaded On', key: 'u', width: 210, render: (_, f) => dayjs(f.createdAt).format('DD-MMM-YYYY hh:mm:ss A') },
                        {
                            title: 'Download',
                            key: 'd',
                            width: 90,
                            render: (_, f) => <Button type="link" icon={<DownloadOutlined />} onClick={() => void one(f)} />,
                        },
                    ]}
                />
            )}
        </Modal>
    );
}