import { useState } from 'react';
import { Space, Tabs, Typography } from 'antd';
import { ModuleBoundary } from '../../../app/ModuleBoundary';
import { ActivateTab } from './ActivateTab';
import { GenerateTab } from './GenerateTab';
import { SchedulesListTab } from './SchedulesListTab';

export default function SchedulesPage() {
    const [tab, setTab] = useState('activate');
    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
                Schedules
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Step 1: activate Acts at a location and assign the people. Step 2: generate the dated items. Both show a preview first.
            </Typography.Paragraph>
            <Tabs
                activeKey={tab}
                onChange={setTab}
                items={[
                    {
                        key: 'activate',
                        label: '1. Activate',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <ActivateTab onDone={() => setTab('generate')} />
                            </ModuleBoundary>
                        ),
                    },
                    {
                        key: 'generate',
                        label: '2. Generate items',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <GenerateTab />
                            </ModuleBoundary>
                        ),
                    },
                    {
                        key: 'list',
                        label: 'Schedules',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <SchedulesListTab />
                            </ModuleBoundary>
                        ),
                    },
                ]}
            />
        </Space>
    );
}