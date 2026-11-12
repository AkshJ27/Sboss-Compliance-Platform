import { Suspense, useState } from 'react';
import { Badge, Button, Dropdown, Layout, Menu, Modal, Spin, Typography } from 'antd';
import { useLawSummary } from '../modules/admin/lawchanges/api';
import type { MenuProps } from 'antd';
import {
    AuditOutlined,
    BellOutlined,
    FileSearchOutlined,
    ToolOutlined,
    BookOutlined,
    CalendarOutlined,
    DashboardOutlined,
    DatabaseOutlined,
    ThunderboltOutlined,
    FileTextOutlined,
    KeyOutlined,
    LogoutOutlined,
    PoweroffOutlined,
    SettingOutlined,
    TeamOutlined,
    UnorderedListOutlined,
    UserOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../core/api/client';
import { useAuth } from '../core/auth/AuthContext';
import { ChangePasswordModal } from '../core/auth/ChangePasswordModal';
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
    const law = useLawSummary(admin);
    const needDecision = law.data?.needDecision ?? 0;
    const [modal, modalHolder] = Modal.useModal();
    const [changingPassword, setChangingPassword] = useState(false);

    const signOutEverywhere = () =>
        modal.confirm({
            title: 'Sign out on every device?',
            content: 'Everyone using your account is signed out, including you here.',
            okText: 'Sign out everywhere',
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await api('/auth/logout-all', { method: 'POST' });
                } catch {
                    // Sign out here anyway
                }
                await logout();
            },
        });

    const items: MenuProps['items'] = [
        { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
        { key: '/records', icon: <UnorderedListOutlined />, label: 'Records' },
        { key: '/documents', icon: <FileTextOutlined />, label: 'Documents' },
        ...(admin
            ? [
                {
                    key: 'admin',
                    icon: <SettingOutlined />,
                    label: (
                        <span>
                            Setup <Badge count={needDecision} size="small" />
                        </span>
                    ),
                    children: [
                        { key: '/admin/masters', icon: <DatabaseOutlined />, label: 'Masters' },
                        { key: '/admin/users', icon: <TeamOutlined />, label: 'Users' },
                        { key: '/admin/bulk', icon: <ToolOutlined />, label: 'Bulk tools' },
                        { key: '/admin/events', icon: <ThunderboltOutlined />, label: 'Events' },
                        {
                            key: '/admin/law-changes',
                            icon: <FileSearchOutlined />,
                            label: (
                                <span>
                                    Law changes <Badge count={needDecision} size="small" />
                                </span>
                            ),
                        },
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
            {modalHolder}
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
                                    key: 'password',
                                    icon: <KeyOutlined />,
                                    label: 'Change password',
                                    onClick: () => setChangingPassword(true),
                                },
                                {
                                    key: 'everywhere',
                                    icon: <PoweroffOutlined />,
                                    label: 'Sign out on all devices',
                                    onClick: signOutEverywhere,
                                },
                                { type: 'divider' },
                                { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out', onClick: () => void logout() },
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

            <ChangePasswordModal open={changingPassword} onClose={() => setChangingPassword(false)} />
        </Layout>
    );
}