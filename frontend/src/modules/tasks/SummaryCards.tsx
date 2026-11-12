import { Alert, Button, Card, Col, Empty, Row, Skeleton, Statistic } from 'antd';
import dayjs from 'dayjs';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { useTaskSummary } from './api';
import type { CardPick } from './filters';
import { PRIORITIES, PRIORITY_HEX, PRIORITY_LABEL } from './meta';
import type { TaskPriority, TaskSummary } from './types';

type Props = { params: string; onPick: (pick: CardPick) => void };

type Slice = { priority: TaskPriority; name: string; value: number };

// Recharts hands back either the slice itself or its payload, depending on the version
function priorityOf(d: unknown): TaskPriority | null {
    const read = (x: unknown) => {
        const p = (x as { priority?: unknown } | null | undefined)?.priority;
        return typeof p === 'string' && (PRIORITIES as string[]).includes(p) ? (p as TaskPriority) : null;
    };
    return read(d) ?? read((d as { payload?: unknown } | null | undefined)?.payload);
}

function PriorityDonut({ data, onPick }: { data: TaskSummary['openByPriority']; onPick: (p: CardPick) => void }) {
    const slices: Slice[] = [
        { priority: 'HIGH', name: PRIORITY_LABEL.HIGH, value: data.high },
        { priority: 'MEDIUM', name: PRIORITY_LABEL.MEDIUM, value: data.medium },
        { priority: 'LOW', name: PRIORITY_LABEL.LOW, value: data.low },
    ];
    if (slices.every((s) => s.value === 0)) {
        return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No open tasks" />;
    }
    return (
        <ResponsiveContainer width="100%" height={170}>
            <PieChart>
                <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={40}
                    outerRadius={62}
                    label
                    onClick={(d: unknown) => {
                        const p = priorityOf(d);
                        if (p) onPick({ priority: p });
                    }}
                >
                    {slices.map((s) => (
                        <Cell key={s.priority} fill={PRIORITY_HEX[s.priority]} />
                    ))}
                </Pie>
                <Tooltip />
                <Legend />
            </PieChart>
        </ResponsiveContainer>
    );
}

export function SummaryCards({ params, onPick }: Props) {
    const q = useTaskSummary(params);

    if (q.isError && !q.data) {
        return (
            <Alert
                type="error"
                showIcon
                message="The task summary could not be loaded"
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
    const cards: { key: string; label: string; value: number; color: string; pick: CardPick }[] = [
        { key: 'open', label: 'Open', value: s.counts.open, color: '#1677ff', pick: { status: 'OPEN' } },
        { key: 'progress', label: 'In progress', value: s.counts.inProgress, color: '#faad14', pick: { status: 'IN_PROGRESS' } },
        { key: 'done', label: 'Done', value: s.counts.done, color: '#52c41a', pick: { status: 'DONE' } },
        { key: 'cancelled', label: 'Cancelled', value: s.counts.cancelled, color: '#9ca3af', pick: { status: 'CANCELLED' } },
        { key: 'overdue', label: 'Overdue', value: s.overdue, color: '#e5383b', pick: { status: 'ACTIVE', overdue: true } },
        {
            key: 'soon',
            label: 'Due in 7 days',
            value: s.dueSoon,
            color: '#f59e0b',
            pick: { status: 'ACTIVE', due: { from: s.asOf, to: dayjs(s.asOf).add(7, 'day').format('YYYY-MM-DD') } },
        },
    ];

    return (
        <Row gutter={[12, 12]} style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
            <Col xs={24} xl={16}>
                <Row gutter={[12, 12]}>
                    {cards.map((c) => (
                        <Col key={c.key} xs={12} md={8}>
                            <Card
                                size="small"
                                hoverable
                                role="button"
                                tabIndex={0}
                                onClick={() => onPick(c.pick)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') onPick(c.pick);
                                }}
                                style={{ borderLeft: `4px solid ${c.color}` }}
                            >
                                <Statistic title={c.label} value={c.value} />
                            </Card>
                        </Col>
                    ))}
                </Row>
            </Col>
            <Col xs={24} xl={8}>
                <ModuleBoundary compact label="The chart">
                    <Card size="small" title="Open tasks by priority" styles={{ body: { padding: 8 } }}>
                        <PriorityDonut data={s.openByPriority} onPick={onPick} />
                    </Card>
                </ModuleBoundary>
            </Col>
        </Row>
    );
}