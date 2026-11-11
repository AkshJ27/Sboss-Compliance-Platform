import { useState } from 'react';
import { Alert, Button, Form, Input, Space, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { errorText } from '../../shared/errors';
import { api } from '../api/client';
import { AuthCard } from './AuthCard';

export default function ForgotPasswordPage() {
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (v: { email: string }) => {
        setBusy(true);
        setError(null);
        try {
            await api('/auth/forgot-password', { method: 'POST', body: { email: v.email.trim() }, auth: false });
            setSent(true);
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <AuthCard title="Forgot your password?">
            {sent ? (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Alert
                        type="success"
                        showIcon
                        message="Check your email"
                        description="If an account exists for that email, we have sent a link to choose a new password. It works once and expires in 1 hour."
                    />
                    <Link to="/login">Back to sign in</Link>
                </Space>
            ) : (
                <>
                    <Typography.Paragraph type="secondary">
                        Enter your email and we will send you a link to choose a new password.
                    </Typography.Paragraph>
                    {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />}
                    <Form layout="vertical" onFinish={submit} requiredMark={false}>
                        <Form.Item
                            label="Email"
                            name="email"
                            rules={[{ required: true, type: 'email', message: 'Enter your email' }]}
                        >
                            <Input autoComplete="username" autoFocus />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" block loading={busy}>
                            Send the link
                        </Button>
                    </Form>
                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                        <Link to="/login">Back to sign in</Link>
                    </div>
                </>
            )}
        </AuthCard>
    );
}