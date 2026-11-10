import { Alert, Button, Card, Col, Progress, Row, Skeleton, Space, Typography } from 'antd';
import { CARD_KEY, STATUS_META, STATUS_ORDER } from '../../core/filters';
import type { DashStatus } from '../../core/filters';
import { formatDate } from '../../core/format';
import { useSummary } from './api';

type Props = {
    params: string;
    onOpen: (status: DashStatus, range: { from: string; to: string }) => void;
};

export function StatusCards({ params, onOpen }: Props) {
    const q = useSummary(params);

    if (q.isError && !q.data) {
        return (
            <Alert
                type="error"
                showIcon
                message="The status cards could not be loaded"
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

    const s = q.data;
    return (
        <Space direction="vertical" size="small" style={{ width: '100%', opacity: q.isPlaceholderData ? 0.6 : 1 }}>
            <Card size="small">
                <Space size="large" wrap>
                    <span>
                        Applicable compliances: <b>{s.applicable}</b>
                    </span>
                    <span style={{ color: '#cf1322' }}>
                        Pending for submission (as of {formatDate(s.asOf)}): <b>{s.headline.pendingForSubmission}</b>
                    </span>
                    <span style={{ color: '#cf1322' }}>
                        Oldest due date: <b>{s.headline.oldestDueDate ? formatDate(s.headline.oldestDueDate) : 'None'}</b>
                    </span>
                    <span>
                        Period: <b>{s.period.label}</b> ({formatDate(s.period.from)} to {formatDate(s.period.to)})
                    </span>
                </Space>
            </Card>

            <Row gutter={[12, 12]}>
                {STATUS_ORDER.map((status) => {
                    const meta = STATUS_META[status];
                    const card = s.cards[CARD_KEY[status]];
                    const open = () => onOpen(status, { from: s.period.from, to: s.period.to });
                    return (
                        <Col key={status} xs={12} md={8} xl={4}>
                            <Card
                                size="small"
                                hoverable
                                role="button"
                                tabIndex={0}
                                onClick={open}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') open();
                                }}
                                style={{ borderLeft: `4px solid ${meta.color}` }}
                            >
                                <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                                    <div>
                                        <Typography.Text type="secondary">{meta.label}</Typography.Text>
                                        <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.2 }}>{card.count}</div>
                                    </div>
                                    <Progress
                                        type="circle"
                                        size={48}
                                        percent={card.percent}
                                        strokeColor={meta.color}
                                        format={(p) => `${p ?? 0}%`}
                                    />
                                </Space>
                            </Card>
                        </Col>
                    );
                })}
            </Row>
        </Space>
    );
}