import { Alert, Button, Empty, Skeleton, Tag, Timeline, Typography } from 'antd';
import { formatDate, formatDateTime, titleCase } from '../../core/format';
import { useHistory } from './api';
import type { HistoryEvent } from './types';

const TEXT: Record<HistoryEvent['action'], string> = {
    DRAFT_SAVED: 'saved a draft',
    SUBMITTED: 'submitted this item',
    MANAGER_APPROVED: 'approved it as manager',
    APPROVED: 'approved this item',
    RETURNED: 'returned this item',
    REASSIGNED: 'changed the people on this item',
    DUE_DATE_CHANGED: 'changed the due date after a change in the law',
};

const COLOR: Record<HistoryEvent['action'], string> = {
    DRAFT_SAVED: 'gray',
    SUBMITTED: 'blue',
    MANAGER_APPROVED: 'green',
    APPROVED: 'green',
    RETURNED: 'red',
    REASSIGNED: 'orange',
    DUE_DATE_CHANGED: 'orange',
};

// The event stores the old and new due dates as plain dates
function dueDateDetail(data: unknown): string | null {
    if (typeof data !== 'object' || data === null) return null;
    const d = data as { from?: unknown; to?: unknown };
    if (typeof d.to !== 'string') return null;
    return typeof d.from === 'string'
        ? `From ${formatDate(d.from)} to ${formatDate(d.to)}`
        : `Now due on ${formatDate(d.to)}`;
}

export function HistoryTimeline({ id }: { id: string }) {
    const q = useHistory(id);

    if (q.isError) {
        return (
            <Alert
                type="error"
                showIcon
                message="The history could not be loaded"
                description={q.error.message}
                action={
                    <Button size="small" onClick={() => void q.refetch()}>
                        Retry
                    </Button>
                }
            />
        );
    }
    if (!q.data) return <Skeleton active />;
    if (q.data.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No activity yet" />;

    return (
        <Timeline
            items={q.data.map((e) => ({
                color: COLOR[e.action],
                children: (
                    <div>
                        <div>
                            <b>{e.actor.name}</b> {TEXT[e.action]}
                            {e.toStatus && e.fromStatus !== e.toStatus && (
                                <Tag style={{ marginLeft: 8 }}>{titleCase(e.toStatus)}</Tag>
                            )}
                        </div>
                        {e.action === 'DUE_DATE_CHANGED' && dueDateDetail(e.data) && (
                            <Typography.Text type="secondary">{dueDateDetail(e.data)}</Typography.Text>
                        )}
                        {e.remarks && (
                            <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0', fontStyle: 'italic' }}>
                                {e.remarks}
                            </Typography.Paragraph>
                        )}
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                            {formatDateTime(e.createdAt)}
                        </Typography.Text>
                    </div>
                ),
            }))}
        />
    );
}