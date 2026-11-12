import { useState } from 'react';
import { Badge, Button, Empty, List, Popover, Spin, Typography } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../core/api/client';
import { formatDateTime } from '../../core/format';

type NotificationItem = {
    id: string;
    type: string;
    title: string;
    body: string;
    instanceId: string | null;
    taskId: string | null;
    readAt: string | null;
    createdAt: string;
};
type NotificationPage = { items: NotificationItem[]; total: number; unreadCount: number };

function NotificationList({ onClose }: { onClose: () => void }) {
    const qc = useQueryClient();
    const navigate = useNavigate();

    const list = useQuery({
        queryKey: ['notifications', 'list'],
        queryFn: ({ signal }) => api<NotificationPage>('/notifications?limit=10', { signal }),
    });
    const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
    const markAll = useMutation({
        mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
        onSuccess: refresh,
    });
    const markOne = useMutation({
        mutationFn: (id: string) => api('/notifications/read', { method: 'POST', body: { ids: [id] } }),
        onSuccess: refresh,
    });

    const open = (n: NotificationItem) => {
        if (!n.readAt) markOne.mutate(n.id);
        onClose();
        if (n.instanceId) navigate(`/records?open=${n.instanceId}`);
        else if (n.taskId) navigate(`/tasks?open=${n.taskId}`);
    };

    if (list.isError) {
        return (
            <div style={{ width: 340 }}>
                <Typography.Text type="danger">Notifications could not be loaded.</Typography.Text>{' '}
                <Button size="small" onClick={() => void list.refetch()}>
                    Retry
                </Button>
            </div>
        );
    }
    if (!list.data) return <Spin />;

    return (
        <div style={{ width: 340 }}>
            <div style={{ textAlign: 'right', marginBottom: 4 }}>
                <Button
                    size="small"
                    type="link"
                    disabled={list.data.unreadCount === 0}
                    loading={markAll.isPending}
                    onClick={() => markAll.mutate()}
                >
                    Mark all read
                </Button>
            </div>
            {list.data.items.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notifications" />
            ) : (
                <List
                    size="small"
                    dataSource={list.data.items}
                    renderItem={(n) => (
                        <List.Item style={{ cursor: 'pointer' }} onClick={() => open(n)}>
                            <List.Item.Meta
                                title={<span style={{ fontWeight: n.readAt ? 400 : 600 }}>{n.title}</span>}
                                description={
                                    <>
                                        <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }} type="secondary">
                                            {n.body}
                                        </Typography.Paragraph>
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                            {formatDateTime(n.createdAt)}
                                        </Typography.Text>
                                    </>
                                }
                            />
                        </List.Item>
                    )}
                />
            )}
        </div>
    );
}

export function NotificationBell() {
    const [open, setOpen] = useState(false);
    const unread = useQuery({
        queryKey: ['notifications', 'unread'],
        queryFn: ({ signal }) => api<{ unreadCount: number }>('/notifications/unread-count', { signal }),
        refetchInterval: 60_000,
    });

    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            title="Notifications"
            open={open}
            onOpenChange={setOpen}
            content={<NotificationList onClose={() => setOpen(false)} />}
        >
            <Badge count={unread.data?.unreadCount ?? 0} size="small" overflowCount={99}>
                <Button
                    type="text"
                    aria-label="Notifications"
                    title={unread.isError ? 'Notifications are unavailable right now' : 'Notifications'}
                    icon={<BellOutlined style={{ fontSize: 20, color: unread.isError ? '#8c8c8c' : '#fff' }} />}
                />
            </Badge>
        </Popover>
    );
}