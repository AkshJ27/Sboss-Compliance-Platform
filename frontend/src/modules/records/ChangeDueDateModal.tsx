import { useState } from 'react';
import { Alert, Button, DatePicker, Form, Input, Modal, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { api } from '../../core/api/client';
import { formatDate } from '../../core/format';
import { errorText } from '../../shared/errors';
import { checkFileBeforeUpload } from '../../shared/documents';
import { useRefreshAfterChange } from './api';
import type { RecordDetail } from './types';

type Props = { record: RecordDetail; onClose: () => void; onDone: () => void };
type Values = { dueDate: Dayjs; remarks: string };

const MAX_FILES = 10;

// Moves the due date of an item the owner still has. Supporting files are saved as separate
// documents, so they never count as the item's proof.
export function ChangeDueDateModal({ record, onClose, onDone }: Props) {
    const [form] = Form.useForm<Values>();
    const refresh = useRefreshAfterChange();
    const [files, setFiles] = useState<File[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const current = record.dueDate.slice(0, 10);
    // Items due before their period starts can keep a due date that early
    const periodStart = dayjs(record.periodStart.slice(0, 10));
    const earliest = dayjs(current).isBefore(periodStart, 'day') ? dayjs(current) : periodStart;

    const save = async () => {
        let v: Values;
        try {
            v = await form.validateFields();
        } catch {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const documentIds: string[] = [];
            for (const file of files) {
                const body = new FormData();
                body.append('file', file);
                body.append('title', `Due date change: ${record.compliance.code}`);
                body.append('accessLevel', 'PROTECTED');
                const doc = await api<{ id: string }>('/documents', { method: 'POST', form: body });
                documentIds.push(doc.id);
            }
            await api(`/compliance/instances/${record.id}/due-date`, {
                method: 'POST',
                body: { dueDate: v.dueDate.format('YYYY-MM-DD'), remarks: v.remarks.trim(), documentIds },
            });
            await refresh(record.id);
            onDone();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setSaving(false);
        }
    };

    const fileList: UploadFile[] = files.map((f, i) => ({ uid: String(i), name: f.name, status: 'done' }));

    return (
        <Modal open title="Change due date" okText="Change" confirmLoading={saving} onOk={() => void save()} onCancel={onClose} destroyOnClose>
            {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />}
            <Typography.Paragraph type="secondary">
                Currently due on {formatDate(current)}. The owner and manager are told about the change, and it is kept in the
                item's history.
            </Typography.Paragraph>
            <Form<Values> form={form} layout="vertical">
                <Form.Item name="dueDate" label="Due date" rules={[{ required: true, message: 'Due date is required' }]}>
                    <DatePicker
                        format="DD-MMM-YYYY"
                        style={{ width: 220 }}
                        disabledDate={(d) => d.isBefore(earliest, 'day') || d.format('YYYY-MM-DD') === current}
                    />
                </Form.Item>
                <Form.Item
                    name="remarks"
                    label="Remarks"
                    rules={[
                        { required: true, whitespace: true, message: 'Remarks are required' },
                        { min: 3, message: 'At least 3 characters' },
                        { max: 500 },
                    ]}
                >
                    <Input.TextArea rows={4} maxLength={500} showCount placeholder="Why the due date is changing" />
                </Form.Item>
                <Upload
                    multiple
                    fileList={fileList}
                    beforeUpload={(f) => {
                        const problem = checkFileBeforeUpload(f);
                        if (problem) setError(problem);
                        else setFiles((fs) => (fs.length >= MAX_FILES ? fs : [...fs, f]));
                        return false;
                    }}
                    onRemove={(item) => setFiles((fs) => fs.filter((_, i) => String(i) !== item.uid))}
                >
                    <Button icon={<UploadOutlined />} disabled={files.length >= MAX_FILES}>
                        Choose files (optional)
                    </Button>
                </Upload>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                    Files are linked in the item's history. Admins and you can open them.
                </Typography.Text>
            </Form>
        </Modal>
    );
}