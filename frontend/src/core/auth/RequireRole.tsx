import { Result } from 'antd';
import { Outlet } from 'react-router-dom';
import type { Role } from '../api/client';
import { useAuth } from './AuthContext';

export function RequireRole({ roles }: { roles: Role[] }) {
    const { user } = useAuth();
    if (!user || !roles.includes(user.role)) {
        return <Result status="403" title="Not allowed" subTitle="You do not have access to this page." />;
    }
    return <Outlet />;
}