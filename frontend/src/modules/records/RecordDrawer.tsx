import { useState } from 'react';
import { Alert, Badge, Button, Drawer, Skeleton, Space, Tabs, Tag, Typography, message } from 'antd';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { useAuth } from '../../core/auth/AuthContext';
import { STATUS_META } from '../../core/filters';
import { titleCase } from '../../core/format';
import { useRecord } from './api';
import { RISK_COLOR, STAGE_TEXT, capabilities } from './capabilities';
import { HistoryTimeline } from './HistoryTimeline';
import { ScheduleHistory } from './ScheduleHistory';
import { ProofSection } from './ProofSection';
import { ReassignModal } from './ReassignModal';
import { ChangeDueDateModal } from './ChangeDueDateModal';
import { RecordDetails, SubmissionSummary } from './RecordDetails';
import { ReviewActions } from './ReviewActions';
import { SubmitForm } from './SubmitForm';

type Props = { id: string; onClose: () => void; onNavigate: (id: string) => void };

export default function RecordDrawer({ id, onClose, onNavigate }: Props) {
    const { user } = useAuth();
    const [notify, holder] = message.useMessage();
    const [reassigning, setReassigning] = useState(false);
    const [changingDue, setChangingDue] = useState(false);
    const q = useRecord(id);
    const r = q.data;
    const caps = r && user ? capabilities(r, user) : null;

    return (
        <Drawer
            open
            width="min(720px, 100vw)"
            onClose={onClose}
            title={
                r ? (
                    <Space direction="vertical" size={0}>
                        <span>{r.compliance.title}</span>
                        <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                            {r.compliance.code}
                        </Typography.Text>
                    </Space>
                ) : (
                    'Compliance item'
                )
            }
            extra={
                <Space>
                    {caps?.canChangeDue && <Button onClick={() => setChangingDue(true)}>Change due date</Button>}
                    {caps?.canReassign && <Button onClick={() => setReassigning(true)}>Reassign</Button>}
                </Space>
            }
        >
            {holder}

            {q.isError && !r && (
                <Alert
                    type="error"
                    showIcon
                    message="This item could not be opened"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}
            {!r && !q.isError && <Skeleton active />}

            {r && caps && (
                <Space key={r.id} direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Space wrap>
                        <Badge color={STATUS_META[r.dashboardStatus].color} text={STATUS_META[r.dashboardStatus].label} />
                        {r.overdue && <Tag color="red">Overdue</Tag>}
                        <Tag color={RISK_COLOR[r.compliance.risk]}>{titleCase(r.compliance.risk)} risk</Tag>
                        <Typography.Text type="secondary">{STAGE_TEXT[r.status]}</Typography.Text>
                    </Space>

                    {r.status === 'RETURNED' && r.returnRemarks && (
                        <Alert type="warning" showIcon message="This item was returned" description={r.returnRemarks} />
                    )}

                    <Tabs
                        items={[
                            {
                                key: 'item',
                                label: 'Item',
                                children: (
                                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                                        {caps.canEdit && (
                                            <ModuleBoundary compact label="The form" resetKey={r.id}>
                                                <SubmitForm key={`${r.id}:${r.status}`} record={r} notify={notify} onNavigate={onNavigate} />
                                            </ModuleBoundary>
                                        )}
                                        {caps.reviewStage && (
                                            <ModuleBoundary compact label="The review buttons" resetKey={r.id}>
                                                <ReviewActions record={r} stage={caps.reviewStage} notify={notify} />
                                            </ModuleBoundary>
                                        )}
                                        {!caps.canEdit && <SubmissionSummary r={r} />}
                                        <RecordDetails r={r} />
                                    </Space>
                                ),
                            },
                            {
                                key: 'proof',
                                label: `Proof (${r._count.documents})`,
                                children: (
                                    <ModuleBoundary compact label="The proof list" resetKey={r.id}>
                                        <ProofSection record={r} notify={notify} />
                                    </ModuleBoundary>
                                ),
                            },
                            {
                                key: 'history',
                                label: 'History',
                                children: (
                                    <ModuleBoundary compact label="The history" resetKey={r.id}>
                                        <HistoryTimeline id={r.id} />
                                    </ModuleBoundary>
                                ),
                            },
                            {
                                key: 'periods',
                                label: 'All periods',
                                children: (
                                    <ModuleBoundary compact label="The periods" resetKey={r.id}>
                                        <ScheduleHistory id={r.id} onNavigate={onNavigate} />
                                    </ModuleBoundary>
                                ),
                            },
                        ]}
                    />
                    {caps.canReassign && (
                        <ReassignModal record={r} open={reassigning} onClose={() => setReassigning(false)} notify={notify} />
                    )}
                    {changingDue && (
                        <ChangeDueDateModal
                            record={r}
                            onClose={() => setChangingDue(false)}
                            onDone={() => {
                                setChangingDue(false);
                                notify.success('Due date changed');
                            }}
                        />
                    )}
                </Space>
            )}
        </Drawer>
    );
}