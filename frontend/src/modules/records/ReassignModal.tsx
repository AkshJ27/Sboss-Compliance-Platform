import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Input, Modal, Select, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { MessageInstance } from 'antd/es/message/interface';
import { api } from '../../core/api/client';
import { errorText } from '../../shared/errors';
import { useRefreshAfterChange } from './api';
import type { RecordDetail } from './types';

type UserRow = { id: string; name: string; email: string; role: string; isActive: boolean };
type Props = { record: RecordDetail; open: boolean; onClose: () => void; notify: MessageInstance };

export function ReassignModal({ record, open, onClose, notify }: Props) {
    const refresh = useRefreshAfterChange();
    const [ownerId, setOwnerId] = useState(record.ownerId);
    const [managerId, setManagerId] = useState(record.managerId);
    const [approverId, setApproverId] = useState<string | null>(record.approverId);
    const [remarks, setRemarks] = useState('');
    const [busy, setBusy] = useState(false);

    const users = useQuery({
        queryKey: ['users'],
        queryFn: ({ signal }) => api<UserRow[]>('/users', { signal }),
        enabled: open,
    });

    useEffect(() => {
        if (open) {
            setOwnerId(record.ownerId);
            setManagerId(record.managerId);
            setApproverId(record.approverId);
            setRemarks('');
        }
    }, [open, record.ownerId, record.managerId, record.approverId]);

    const options = (users.data ?? [])
        .filter((u) => u.isActive && u.role !== 'VIEWER')
        .map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }));

    const save = async () => {
        if (ownerId === managerId) {
            notify.warning('Owner and manager must be different people');
            return;
        }
        if (approverId && (approverId === ownerId || approverId === managerId)) {
            notify.warning('The approver must be a different person from the owner and manager');
            return;
        }
        const body: Record<string, unknown> = {};
        if (ownerId !== record.ownerId) body.ownerId = ownerId;
        if (managerId !== record.managerId) body.managerId = managerId;
        if (approverId !== record.approverId) body.approverId = approverId;
        if (Object.keys(body).length === 0) {
            notify.info('Nothing was changed');
            return;
        }
        if (remarks.trim()) body.remarks = remarks.trim();

        setBusy(true);
        try {
            await api(`/compliance/instances/${record.id}/assignees`, { method: 'PATCH', body });
            notify.success('People updated');
            onClose();
            await refresh(record.id);
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const field = (label: string, node: ReactNode) => (
        <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {label}
            </Typography.Text>
            {node}
        </div>
    );

    return (
        <Modal
            open={open}
            title="Reassign this item"
            okText="Save"
            confirmLoading={busy}
            onOk={() => void save()}
            onCancel={onClose}
            destroyOnClose
        >
            {users.isError && <Alert type="error" showIcon message="The people list could not be loaded" style={{ marginBottom: 12 }} />}
            <Space direction="vertical" style={{ width: '100%' }}>
                {field(
                    'Owner',
                    <Select showSearch optionFilterProp="label" style={{ width: '100%' }} value={ownerId} options={options} loading={users.isLoading} onChange={setOwnerId} />,
                )}
                {field(
                    'Manager',
                    <Select showSearch optionFilterProp="label" style={{ width: '100%' }} value={managerId} options={options} loading={users.isLoading} onChange={setManagerId} />,
                )}
                {field(
                    record.requiresApprover ? 'Approver (required for a high-risk item)' : 'Approver',
                    <Select
                        showSearch
                        optionFilterProp="label"
                        style={{ width: '100%' }}
                        value={approverId}
                        options={options}
                        loading={users.isLoading}
                        allowClear={!record.requiresApprover}
                        onChange={(v: string | undefined) => setApproverId(v ?? null)}
                        placeholder="No approver"
                    />,
                )}
                {field(
                    'Reason (optional)',
                    <Input.TextArea rows={2} maxLength={500} showCount value={remarks} onChange={(e) => setRemarks(e.target.value)} />,
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    The people on a submitted item can only change if they have not already handled it.
                </Typography.Text>
            </Space>
        </Modal>
    );
}