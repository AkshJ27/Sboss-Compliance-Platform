import { useState } from 'react';
import { Alert, Button, Card, Input, Modal, Space } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import { api } from '../../core/api/client';
import { errorText } from '../../shared/errors';
import { useRefreshAfterChange } from './api';
import type { RecordDetail } from './types';

type Props = { record: RecordDetail; stage: 'MANAGER' | 'APPROVER'; notify: MessageInstance };

export function ReviewActions({ record, stage, notify }: Props) {
    const refresh = useRefreshAfterChange();
    const [mode, setMode] = useState<'approve' | 'return' | null>(null);
    const [remarks, setRemarks] = useState('');
    const [busy, setBusy] = useState(false);

    // With an approver, the manager's approval sends it on to them. Without one, it closes the item.
    const sendsOn = stage === 'MANAGER' && !!record.approver;

    const close = () => {
        setMode(null);
        setRemarks('');
    };

    const confirm = async () => {
        if (!mode) return;
        const text = remarks.trim();
        if (mode === 'return' && text.length < 3) {
            notify.warning('Enter the reason for returning this item (at least 3 characters)');
            return;
        }
        setBusy(true);
        try {
            await api(`/compliance/instances/${record.id}/${mode}`, {
                method: 'POST',
                body: text ? { remarks: text } : {},
            });
            notify.success(
                mode === 'return'
                    ? 'Returned to the owner'
                    : sendsOn
                        ? 'Approved. It now goes to the approver.'
                        : 'Approved',
            );
            close();
            await refresh(record.id);
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card size="small" title={stage === 'MANAGER' ? 'Your review' : 'Your final approval'}>
            <Space direction="vertical" style={{ width: '100%' }}>
                {sendsOn && record.approver && (
                    <Alert type="info" showIcon message={`After your approval it goes to ${record.approver.name} for final approval.`} />
                )}
                <Space>
                    <Button type="primary" onClick={() => setMode('approve')}>
                        {sendsOn ? 'Approve and send on' : 'Approve'}
                    </Button>
                    <Button danger onClick={() => setMode('return')}>
                        Return to owner
                    </Button>
                </Space>
            </Space>

            <Modal
                open={mode !== null}
                title={mode === 'return' ? 'Return to the owner' : 'Approve'}
                okText={mode === 'return' ? 'Return' : 'Approve'}
                okButtonProps={{ danger: mode === 'return' }}
                confirmLoading={busy}
                onOk={() => void confirm()}
                onCancel={close}
                destroyOnClose
            >
                <Input.TextArea
                    rows={4}
                    maxLength={2000}
                    showCount
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder={mode === 'return' ? 'Reason for returning (required)' : 'Remarks (optional)'}
                />
            </Modal>
        </Card>
    );
}