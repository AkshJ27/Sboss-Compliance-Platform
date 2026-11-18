import { useEffect, useState } from 'react';
import { Alert, Modal, Space, Table, Tag, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { errorText } from '../../../shared/errors';

type Vendor = { name: string; email: string; verticals: string[]; changed: boolean };
type Plan = { companyDomain: string; dryRun: boolean; vendors: Vendor[]; withoutItems: { name: string; email: string }[]; toChange: number };

// Limits every outside user (a vendor) to the verticals of the items they work on. Shows the list first.
export function VendorAccessModal({ onClose }: { onClose: () => void }) {
    const qc = useQueryClient();
    const [plan, setPlan] = useState<Plan | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        api<Plan>('/users/vendor-access?dryRun=true', { method: 'POST', body: {} })
            .then(setPlan)
            .catch((e: unknown) => setError(errorText(e)));
    }, []);

    const apply = async () => {
        setBusy(true);
        try {
            setPlan(await api<Plan>('/users/vendor-access?dryRun=false', { method: 'POST', body: {} }));
            await qc.invalidateQueries({ queryKey: ['users'] });
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const saved = plan && !plan.dryRun;
    return (
        <Modal
            open
            width={800}
            title="Limit vendors to their verticals"
            okText={saved ? 'Done' : `Apply to ${plan?.toChange ?? 0} user(s)`}
            okButtonProps={{ disabled: !plan || (!saved && plan.toChange === 0) }}
            confirmLoading={busy}
            onOk={() => (saved ? onClose() : void apply())}
            onCancel={onClose}
            cancelButtonProps={{ style: saved ? { display: 'none' } : undefined }}
        >
            <Space direction="vertical" style={{ width: '100%' }}>
                {error && <Alert type="error" showIcon message={error} />}
                {plan && (
                    <>
                        <Alert
                            type={saved ? 'success' : 'info'}
                            showIcon
                            message={
                                saved
                                    ? `Done. ${plan.toChange} user(s) are now limited to their verticals.`
                                    : `Everyone whose email is not @${plan.companyDomain} is treated as a vendor, and limited to the verticals of the items they work on.`
                            }
                            description="A limited user sees only their own compliance items, and documents, people and locations of their verticals. You can change anyone's verticals later with Edit."
                        />
                        <Table<Vendor>
                            size="small"
                            rowKey="email"
                            pagination={false}
                            dataSource={plan.vendors}
                            columns={[
                                { title: 'Name', dataIndex: 'name', key: 'n' },
                                { title: 'Email', dataIndex: 'email', key: 'e' },
                                { title: 'Limited to', key: 'v', render: (_, v) => v.verticals.map((x) => <Tag key={x}>{x}</Tag>) },
                                { title: '', key: 'c', width: 110, render: (_, v) => (v.changed ? <Tag color="blue">{saved ? 'Set' : 'Will set'}</Tag> : 'Already set') },
                            ]}
                        />
                        {plan.withoutItems.length > 0 && (
                            <Typography.Text type="secondary">
                                No items yet, so not limited: {plan.withoutItems.map((u) => u.name).join(', ')}. Set their verticals with Edit, or run
                                this again after their items are assigned.
                            </Typography.Text>
                        )}
                    </>
                )}
            </Space>
        </Modal>
    );
}