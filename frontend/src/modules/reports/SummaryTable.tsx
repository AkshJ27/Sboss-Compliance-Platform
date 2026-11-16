import { Button, Progress, Table, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { CARD_KEY, STATUS_META, STATUS_ORDER } from '../../core/filters';
import type { DashStatus } from '../../core/filters';
import { formatMoney } from '../../core/format';
import type { SummaryRow } from './types';

type OpenFn = (row: SummaryRow, status?: DashStatus) => void;

type Props = {
    rows: SummaryRow[];
    totals: SummaryRow;
    groupLabel: string;
    loading: boolean;
    onOpen: OpenFn;
};

const Dot = ({ color }: { color: string }) => (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color, marginRight: 6 }} />
);

function OnTime({ percent }: { percent: number | null }) {
    if (percent === null) return <Typography.Text type="secondary">–</Typography.Text>;
    const color = percent >= 90 ? '#22c55e' : percent >= 70 ? '#f59e0b' : '#e5383b';
    return <Progress percent={percent} size="small" strokeColor={color} format={(p) => `${p}%`} style={{ margin: 0 }} />;
}

// A count opens the records behind it. Groups with no value (no department, say) cannot be filtered on.
function CountLink({ value, open }: { value: number; open?: () => void }) {
    if (value === 0) return <Typography.Text type="secondary">0</Typography.Text>;
    if (!open) return <>{value}</>;
    return (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={open}>
            {value}
        </Button>
    );
}

export function SummaryTable({ rows, totals, groupLabel, loading, onOpen }: Props) {
    const columns: TableColumnsType<SummaryRow> = [
        {
            title: groupLabel,
            dataIndex: 'label',
            fixed: 'left',
            width: 220,
            sorter: (a, b) => a.label.localeCompare(b.label),
            render: (label: string, r) =>
                r.key === null ? (
                    <Typography.Text type="secondary">{label}</Typography.Text>
                ) : (
                    <Button type="link" size="small" style={{ padding: 0, textAlign: 'left', whiteSpace: 'normal', height: 'auto' }} onClick={() => onOpen(r)}>
                        {label}
                    </Button>
                ),
        },
        {
            title: 'Total',
            dataIndex: 'total',
            align: 'right',
            width: 80,
            sorter: (a, b) => a.total - b.total,
        },
        ...STATUS_ORDER.map((s) => ({
            key: s,
            title: (
                <span style={{ whiteSpace: 'nowrap' }}>
                    <Dot color={STATUS_META[s].color} />
                    {STATUS_META[s].label}
                </span>
            ),
            align: 'right' as const,
            width: 130,
            sorter: (a: SummaryRow, b: SummaryRow) => a.counts[CARD_KEY[s]] - b.counts[CARD_KEY[s]],
            render: (_: unknown, r: SummaryRow) => (
                <CountLink
                    value={r.counts[CARD_KEY[s]]}
                    open={r.key === null ? undefined : () => onOpen(r, s)}
                />
            ),
        })),
        {
            key: 'onTime',
            title: (
                <Tooltip title="Items closed on time, out of those closed or past their due date. Items not yet due, waiting for approval or not applicable are left out.">
                    <span style={{ whiteSpace: 'nowrap' }}>On time %</span>
                </Tooltip>
            ),
            width: 150,
            sorter: (a, b) => (a.onTimePercent ?? -1) - (b.onTimePercent ?? -1),
            render: (_, r) => <OnTime percent={r.onTimePercent} />,
        },
        {
            key: 'payable',
            title: 'Payable',
            align: 'right',
            width: 130,
            sorter: (a, b) => a.money.payable - b.money.payable,
            render: (_, r) => formatMoney(r.money.payable || null),
        },
        {
            key: 'paid',
            title: 'Paid',
            align: 'right',
            width: 130,
            sorter: (a, b) => a.money.paid - b.money.paid,
            render: (_, r) => formatMoney(r.money.paid || null),
        },
        {
            key: 'penalty',
            title: 'Penalty',
            align: 'right',
            width: 130,
            sorter: (a, b) => a.money.penalty - b.money.penalty,
            render: (_, r) =>
                r.money.penalty ? <Typography.Text type="danger">{formatMoney(r.money.penalty)}</Typography.Text> : '',
        },
    ];

    return (
        <Table<SummaryRow>
            size="small"
            rowKey={(r) => r.key ?? '__none'}
            columns={columns}
            dataSource={rows}
            loading={loading}
            scroll={{ x: 'max-content' }}
            pagination={rows.length > 25 ? { defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100] } : false}
            locale={{ emptyText: 'No items match these filters in this period' }}
            summary={() =>
                rows.length > 1 ? (
                    <Table.Summary fixed>
                        <Table.Summary.Row style={{ fontWeight: 600 }}>
                            <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
                            <Table.Summary.Cell index={1} align="right">
                                {totals.total}
                            </Table.Summary.Cell>
                            {STATUS_ORDER.map((s, i) => (
                                <Table.Summary.Cell key={s} index={2 + i} align="right">
                                    <CountLink value={totals.counts[CARD_KEY[s]]} open={() => onOpen(totals, s)} />
                                </Table.Summary.Cell>
                            ))}
                            <Table.Summary.Cell index={8}>
                                <OnTime percent={totals.onTimePercent} />
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={9} align="right">
                                {formatMoney(totals.money.payable || null)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={10} align="right">
                                {formatMoney(totals.money.paid || null)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={11} align="right">
                                {formatMoney(totals.money.penalty || null)}
                            </Table.Summary.Cell>
                        </Table.Summary.Row>
                    </Table.Summary>
                ) : null
            }
        />
    );
}