import { useState } from 'react';
import { Alert, DatePicker, Form, Input, Modal, Radio, Select, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { MessageInstance } from 'antd/es/message/interface';
import { api } from '../../core/api/client';
import { useAuth } from '../../core/auth/AuthContext';
import { errorText } from '../../shared/errors';
import { LoadWarning } from '../admin/LoadWarning';
import { useEntities, useUsers, userOptions } from '../admin/api';
import { PRIORITIES, PRIORITY_LABEL } from './meta';
import type { TaskPriority, TaskRow } from './types';

type Values = {
    title: string;
    description?: string;
    priority: TaskPriority;
    assigneeId?: string;
    entityId?: string;
    dueDate?: Dayjs | null;
};

type Props = {
    task: TaskRow | null; // null creates a new task
    notify: MessageInstance;
    onClose: () => void;
    onSaved: (task: TaskRow) => void;
};

export function TaskFormModal({ task, notify, onClose, onSaved }: Props) {
    const { user } = useAuth();
    const [form] = Form.useForm<Values>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const users = useUsers();
    const entities = useEntities(false);

    const existingDue = task?.dueDate ? task.dueDate.slice(0, 10) : null;
    const currentEntity = task?.entity ?? null;

    const people = userOptions(users.data);
    const entityOptions = (entities.data ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }));
    if (currentEntity && !entityOptions.some((o) => o.value === currentEntity.id)) {
        entityOptions.push({ value: currentEntity.id, label: `${currentEntity.name} (inactive)` });
    }

    // A past date is refused, except the due date the task already has
    const disabledDate = (d: Dayjs) => d.isBefore(dayjs(), 'day') && d.format('YYYY-MM-DD') !== existingDue;

    const submit = async (v: Values) => {
        setBusy(true);
        setError(null);
        try {
            const title = v.title.trim();
            const description = (v.description ?? '').trim();
            const dueDate = v.dueDate ? v.dueDate.format('YYYY-MM-DD') : null;

            if (!task) {
                const saved = await api<TaskRow>('/tasks', {
                    method: 'POST',
                    body: {
                        title,
                        priority: v.priority,
                        assigneeId: v.assigneeId,
                        ...(description ? { description } : {}),
                        ...(v.entityId ? { entityId: v.entityId } : {}),
                        ...(dueDate ? { dueDate } : {}),
                    },
                });
                onSaved(saved);
                return;
            }

            // Send only what changed
            const body: Record<string, unknown> = {};
            if (title !== task.title) body.title = title;
            if (description !== (task.description ?? '')) body.description = description || null;
            if (v.priority !== task.priority) body.priority = v.priority;
            const entityId = v.entityId ?? null;
            if (entityId !== (currentEntity?.id ?? null)) body.entityId = entityId;
            if (dueDate !== existingDue) body.dueDate = dueDate;

            if (Object.keys(body).length === 0) {
                notify.info('Nothing was changed');
                onClose();
                return;
            }
            onSaved(await api<TaskRow>(`/tasks/${task.id}`, { method: 'PATCH', body }));
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const initial: Values = task
        ? {
            title: task.title,
            description: task.description ?? '',
            priority: task.priority,
            entityId: currentEntity?.id,
            dueDate: existingDue ? dayjs(existingDue) : null,
        }
        : { title: '', description: '', priority: 'MEDIUM', assigneeId: user?.id, dueDate: null };

    return (
        <Modal
            open
            title={task ? 'Edit task' : 'New task'}
            okText={task ? 'Save' : 'Create task'}
            confirmLoading={busy}
            onOk={() => form.submit()}
            onCancel={onClose}
            destroyOnClose
        >
            <LoadWarning label="The people list" error={users.isError} onRetry={() => void users.refetch()} />
            <LoadWarning label="The entity list" error={entities.isError} onRetry={() => void entities.refetch()} />
            {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} />}

            <Form<Values> form={form} layout="vertical" initialValues={initial} onFinish={(v) => void submit(v)}>
                <Form.Item
                    label="Title"
                    name="title"
                    rules={[
                        { required: true, whitespace: true, message: 'Give the task a title' },
                        { min: 3, message: 'At least 3 characters' },
                    ]}
                >
                    <Input maxLength={200} autoFocus />
                </Form.Item>
                <Form.Item label="Description (optional)" name="description">
                    <Input.TextArea rows={4} maxLength={5000} showCount />
                </Form.Item>
                <Form.Item label="Priority" name="priority" rules={[{ required: true }]}>
                    <Radio.Group
                        optionType="button"
                        options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
                    />
                </Form.Item>
                {task ? (
                    <Typography.Paragraph type="secondary">
                        Assigned to {task.assignee.name}. To give the task to someone else, use Reassign.
                    </Typography.Paragraph>
                ) : (
                    <Form.Item label="Assign to" name="assigneeId" rules={[{ required: true, message: 'Choose who does it' }]}>
                        <Select showSearch optionFilterProp="label" loading={users.isLoading} options={people} placeholder="Choose a person" />
                    </Form.Item>
                )}
                <Form.Item label="Entity (optional)" name="entityId">
                    <Select allowClear showSearch optionFilterProp="label" loading={entities.isLoading} options={entityOptions} placeholder="None" />
                </Form.Item>
                <Form.Item
                    label="Due date (optional)"
                    name="dueDate"
                    extra={task ? 'An existing due date can stay as it is, even when it has passed.' : undefined}
                >
                    <DatePicker disabledDate={disabledDate} style={{ width: '100%' }} />
                </Form.Item>
            </Form>
        </Modal>
    );
}