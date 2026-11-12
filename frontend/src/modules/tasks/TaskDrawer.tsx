import { useState } from 'react';
import { Alert, Button, Descriptions, Divider, Drawer, Input, Skeleton, Space, Tag, Typography } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import { api, ApiError } from '../../core/api/client';
import { formatDate, formatDateTime } from '../../core/format';
import { errorText } from '../../shared/errors';
import { useUsers } from '../admin/api';
import { ActivityTimeline } from './ActivityTimeline';
import { useRefreshAfterTaskChange, useTask } from './api';
import { PRIORITY_COLOR, PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL } from './meta';
import { ReasonModal } from './ReasonModal';
import { TaskFormModal } from './TaskFormModal';
import { TaskReassignModal } from './TaskReassignModal';
import type { TaskStatus } from './types';

type Props = { id: string; notify: MessageInstance; onClose: () => void };
type ModalKind = 'edit' | 'reassign' | 'cancel' | 'reopen';

export default function TaskDrawer({ id, notify, onClose }: Props) {
    const q = useTask(id);
    const users = useUsers();
    const refresh = useRefreshAfterTaskChange();
    const [busy, setBusy] = useState<string | null>(null);
    const [modal, setModal] = useState<ModalKind | null>(null);
    const [text, setText] = useState('');
    const t = q.data;

    const people = new Map((users.data ?? []).map((u) => [u.id, u.name]));

    // Runs one change. A clash (409) means the task changed under us, so close any dialog and show what is true now.
    const run = async (key: string, fn: () => Promise<unknown>, success: string): Promise<boolean> => {
        setBusy(key);
        try {
            await fn();
            notify.success(success);
            await refresh();
            return true;
        } catch (e) {
            notify.error(errorText(e));
            if (e instanceof ApiError && e.status === 409) {
                setModal(null);
                await refresh();
            }
            return false;
        } finally {
            setBusy(null);
        }
    };

    const setStatus = (status: TaskStatus, remarks?: string) =>
        api(`/tasks/${id}/status`, { method: 'POST', body: remarks ? { status, remarks } : { status } });

    return (
        <Drawer
            open
            width="min(720px, 100vw)"
            onClose={onClose}
            title={
                t ? (
                    <Space direction="vertical" size={2}>
                        <span>{t.title}</span>
                        <Space size={4} wrap>
                            <Tag color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status]}</Tag>
                            <Tag color={PRIORITY_COLOR[t.priority]}>{PRIORITY_LABEL[t.priority]} priority</Tag>
                            {t.overdue && <Tag color="red">Overdue</Tag>}
                        </Space>
                    </Space>
                ) : (
                    'Task'
                )
            }
        >
            {q.isError && !t && (
                <Alert
                    type="error"
                    showIcon
                    message="This task could not be opened"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}
            {!t && !q.isError && <Skeleton active />}

            {t && (
                <Space direction="vertical" size="middle" style={{ width: '100%', opacity: q.isFetching ? 0.7 : 1 }}>
                    {t.status === 'CANCELLED' && (
                        <Alert type="info" showIcon message={`This task was cancelled${t.cancelledAt ? ` on ${formatDateTime(t.cancelledAt)}` : ''}.`} />
                    )}
                    {t.status === 'DONE' && t.completedAt && (
                        <Alert type="success" showIcon message={`Completed on ${formatDateTime(t.completedAt)}.`} />
                    )}

                    {t.description && (
                        <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{t.description}</Typography.Paragraph>
                    )}

                    <Descriptions
                        size="small"
                        bordered
                        column={2}
                        items={[
                            { key: 'assignee', label: 'Assigned to', children: t.assignee.name },
                            { key: 'by', label: 'Created by', children: t.createdBy.name },
                            { key: 'entity', label: 'Entity', children: t.entity ? `${t.entity.name} (${t.entity.code})` : '-' },
                            { key: 'due', label: 'Due date', children: t.dueDate ? formatDate(t.dueDate) : 'No due date' },
                            { key: 'created', label: 'Created', span: 2, children: formatDateTime(t.createdAt) },
                        ]}
                    />

                    <Space wrap>
                        {t.can.start && (
                            <Button loading={busy === 'start'} disabled={busy !== null && busy !== 'start'} onClick={() => void run('start', () => setStatus('IN_PROGRESS'), 'Task started')}>
                                Start
                            </Button>
                        )}
                        {t.can.finish && (
                            <Button type="primary" loading={busy === 'done'} disabled={busy !== null && busy !== 'done'} onClick={() => void run('done', () => setStatus('DONE'), 'Task marked as done')}>
                                Mark as done
                            </Button>
                        )}
                        {t.can.reopen && (
                            <Button disabled={busy !== null} onClick={() => setModal('reopen')}>
                                Reopen
                            </Button>
                        )}
                        {t.can.edit && (
                            <Button disabled={busy !== null} onClick={() => setModal('edit')}>
                                Edit
                            </Button>
                        )}
                        {t.can.reassign && (
                            <Button disabled={busy !== null} onClick={() => setModal('reassign')}>
                                Reassign
                            </Button>
                        )}
                        {t.can.cancel && (
                            <Button danger disabled={busy !== null} onClick={() => setModal('cancel')}>
                                Cancel task
                            </Button>
                        )}
                    </Space>

                    <Divider style={{ margin: '4px 0' }}>Activity</Divider>
                    <ActivityTimeline events={t.events} people={people} />

                    {t.can.comment ? (
                        <Space direction="vertical" style={{ width: '100%' }}>
                            <Input.TextArea
                                rows={3}
                                maxLength={2000}
                                showCount
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                placeholder="Write a comment"
                            />
                            <Button
                                type="primary"
                                disabled={!text.trim() || (busy !== null && busy !== 'comment')}
                                loading={busy === 'comment'}
                                onClick={async () => {
                                    const ok = await run(
                                        'comment',
                                        () => api(`/tasks/${id}/comments`, { method: 'POST', body: { body: text.trim() } }),
                                        'Comment added',
                                    );
                                    if (ok) setText('');
                                }}
                            >
                                Add comment
                            </Button>
                        </Space>
                    ) : (
                        <Typography.Text type="secondary">
                            Only the assignee, the person who created this task, or an admin can comment.
                        </Typography.Text>
                    )}
                </Space>
            )}

            {modal === 'edit' && t && (
                <TaskFormModal
                    task={t}
                    notify={notify}
                    onClose={() => setModal(null)}
                    onSaved={() => {
                        setModal(null);
                        notify.success('Saved');
                        void refresh();
                    }}
                />
            )}
            {modal === 'reassign' && t && (
                <TaskReassignModal
                    task={t}
                    busy={busy === 'reassign'}
                    onCancel={() => setModal(null)}
                    onConfirm={async (assigneeId, remarks) => {
                        const ok = await run(
                            'reassign',
                            () => api(`/tasks/${id}/reassign`, { method: 'POST', body: { assigneeId, ...(remarks ? { remarks } : {}) } }),
                            'Task reassigned',
                        );
                        if (ok) setModal(null);
                    }}
                />
            )}
            {modal === 'cancel' && (
                <ReasonModal
                    title="Cancel this task"
                    help="A cancelled task cannot be reopened. Say why it is being cancelled."
                    okText="Cancel the task"
                    danger
                    busy={busy === 'cancel'}
                    onCancel={() => setModal(null)}
                    onConfirm={async (reason) => {
                        const ok = await run('cancel', () => setStatus('CANCELLED', reason), 'Task cancelled');
                        if (ok) setModal(null);
                    }}
                />
            )}
            {modal === 'reopen' && (
                <ReasonModal
                    title="Reopen this task"
                    help="Say what still needs doing."
                    okText="Reopen"
                    busy={busy === 'reopen'}
                    onCancel={() => setModal(null)}
                    onConfirm={async (reason) => {
                        const ok = await run('reopen', () => setStatus('OPEN', reason), 'Task reopened');
                        if (ok) setModal(null);
                    }}
                />
            )}
        </Drawer>
    );
}