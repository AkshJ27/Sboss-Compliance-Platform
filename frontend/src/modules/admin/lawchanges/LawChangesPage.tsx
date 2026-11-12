import { lazy, Suspense, useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Statistic, Tabs, Typography, message } from 'antd';
import { ModuleBoundary } from '../../../app/ModuleBoundary';
import { useLawSummary } from './api';
import { HistoryTab } from './HistoryTab';
import { WaitingTab } from './WaitingTab';

const AmendmentDrawer = lazy(() => import('./AmendmentDrawer'));

function SummaryCards() {
    const q = useLawSummary();
    if (q.isError) {
        return (
            <Alert
                type="warning"
                showIcon
                message="The summary could not be loaded"
                action={
                    <Button size="small" onClick={() => void q.refetch()}>
                        Retry
                    </Button>
                }
            />
        );
    }
    const d = q.data;
    return (
        <Row gutter={[12, 12]}>
            <Col xs={24} md={8}>
                <Card size="small" loading={!d}>
                    <Statistic title="Laws waiting" value={d?.waiting ?? 0} />
                </Card>
            </Col>
            <Col xs={12} md={8}>
                <Card size="small" loading={!d}>
                    <Statistic
                        title="Need a decision"
                        value={d?.needDecision ?? 0}
                        valueStyle={{ color: d?.needDecision ? '#d46b08' : undefined }}
                    />
                </Card>
            </Col>
            <Col xs={12} md={8}>
                <Card size="small" loading={!d}>
                    <Statistic title="Information only" value={d?.informational ?? 0} />
                </Card>
            </Col>
        </Row>
    );
}

export default function LawChangesPage() {
    const [notify, holder] = message.useMessage();
    const [open, setOpen] = useState<string | null>(null);
    const summary = useLawSummary();

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {holder}
            <Typography.Title level={4} style={{ margin: 0 }}>
                Law changes
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                When a law changes, your schedules keep following the rule you had until you decide. Review each change, then apply
                it or keep your current rule. Open items move only if you apply it, and anything already submitted or closed is never changed.
            </Typography.Paragraph>

            <ModuleBoundary compact label="The summary">
                <SummaryCards />
            </ModuleBoundary>

            <Tabs
                items={[
                    {
                        key: 'waiting',
                        label: summary.data ? `Waiting (${summary.data.waiting})` : 'Waiting',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <WaitingTab notify={notify} onOpen={setOpen} />
                            </ModuleBoundary>
                        ),
                    },
                    {
                        key: 'history',
                        label: 'History',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <HistoryTab />
                            </ModuleBoundary>
                        ),
                    },
                ]}
            />

            {open && (
                <ModuleBoundary compact label="The review panel" resetKey={open}>
                    <Suspense fallback={null}>
                        <AmendmentDrawer id={open} notify={notify} onClose={() => setOpen(null)} />
                    </Suspense>
                </ModuleBoundary>
            )}
        </Space>
    );
}