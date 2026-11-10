import { useState } from 'react';
import { Button, DatePicker, Input, Select, Space, Typography, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import type { MessageInstance } from 'antd/es/message/interface';
import { api } from '../core/api/client';
import { errorText } from './errors';
import { ACCESS_LABEL, ALLOWED_EXTENSIONS, checkFileBeforeUpload } from './documents';
import type { AccessLevel } from './documents';

type Props = {
    instanceId?: string; // leave out for a standalone document
    isAdmin: boolean; // only an admin may choose Restricted
    notify: MessageInstance;
    onUploaded: () => void;
};

export function ProofUploader({ instanceId, isAdmin, notify, onUploaded }: Props) {
    const [title, setTitle] = useState('');
    const [docNumber, setDocNumber] = useState('');
    const [expiresAt, setExpiresAt] = useState<Dayjs | null>(null);
    const [accessLevel, setAccessLevel] = useState<AccessLevel>('PROTECTED');
    const [busy, setBusy] = useState(false);

    const levels: AccessLevel[] = isAdmin
        ? ['PUBLIC', 'PRIVATE', 'PROTECTED', 'RESTRICTED']
        : ['PUBLIC', 'PRIVATE', 'PROTECTED'];

    const upload = async (file: File) => {
        const problem = checkFileBeforeUpload(file);
        if (problem) {
            notify.error(problem);
            return;
        }
        setBusy(true);
        try {
            const form = new FormData();
            form.append('file', file);
            if (instanceId) form.append('instanceId', instanceId);
            if (title.trim()) form.append('title', title.trim());
            if (docNumber.trim()) form.append('docNumber', docNumber.trim());
            if (expiresAt) form.append('expiresAt', expiresAt.format('YYYY-MM-DD'));
            form.append('accessLevel', accessLevel);

            await api('/documents', { method: 'POST', form });
            notify.success('Document uploaded');
            setTitle('');
            setDocNumber('');
            setExpiresAt(null);
            onUploaded();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap>
                <Input
                    placeholder="Title (optional)"
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={{ width: 200 }}
                />
                <Input
                    placeholder="Document number (optional)"
                    maxLength={100}
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    style={{ width: 220 }}
                />
                <DatePicker placeholder="Expires on (optional)" value={expiresAt} onChange={setExpiresAt} />
                <Select
                    value={accessLevel}
                    onChange={setAccessLevel}
                    style={{ width: 140 }}
                    options={levels.map((l) => ({ value: l, label: ACCESS_LABEL[l] }))}
                />
            </Space>
            <Upload
                showUploadList={false}
                accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')}
                disabled={busy}
                beforeUpload={(file) => {
                    void upload(file);
                    return false;
                }}
            >
                <Button type="primary" icon={<UploadOutlined />} loading={busy}>
                    Choose a file and upload
                </Button>
            </Upload>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                PDF, images, Word, Excel, CSV or text. Up to 10 MB.
            </Typography.Text>
        </Space>
    );
}