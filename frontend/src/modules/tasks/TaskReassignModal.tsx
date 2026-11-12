import { useState } from 'react';
import { Input, Modal, Select, Space, Typography } from 'antd';
import { LoadWarning } from '../admin/LoadWarning';
import { useUsers, userOptions } from '../admin/api';
import type { TaskRow } from './types';

type Props = {
    task: TaskRow;
    busy: boolean;
    onConfirm: (assigneeId: string, remarks: string | undefined) => void;
    onCancel: () => void;
};

export function TaskReassignModal({ task, busy, onConfirm, onCancel }: Props) {
    const users = useUsers();
    const [assigneeId, setAssigneeId] = useState<string | undefined>();
    const [remarks, setRemarks] = useState('');
    const options = userOptions(users.data).filter((o) => o.value !== task.assigneeId);

    return (
        <Modal
            open
            title="Reassign this task"
            okText="Reassign"
            okButtonProps={{ disabled: !assigneeId }}
            confirmLoading={busy}
            onOk={() => assigneeId && onConfirm(assigneeId, remarks.trim() || undefined)}
            onCancel={onCancel}
            destroyOnClose
        >
            <LoadWarning label="The people list" error={users.isError} onRetry={() => void users.refetch()} />
            <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Text type="secondary">Currently assigned to {task.assignee.name}</Typography.Text>
                <Select
                    showSearch
                    optionFilterProp="label"
                    style={{ width: '100%' }}
                    loading={users.isLoading}
                    options={options}
                    value={assigneeId}
                    onChange={setAssigneeId}
                    placeholder="Choose the new assignee"
                />
                <Input.TextArea
                    rows={2}
                    maxLength={500}
                    showCount
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Reason (optional)"
                />
            </Space>
        </Modal>
    );
}