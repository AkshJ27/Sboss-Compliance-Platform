import type { ReactNode } from 'react';
import { Empty, Tag, Timeline, Typography } from 'antd';
import { formatDate, formatDateTime } from '../../core/format';
import { PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL } from './meta';
import type { TaskEventRow, TaskPriority, TaskStatus } from './types';

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown) => (typeof x === 'string' && x !== '' ? x : null);
const priorityText = (x: unknown) => (typeof x === 'string' && x in PRIORITY_LABEL ? PRIORITY_LABEL[x as TaskPriority] : 'none');
const dateText = (x: unknown) => (typeof x === 'string' ? formatDate(x) : 'none');

function updateLines(data: unknown): string[] {
    if (!isObject(data)) return [];
    return Object.entries(data).flatMap(([field, v]) => {
        if (!isObject(v)) return [];
        switch (field) {
            case 'title':
                return [`Title: "${str(v.from) ?? ''}" to "${str(v.to) ?? ''}"`];
            case 'priority':
                return [`Priority: ${priorityText(v.from)} to ${priorityText(v.to)}`];
            case 'dueDate':
                return [`Due date: ${dateText(v.from)} to ${dateText(v.to)}`];
            case 'description':
                return ['The description was changed'];
            case 'entityId':
                return ['The entity was changed'];
            default:
                return [];
        }
    });
}

const statusTag = (s: TaskStatus) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>;

type View = { color: string; text: ReactNode; detail?: ReactNode };

function view(e: TaskEventRow, people: ReadonlyMap<string, string>): View {
    const name = (id: unknown) => (typeof id === 'string' ? people.get(id) : undefined) ?? 'someone';
    const d = isObject(e.data) ? e.data : {};

    switch (e.action) {
        case 'CREATED': {
            const bits: string[] = [];
            if (typeof d.assigneeId === 'string') bits.push(`Assigned to ${name(d.assigneeId)}`);
            if (typeof d.priority === 'string') bits.push(`${priorityText(d.priority)} priority`);
            if (typeof d.dueDate === 'string') bits.push(`due ${formatDate(d.dueDate)}`);
            return { color: 'blue', text: 'created this task', detail: bits.length ? bits.join(', ') : undefined };
        }
        case 'UPDATED': {
            const lines = updateLines(e.data);
            return {
                color: 'orange',
                text: 'edited this task',
                detail: lines.length ? (
                    <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                        {lines.map((l) => (
                            <li key={l}>{l}</li>
                        ))}
                    </ul>
                ) : undefined,
            };
        }
        case 'REASSIGNED':
            return {
                color: 'orange',
                text: `reassigned this task from ${name(d.fromUserId)} to ${name(d.toUserId)}`,
            };
        case 'STATUS_CHANGED':
            return {
                color: e.toStatus === 'DONE' ? 'green' : e.toStatus === 'CANCELLED' ? 'red' : 'blue',
                text:
                    e.fromStatus && e.toStatus ? (
                        <>
                            changed the status from {statusTag(e.fromStatus)} to {statusTag(e.toStatus)}
                        </>
                    ) : (
                        'changed the status'
                    ),
            };
        case 'COMMENTED':
            return {
                color: 'gray',
                text: 'commented',
                detail: (
                    <Typography.Paragraph
                        style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', borderLeft: '3px solid #d9d9d9', paddingLeft: 8 }}
                    >
                        {e.remarks}
                    </Typography.Paragraph>
                ),
            };
    }
}

type Props = { events: TaskEventRow[]; people: ReadonlyMap<string, string> };

export function ActivityTimeline({ events, people }: Props) {
    if (events.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No activity yet" />;

    return (
        <Timeline
            items={events.map((e) => {
                const v = view(e, people);
                return {
                    color: v.color,
                    children: (
                        <div>
                            <div>
                                <b>{e.actor.name}</b> {v.text}
                            </div>
                            {v.detail && <div>{v.detail}</div>}
                            {e.remarks && e.action !== 'COMMENTED' && (
                                <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0', fontStyle: 'italic' }}>
                                    {e.remarks}
                                </Typography.Paragraph>
                            )}
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {formatDateTime(e.createdAt)}
                            </Typography.Text>
                        </div>
                    ),
                };
            })}
        />
    );
}