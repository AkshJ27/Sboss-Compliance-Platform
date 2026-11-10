import { Suspense } from 'react';
import { Button, Dropdown, Layout, Menu, Spin, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
    AuditOutlined,
    BellOutlined,
    BookOutlined,
    CalendarOutlined,
    DashboardOutlined,
    DatabaseOutlined,
    FileTextOutlined,
    LogoutOutlined,
    SettingOutlined,
    TeamOutlined,
    UnorderedListOutlined,
    UserOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../core/auth/AuthContext';
import { useMe } from '../core/auth/useMe';
import { NotificationBell } from '../modules/notifications/NotificationBell';
import { ModuleBoundary } from './ModuleBoundary';

function selectedKey(path: string) {
    if (path.startsWith('/admin/')) return path.split('/').slice(0, 3).join('/');
    if (path.startsWith('/records')) return '/records';
    if (path.startsWith('/documents')) return '/documents';
    return '/';
}

export function Shell() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const me = useMe();
    const admin = user?.role === 'ORG_ADMIN';

    const items: MenuProps['items'] = [
        { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
        { key: '/records', icon: <UnorderedListOutlined />, label: 'Records' },
        { key: '/documents', icon: <FileTextOutlined />, label: 'Documents' },
        ...(admin
            ? [
                {
                    key: 'admin',
                    icon: <SettingOutlined />,
                    label: 'Setup',
                    children: [
                        { key: '/admin/masters', icon: <DatabaseOutlined />, label: 'Masters' },
                        { key: '/admin/users', icon: <TeamOutlined />, label: 'Users' },
                        { key: '/admin/schedules', icon: <CalendarOutlined />, label: 'Schedules' },
                        { key: '/admin/library', icon: <BookOutlined />, label: 'Law library' },
                        { key: '/admin/audit', icon: <AuditOutlined />, label: 'Audit log' },
                    ],
                },
            ]
            : []),
    ];

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Layout.Sider collapsible breakpoint="lg" theme="dark">
                <div style={{ color: '#fff', fontWeight: 600, fontSize: 16, padding: '16px 20px' }}>Compliance</div>
                <Menu
                    theme="dark"
                    mode="inline"
                    selectedKeys={[selectedKey(location.pathname)]}
                    defaultOpenKeys={location.pathname.startsWith('/admin/') ? ['admin'] : []}
                    onClick={({ key }) => navigate(key)}
                    items={items}
                />
            </Layout.Sider>

            <Layout>
                <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 12, paddingInline: 16 }}>
                    <Typography.Text style={{ color: '#fff', flex: 1 }}>{me.data?.organization.name ?? ''}</Typography.Text>

                    <ModuleBoundary
                        compact
                        resetKey={location.pathname}
                        fallback={<BellOutlined style={{ fontSize: 20, color: '#8c8c8c' }} title="Notifications unavailable" />}
                    >
                        <NotificationBell />
                    </ModuleBoundary>

                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: [
                                {
                                    key: 'logout',
                                    icon: <LogoutOutlined />,
                                    label: 'Sign out',
                                    onClick: () => void logout(),
                                },
                            ],
                        }}
                    >
                        <Button type="text" icon={<UserOutlined />} style={{ color: '#fff' }}>
                            {user?.name}
                        </Button>
                    </Dropdown>
                </Layout.Header>

                <Layout.Content style={{ padding: 16 }}>
                    <ModuleBoundary resetKey={location.pathname}>
                        <Suspense
                            fallback={
                                <div style={{ textAlign: 'center', padding: 48 }}>
                                    <Spin />
                                </div>
                            }
                        >
                            <Outlet />
                        </Suspense>
                    </ModuleBoundary>
                </Layout.Content>
            </Layout>
        </Layout>
    );
}