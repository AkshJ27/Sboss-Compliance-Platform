import { Suspense } from 'react';
import { Button, Dropdown, Layout, Menu, Spin, Typography } from 'antd';
import {
    BellOutlined,
    DashboardOutlined,
    LogoutOutlined,
    UnorderedListOutlined,
    UserOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../core/api/client';
import { useAuth } from '../core/auth/AuthContext';
import { NotificationBell } from '../modules/notifications/NotificationBell';
import { ModuleBoundary } from './ModuleBoundary';

export function Shell() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const me = useQuery({
        queryKey: ['me'],
        queryFn: ({ signal }) => api<{ organization: { name: string } }>('/auth/me', { signal }),
        staleTime: 5 * 60_000,
    });

    const selected = location.pathname.startsWith('/records') ? '/records' : '/';

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Layout.Sider collapsible breakpoint="lg" theme="dark">
                <div style={{ color: '#fff', fontWeight: 600, fontSize: 16, padding: '16px 20px' }}>Compliance</div>
                <Menu
                    theme="dark"
                    mode="inline"
                    selectedKeys={[selected]}
                    onClick={({ key }) => navigate(key)}
                    items={[
                        { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
                        { key: '/records', icon: <UnorderedListOutlined />, label: 'Records' },
                    ]}
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