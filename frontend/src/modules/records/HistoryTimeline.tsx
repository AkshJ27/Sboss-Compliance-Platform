import { Alert, Button, Empty, Skeleton, Space, Tag, Timeline, Typography, message } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import { downloadDocument } from '../../shared/documents';
import { errorText } from '../../shared/errors';
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
    DUE_DATE_CHANGED: 'changed the due date',
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

// A due date moved by hand (not by a law change) can carry supporting files
function dueDateExtras(data: unknown): { manual: boolean; documentIds: string[] } {
    if (typeof data !== 'object' || data === null) return { manual: false, documentIds: [] };
    const d = data as { manual?: unknown; documentIds?: unknown };
    const ids = Array.isArray(d.documentIds) ? d.documentIds.filter((x): x is string => typeof x === 'string') : [];
    return { manual: d.manual === true, documentIds: ids };
}

export function HistoryTimeline({ id }: { id: string }) {
    const q = useHistory(id);
    const [notify, holder] = message.useMessage();
    const download = async (docId: string) => {
        try {
            await downloadDocument(docId);
        } catch (e) {
            notify.error(errorText(e));
        }
    };

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
        <>
            {holder}
            <Timeline
                items={q.data.map((e) => ({
                    color: COLOR[e.action],
                    children: (
                        <div>
                            <div>
                                <b>{e.actor.name}</b> {TEXT[e.action]}
                                {e.action === 'DUE_DATE_CHANGED' && !dueDateExtras(e.data).manual && ' after a change in the law'}
                                {e.toStatus && e.fromStatus !== e.toStatus && (
                                    <Tag style={{ marginLeft: 8 }}>{titleCase(e.toStatus)}</Tag>
                                )}
                            </div>
                            {e.action === 'DUE_DATE_CHANGED' && dueDateDetail(e.data) && (
                                <Typography.Text type="secondary">{dueDateDetail(e.data)}</Typography.Text>
                            )}
                            {e.action === 'DUE_DATE_CHANGED' && dueDateExtras(e.data).documentIds.length > 0 && (
                                <Space wrap size={4} style={{ display: 'flex' }}>
                                    {dueDateExtras(e.data).documentIds.map((docId, i) => (
                                        <Button key={docId} size="small" type="link" icon={<PaperClipOutlined />} onClick={() => void download(docId)}>
                                            Attachment {i + 1}
                                        </Button>
                                    ))}
                                </Space>
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
        </>
    );
}