import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CARD_KEY, STATUS_META, STATUS_ORDER } from '../../core/filters';
import type { DashStatus } from '../../core/filters';
import type { SummaryRow } from './types';

const TOP = 12;
const shorten = (s: string) => (s.length > 24 ? `${s.slice(0, 23)}…` : s);

type Props = {
    rows: SummaryRow[];
    onOpen: (row: SummaryRow, status: DashStatus) => void;
};

// The groups with the most items, one stacked bar each
export function SummaryChart({ rows, onOpen }: Props) {
    const top = [...rows].sort((a, b) => b.total - a.total).slice(0, TOP);
    const data = top.map((r) => ({ name: r.label, row: r, ...r.counts }));

    const handle = (status: DashStatus, d: unknown) => {
        const row = (d as { payload?: { row?: SummaryRow } } | null)?.payload?.row;
        if (row && row.key !== null) onOpen(row, status);
    };

    return (
        <ResponsiveContainer width="100%" height={Math.max(160, top.length * 34 + 70)}>
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12 }} tickFormatter={shorten} />
                <Tooltip />
                <Legend />
                {STATUS_ORDER.map((s) => (
                    <Bar
                        key={s}
                        dataKey={CARD_KEY[s]}
                        name={STATUS_META[s].label}
                        stackId="status"
                        fill={STATUS_META[s].color}
                        cursor="pointer"
                        onClick={(d: unknown) => handle(s, d)}
                    />
                ))}
            </BarChart>
        </ResponsiveContainer>
    );
}