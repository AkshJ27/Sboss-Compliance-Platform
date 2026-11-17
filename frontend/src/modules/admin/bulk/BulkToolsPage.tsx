import { Space, Tabs, Typography } from 'antd';
import { ModuleBoundary } from '../../../app/ModuleBoundary';
import { ComplinityImportTab } from './ComplinityImportTab';
import { ReplicateTab } from './ReplicateTab';
import { ScheduleImportTab } from './ScheduleImportTab';
import { SwapTab } from './SwapTab';

export default function BulkToolsPage() {
    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
                Bulk tools
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Changes that touch many records at once. Each tool shows a preview first and changes nothing until you confirm.
            </Typography.Paragraph>
            <Tabs
                items={[
                    {
                        key: 'replicate',
                        label: 'Copy a location',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <ReplicateTab />
                            </ModuleBoundary>
                        ),
                    },
                    {
                        key: 'swap',
                        label: 'Swap people',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <SwapTab />
                            </ModuleBoundary>
                        ),
                    },
                    {
                        key: 'complinity',
                        label: 'From Complinity',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <ComplinityImportTab />
                            </ModuleBoundary>
                        ),
                    },
                    {
                        key: 'import',
                        label: 'Import a file',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <ScheduleImportTab />
                            </ModuleBoundary>
                        ),
                    },
                ]}
            />
        </Space>
    );
}