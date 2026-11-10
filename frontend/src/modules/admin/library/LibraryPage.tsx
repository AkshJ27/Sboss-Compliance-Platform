import { Alert, Skeleton, Space, Tabs, Typography } from 'antd';
import { ModuleBoundary } from '../../../app/ModuleBoundary';
import { useMe } from '../../../core/auth/useMe';
import { BrowseTab } from './BrowseTab';
import { ImportTab } from './ImportTab';

function ImportGate() {
    const me = useMe();
    if (me.isError) return <Alert type="error" showIcon message="Your permissions could not be checked" />;
    if (!me.data) return <Skeleton active />;
    if (!me.data.isPlatformAdmin) {
        return (
            <Alert
                type="info"
                showIcon
                message="Importing is limited to the platform administrator"
                description="The law library is shared by every company, so only the platform administrator can change it. You can browse it on the other tab."
            />
        );
    }
    return <ImportTab />;
}

export default function LibraryPage() {
    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
                Law library
            </Typography.Title>
            <Tabs
                items={[
                    {
                        key: 'browse',
                        label: 'Browse',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <BrowseTab />
                            </ModuleBoundary>
                        ),
                    },
                    {
                        key: 'import',
                        label: 'Import',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <ImportGate />
                            </ModuleBoundary>
                        ),
                    },
                ]}
            />
        </Space>
    );
}