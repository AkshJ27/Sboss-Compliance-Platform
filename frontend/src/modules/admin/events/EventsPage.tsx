import { useState } from 'react';
import { Space, Tabs, Typography } from 'antd';
import { ModuleBoundary } from '../../../app/ModuleBoundary';
import { HistoryTab } from './HistoryTab';
import { TriggerTab } from './TriggerTab';

export default function EventsPage() {
    const [tab, setTab] = useState('record');
    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
                Events
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Some compliances start when something happens, such as a change of address or a new director, not on a calendar date.
                Record the event here and the items are created with their due dates.
            </Typography.Paragraph>
            <Tabs
                activeKey={tab}
                onChange={setTab}
                items={[
                    {
                        key: 'record',
                        label: 'Record an event',
                        children: (
                            <ModuleBoundary compact label="This tab">
                                <TriggerTab />
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
        </Space>
    );
}