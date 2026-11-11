import { useState } from 'react';
import { Alert, Button, Form, Input, Result, Skeleton, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errorText } from '../../shared/errors';
import { api } from '../api/client';
import { AuthCard } from './AuthCard';

type Mode = 'reset' | 'invite';

const COPY = {
    reset: {
        title: 'Choose a new password',
        endpoint: '/auth/reset-password',
        done: 'Your password has been changed. Sign in with your new password.',
    },
    invite: {
        title: 'Welcome. Set your password',
        endpoint: '/auth/accept-invite',
        done: 'Your password is set. Sign in to continue.',
    },
} as const;

type Values = { password: string; confirm: string };

export default function SetPasswordPage({ mode }: { mode: Mode }) {
    const location = useLocation();
    const navigate = useNavigate();
    const copy = COPY[mode];
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // The token is after the # in the link, so it is never sent to a server or written to a log
    const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('token') ?? '';

    const check = useQuery({
        queryKey: ['auth', 'token', mode, token],
        enabled: token.length > 0,
        retry: false,
        staleTime: Infinity,
        queryFn: ({ signal }) =>
            api<{ email: string; name: string }>('/auth/check-token', {
                method: 'POST',
                body: { token, purpose: mode },
                auth: false,
                signal,
            }),
    });

    const submit = async (v: Values) => {
        setBusy(true);
        setError(null);
        try {
            await api(copy.endpoint, { method: 'POST', body: { token, password: v.password }, auth: false });
            navigate('/login', { replace: true, state: { notice: copy.done } });
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    if (!token || check.isError) {
        return (
            <AuthCard title={copy.title}>
                <Result
                    status="warning"
                    title="This link is not valid"
                    subTitle={token ? errorText(check.error) : 'The link is missing or incomplete.'}
                    extra={
                        mode === 'reset' ? (
                            <Link to="/forgot-password">
                                <Button type="primary">Get a new link</Button>
                            </Link>
                        ) : (
                            <Link to="/login">
                                <Button type="primary">Go to sign in</Button>
                            </Link>
                        )
                    }
                />
                {mode === 'invite' && (
                    <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
                        If your invitation has expired, ask your administrator to send a new one.
                    </Typography.Paragraph>
                )}
            </AuthCard>
        );
    }

    if (!check.data) {
        return (
            <AuthCard title={copy.title}>
                <Skeleton active />
            </AuthCard>
        );
    }

    return (
        <AuthCard title={copy.title}>
            <Typography.Paragraph type="secondary">
                For <b>{check.data.email}</b>. Use at least 10 characters that are hard to guess.
            </Typography.Paragraph>
            {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />}
            <Form<Values> layout="vertical" onFinish={submit} requiredMark={false}>
                <Form.Item
                    label="New password"
                    name="password"
                    rules={[
                        { required: true, message: 'Enter a password' },
                        { min: 10, message: 'At least 10 characters' },
                        { max: 72, message: 'At most 72 characters' },
                    ]}
                >
                    <Input.Password autoComplete="new-password" autoFocus />
                </Form.Item>
                <Form.Item
                    label="Confirm password"
                    name="confirm"
                    dependencies={['password']}
                    rules={[
                        { required: true, message: 'Confirm your password' },
                        ({ getFieldValue }) => ({
                            validator: (_, value?: string) =>
                                !value || getFieldValue('password') === value
                                    ? Promise.resolve()
                                    : Promise.reject(new Error('The passwords do not match')),
                        }),
                    ]}
                >
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Button type="primary" htmlType="submit" block loading={busy}>
                    Save password
                </Button>
            </Form>
        </AuthCard>
    );
}