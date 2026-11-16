import { Alert, Skeleton, Space, Tabs } from 'antd';
import { useMe } from '../../../core/auth/useMe';
import { ActsMasterTab } from './ActsMasterTab';
import { LookupMasterTab } from './LookupMasterTab';
import { RulesMasterTab } from './RulesMasterTab';

// Acts, rules and the shared lists behind the law library.
// Everyone can look; only the platform administrator can change them.
export function LibraryMastersTab() {
    const me = useMe();
    if (me.isError) return <Alert type="error" showIcon message="Your permissions could not be checked" />;
    if (!me.data) return <Skeleton active />;
    const canEdit = !!me.data.isPlatformAdmin;

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {!canEdit && (
                <Alert
                    type="info"
                    showIcon
                    message="These masters are shared by every company, so they are read-only for you"
                    description="Ask the platform administrator to add or correct an Act, rule or category. Your own compliances go on the Internal compliances tab."
                />
            )}
            <Tabs
                tabPosition="top"
                size="small"
                destroyInactiveTabPane
                items={[
                    { key: 'acts', label: 'Acts', children: <ActsMasterTab canEdit={canEdit} /> },
                    { key: 'rules', label: 'Rules', children: <RulesMasterTab canEdit={canEdit} /> },
                    {
                        key: 'law-categories',
                        label: 'Law categories',
                        children: <LookupMasterTab kind="law-categories" singular="law category" usedBy="Acts" canEdit={canEdit} />,
                    },
                    {
                        key: 'statutory-authorities',
                        label: 'Statutory authorities',
                        children: <LookupMasterTab kind="statutory-authorities" singular="statutory authority" usedBy="Acts" canEdit={canEdit} />,
                    },
                    {
                        key: 'natures',
                        label: 'Compliance natures',
                        children: <LookupMasterTab kind="natures" singular="compliance nature" usedBy="compliances" canEdit={canEdit} />,
                    },
                    {
                        key: 'types',
                        label: 'Compliance types',
                        children: <LookupMasterTab kind="types" singular="compliance type" usedBy="compliances" canEdit={canEdit} />,
                    },
                ]}
            />
        </Space>
    );
}