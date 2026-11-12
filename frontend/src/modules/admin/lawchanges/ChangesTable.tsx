import { Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import type { ChangeView } from './types';

function value(v: string | null, opaque: boolean) {
    if (opaque) return <Typography.Text type="secondary">changed</Typography.Text>;
    if (v === null) {
        return (
            <Typography.Text type="secondary" italic>
                empty
            </Typography.Text>
        );
    }
    return <span style={{ whiteSpace: 'pre-wrap' }}>{v}</span>;
}

export function ChangesTable({ changes }: { changes: ChangeView[] }) {
    if (changes.length === 0) {
        return <Typography.Text type="secondary">No field changes are left. The law ended up as it was.</Typography.Text>;
    }

    const columns: TableProps<ChangeView>['columns'] = [
        {
            title: 'What',
            key: 'what',
            width: 220,
            render: (_, c) => (
                <div>
                    {c.label}
                    <div>
                        {c.kind === 'RULE' ? <Tag color="orange">Affects due dates</Tag> : <Tag>Already visible</Tag>}
                    </div>
                </div>
            ),
        },
        { title: 'Was', key: 'from', render: (_, c) => value(c.from, c.opaque) },
        { title: 'Now', key: 'to', render: (_, c) => value(c.to, c.opaque) },
    ];

    return <Table<ChangeView> size="small" rowKey="field" columns={columns} dataSource={changes} pagination={false} />;
}

// A compact summary for list rows
export function ChangeTags({ changes, max = 4 }: { changes: ChangeView[]; max?: number }) {
    if (changes.length === 0) return <Typography.Text type="secondary">No field changes</Typography.Text>;
    return (
        <span>
            {changes.slice(0, max).map((c) => (
                <Tag key={c.field} color={c.kind === 'RULE' ? 'orange' : undefined}>
                    {c.label}
                </Tag>
            ))}
            {changes.length > max && <Typography.Text type="secondary">+{changes.length - max} more</Typography.Text>}
        </span>
    );
}