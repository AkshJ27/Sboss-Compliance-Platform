import { Space, Tabs, Typography } from 'antd';
import type { ReactNode } from 'react';
import { ModuleBoundary } from '../../../app/ModuleBoundary';
import { EntitiesTab } from './EntitiesTab';
import { FinancialYearsTab } from './FinancialYearsTab';
import { LocationsTab } from './LocationsTab';
import { SimpleMasterTab } from './SimpleMasterTab';

const wrap = (node: ReactNode) => (
    <ModuleBoundary compact label="This tab">
        {node}
    </ModuleBoundary>
);

export default function MastersPage() {
    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
                Masters
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                The company setup that every compliance item uses. Records are deactivated, never deleted, so history stays intact.
            </Typography.Paragraph>
            <Tabs
                items={[
                    { key: 'entities', label: 'Entities', children: wrap(<EntitiesTab />) },
                    { key: 'locations', label: 'Locations', children: wrap(<LocationsTab />) },
                    {
                        key: 'departments',
                        label: 'Departments',
                        children: wrap(<SimpleMasterTab kind="departments" singular="department" plural="departments" />),
                    },
                    {
                        key: 'verticals',
                        label: 'Verticals',
                        children: wrap(<SimpleMasterTab kind="verticals" singular="vertical" plural="verticals" />),
                    },
                    {
                        key: 'types',
                        label: 'Location types',
                        children: wrap(<SimpleMasterTab kind="location-types" singular="location type" plural="location types" />),
                    },
                    { key: 'fy', label: 'Financial years', children: wrap(<FinancialYearsTab />) },
                ]}
            />
        </Space>
    );
}