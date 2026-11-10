import { Button, Result, Spin } from 'antd';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireAuth() {
    const { status, retry } = useAuth();
    const location = useLocation();

    if (status === 'loading') {
        return (
            <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
                <Spin size="large" />
            </div>
        );
    }
    if (status === 'unavailable') {
        return (
            <Result
                status="warning"
                title="Cannot reach the server"
                subTitle="Check your connection, or try again in a moment."
                extra={
                    <Button type="primary" onClick={retry}>
                        Try again
                    </Button>
                }
            />
        );
    }
    if (status === 'anonymous') {
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }
    return <Outlet />;
}