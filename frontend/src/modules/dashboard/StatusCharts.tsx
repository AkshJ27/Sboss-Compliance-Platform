import { Alert, Button, Card, Col, Empty, Row, Skeleton, Typography } from 'antd';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { CARD_KEY, STATUS_META, STATUS_ORDER } from '../../core/filters';
import type { DashStatus } from '../../core/filters';
import { titleCase } from '../../core/format';
import { useCharts } from './api';
import type { Bucket, Charts, Counts } from './types';

type OpenFn = (status: DashStatus, range: { from: string; to: string }) => void;
type ChartRow = { name: string; from: string; to: string } & Counts;

const toRow = (name: string, b: Bucket): ChartRow => ({ name, from: b.from, to: b.to, ...b.counts });

function StatusBars({ rows, onOpen }: { rows: ChartRow[]; onOpen: OpenFn }) {
    const handle = (status: DashStatus, d: unknown) => {
        const payload = (d as { payload?: ChartRow } | null)?.payload;
        if (payload?.from && payload.to) onOpen(status, { from: payload.from, to: payload.to });
    };

    return (
        <ResponsiveContainer width="100%" height={260}>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                {STATUS_ORDER.map((s) => (
                    <Bar
                        key={s}
                        dataKey={CARD_KEY[s]}
                        name={STATUS_META[s].label}
                        stackId="status"
                        fill={STATUS_META[s].color}
                        onClick={(d: unknown) => handle(s, d)}
                    />
                ))}
            </BarChart>
        </ResponsiveContainer>
    );
}

const RISK_COLORS = { HIGH: '#e5383b', MEDIUM: '#f59e0b', LOW: '#22c55e' } as const;

function RiskDonut({ data }: { data: Charts['nonComplianceByRisk'] }) {
    const total = data.reduce((n, r) => n + r.count, 0);
    if (total === 0) return <Empty description="No non-compliant items in this period" />;

    const rows = data.map((r) => ({ name: titleCase(r.risk), value: r.count, risk: r.risk }));
    return (
        <ResponsiveContainer width="100%" height={260}>
            <PieChart>
                <Pie data={rows} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} label>
                    {rows.map((r) => (
                        <Cell key={r.risk} fill={RISK_COLORS[r.risk]} />
                    ))}
                </Pie>
                <Tooltip />
                <Legend />
            </PieChart>
        </ResponsiveContainer>
    );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
    return (
        <ModuleBoundary compact label={title}>
            <Card size="small" title={title}>
                {children}
            </Card>
        </ModuleBoundary>
    );
}

export function StatusCharts({ params, onOpen }: { params: string; onOpen: OpenFn }) {
    const q = useCharts(params);

    if (q.isError && !q.data) {
        return (
            <Alert
                type="error"
                showIcon
                message="The charts could not be loaded"
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

    const c = q.data;
    return (
        <div style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                Click a bar segment to open those records.
            </Typography.Text>
            <Row gutter={[12, 12]}>
                <Col xs={24} xl={16}>
                    <ChartCard title="Yearly compliance status">
                        <StatusBars rows={c.yearly.map((y) => toRow(y.financialYear, y))} onOpen={onOpen} />
                    </ChartCard>
                </Col>
                <Col xs={24} xl={8}>
                    <ChartCard title="Non compliance by risk">
                        <RiskDonut data={c.nonComplianceByRisk} />
                    </ChartCard>
                </Col>
                <Col xs={24} xl={12}>
                    <ChartCard title={`Quarterly status ${c.financialYear}`}>
                        <StatusBars rows={c.quarterly.map((x) => toRow(x.quarter, x))} onOpen={onOpen} />
                    </ChartCard>
                </Col>
                <Col xs={24} xl={12}>
                    <ChartCard title={`Monthly status ${c.financialYear}`}>
                        <StatusBars rows={c.monthly.map((m) => toRow(m.label, m))} onOpen={onOpen} />
                    </ChartCard>
                </Col>
            </Row>
        </div>
    );
}