import { useState } from 'react';
import { Alert, Button, Card, Col, Drawer, Input, Popconfirm, Row, Skeleton, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { MessageInstance } from 'antd/es/message/interface';
import { api, ApiError } from '../../../core/api/client';
import { formatDate, titleCase } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { RISK_COLOR } from '../api';
import { useRefreshAfterLawDecision } from './api';
import { ChangesTable } from './ChangesTable';
import type { DecisionResult, Preview } from './types';

type Decision = 'APPLY' | 'KEEP' | 'ACKNOWLEDGE';
type Props = { id: string; notify: MessageInstance; onClose: () => void };

function resultText(r: DecisionResult): string {
    if (r.decision === 'APPLIED') {
        return `Applied. ${r.schedulesUpdated} schedule(s) updated and ${r.itemsMoved} open item(s) moved.`;
    }
    return r.decision === 'KEPT' ? 'Kept your current rule. The decision is recorded.' : 'Acknowledged.';
}

export default function AmendmentDrawer({ id, notify, onClose }: Props) {
    const refresh = useRefreshAfterLawDecision();
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState<Decision | null>(null);
    const [error, setError] = useState<string | null>(null);

    const q = useQuery({
        queryKey: ['lawchanges', 'preview', id],
        queryFn: ({ signal }) => api<Preview>(`/compliance/amendments/${id}`, { signal }),
    });
    const p = q.data;

    const decide = async (decision: Decision) => {
        if (!p) return;
        setBusy(decision);
        setError(null);
        try {
            // The version is the one on screen, so a decision is never made on something you did not see
            const res = await api<DecisionResult>(`/compliance/amendments/${id}/decision`, {
                method: 'POST',
                body: { decision, version: p.version, ...(note.trim() ? { note: note.trim() } : {}) },
            });
            notify.success(resultText(res));
            onClose();
            await refresh();
        } catch (e) {
            setError(errorText(e));
            // The law changed again, or someone else decided: show what is true now
            if (e instanceof ApiError && e.status === 409) await q.refetch();
        } finally {
            setBusy(null);
        }
    };

    const locked = busy !== null || q.isFetching;
    const moveRows = (p?.sampleMoves ?? []).map((m, i) => ({ key: i, ...m }));

    return (
        <Drawer
            open
            width="min(760px, 100vw)"
            onClose={onClose}
            title={
                p ? (
                    <Space direction="vertical" size={0}>
                        <span>{p.title}</span>
                        <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                            {p.code}
                        </Typography.Text>
                    </Space>
                ) : (
                    'Law change'
                )
            }
        >
            {q.isError && !p && (
                <Alert
                    type="error"
                    showIcon
                    message="This change could not be opened"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}
            {!p && !q.isError && <Skeleton active />}

            {p && (
                <Space direction="vertical" size="middle" style={{ width: '100%', opacity: q.isFetching ? 0.6 : 1 }}>
                    <Space wrap>
                        <Tag color={RISK_COLOR[p.risk]}>{titleCase(p.risk)} risk</Tag>
                        <Typography.Text type="secondary">
                            {p.act.state ? `${p.act.name} (${p.act.state})` : p.act.name}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                            Version {p.fromVersion} to {p.version}
                        </Typography.Text>
                    </Space>

                    {error && <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} />}

                    {p.needsDecision ? (
                        <Alert
                            type="warning"
                            showIcon
                            message="This change affects due dates"
                            description="Choose whether your schedules follow the new rule. Nothing changes until you decide."
                        />
                    ) : (
                        <Alert
                            type="info"
                            showIcon
                            message="This change does not affect due dates"
                            description="The wording, risk or proof requirement changed. Everyone already sees the new text. Acknowledge it to clear it from the list."
                        />
                    )}

                    <Card size="small" title="What changed">
                        <ChangesTable changes={p.changes} />
                    </Card>

                    {p.needsDecision && (
                        <Card size="small" title="The due-date rule">
                            <Space direction="vertical" style={{ width: '100%' }}>
                                <div>
                                    <Typography.Text type="secondary">Your schedules follow this now</Typography.Text>
                                    {p.currentRules.map((r) => (
                                        <div key={r.rule}>
                                            {r.rule} <Tag>{r.schedules} schedule(s)</Tag>
                                        </div>
                                    ))}
                                </div>
                                <div>
                                    <Typography.Text type="secondary">The new rule</Typography.Text>
                                    <div>
                                        <b>{p.newRule}</b>
                                    </div>
                                </div>
                            </Space>
                        </Card>
                    )}

                    <Card size="small" title={`Where it applies (${p.schedules} schedule${p.schedules === 1 ? '' : 's'})`}>
                        <Typography.Text>
                            {p.sampleLocations.join(', ')}
                            {p.schedules > p.sampleLocations.length ? ' and more' : ''}
                        </Typography.Text>
                    </Card>

                    {p.needsDecision && (
                        <Card size="small" title="What applying would do to open items">
                            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                                <Row gutter={[12, 12]}>
                                    <Col xs={12} md={6}>
                                        <Statistic title="Open items" value={p.items.open} />
                                    </Col>
                                    <Col xs={12} md={6}>
                                        <Statistic title="Will move" value={p.items.willMove} valueStyle={{ color: '#d46b08' }} />
                                    </Col>
                                    <Col xs={12} md={6}>
                                        <Statistic title="Already correct" value={p.items.unchanged} />
                                    </Col>
                                    <Col xs={12} md={6}>
                                        <Statistic title="Keep their dates" value={p.items.kept} />
                                    </Col>
                                </Row>
                                <Typography.Text type="secondary">
                                    Only items that are still due or returned move. Items already submitted, approved or closed are never changed.
                                </Typography.Text>
                                {p.notes.map((n) => (
                                    <Alert key={n} type="info" showIcon message={n} />
                                ))}
                                {moveRows.length > 0 && (
                                    <Table
                                        size="small"
                                        rowKey="key"
                                        dataSource={moveRows}
                                        pagination={false}
                                        columns={[
                                            { title: 'Location', dataIndex: 'location', key: 'location' },
                                            { title: 'Due date now', key: 'from', width: 140, render: (_, m) => formatDate(m.from) },
                                            { title: 'Would become', key: 'to', width: 140, render: (_, m) => formatDate(m.to) },
                                        ]}
                                    />
                                )}
                                {p.items.willMove > moveRows.length && (
                                    <Typography.Text type="secondary">
                                        Showing the first {moveRows.length} of {p.items.willMove}.
                                    </Typography.Text>
                                )}
                            </Space>
                        </Card>
                    )}

                    <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            Note (optional, kept in the record)
                        </Typography.Text>
                        <Input.TextArea
                            rows={2}
                            maxLength={500}
                            showCount
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />
                    </div>

                    <Space wrap>
                        {p.needsDecision ? (
                            <>
                                <Popconfirm
                                    title="Apply the new rule?"
                                    description={`${p.schedules} schedule(s) will follow it and ${p.items.willMove} open item(s) will move to new dates. Submitted and closed items are never changed.`}
                                    okText="Apply"
                                    onConfirm={() => void decide('APPLY')}
                                >
                                    <Button type="primary" loading={busy === 'APPLY'} disabled={locked && busy !== 'APPLY'}>
                                        Apply the new rule
                                    </Button>
                                </Popconfirm>
                                <Popconfirm
                                    title="Keep your current rule?"
                                    description="Your schedules keep their current due dates. The decision is recorded, and this change is not offered again unless the law changes again."
                                    okText="Keep my rule"
                                    onConfirm={() => void decide('KEEP')}
                                >
                                    <Button loading={busy === 'KEEP'} disabled={locked && busy !== 'KEEP'}>
                                        Keep my current rule
                                    </Button>
                                </Popconfirm>
                            </>
                        ) : (
                            <Button
                                type="primary"
                                loading={busy === 'ACKNOWLEDGE'}
                                disabled={locked && busy !== 'ACKNOWLEDGE'}
                                onClick={() => void decide('ACKNOWLEDGE')}
                            >
                                Acknowledge
                            </Button>
                        )}
                        <Button onClick={onClose}>Close</Button>
                    </Space>
                </Space>
            )}
        </Drawer>
    );
}