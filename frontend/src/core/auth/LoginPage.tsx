import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../../core/api/client';
import { useAuth } from '../../core/auth/AuthContext';

export default function LoginPage() {
    const { status, login } = useAuth();
    const location = useLocation();
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const from = (location.state as { from?: string } | null)?.from;
    const target = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
    const notice = (location.state as { notice?: string } | null)?.notice;

    if (status === 'authenticated') return <Navigate to={target} replace />;

    const submit = async (v: { email: string; password: string }) => {
        setBusy(true);
        setError(null);
        try {
            await login(v.email.trim(), v.password);
        } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#f5f7fa', padding: 16 }}>
            <Card style={{ width: 380 }}>
                <Typography.Title level={3} style={{ marginTop: 0 }}>
                    Compliance Platform
                </Typography.Title>
                <Typography.Paragraph type="secondary">Sign in to continue.</Typography.Paragraph>

                {typeof notice === 'string' && <Alert type="success" showIcon style={{ marginBottom: 16 }} message={notice} />}
                {status === 'unavailable' && (
                    <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="Cannot reach the server right now"
                    />
                )}
                {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />}

                <Form layout="vertical" onFinish={submit} requiredMark={false}>
                    <Form.Item
                        label="Email"
                        name="email"
                        rules={[{ required: true, type: 'email', message: 'Enter your email' }]}
                    >
                        <Input autoComplete="username" autoFocus />
                    </Form.Item>
                    <Form.Item label="Password" name="password" rules={[{ required: true, message: 'Enter your password' }]}>
                        <Input.Password autoComplete="current-password" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block loading={busy}>
                        Sign in
                    </Button>
                </Form>
                <div style={{ textAlign: 'center', marginTop: 12 }}>
                    <Link to="/forgot-password">Forgot your password?</Link>
                </div>
            </Card>
        </div>
    );
}