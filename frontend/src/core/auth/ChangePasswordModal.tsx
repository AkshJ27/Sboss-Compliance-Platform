import { useState } from 'react';
import { Alert, Button, Form, Input, Modal } from 'antd';
import { errorText } from '../../shared/errors';
import { api, setAccessToken } from '../api/client';

type Values = { currentPassword: string; newPassword: string; confirm: string };

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [form] = Form.useForm<Values>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const close = () => {
        setError(null);
        setDone(false);
        onClose();
    };

    const submit = async (v: Values) => {
        setBusy(true);
        setError(null);
        try {
            const res = await api<{ accessToken: string }>('/auth/change-password', {
                method: 'POST',
                body: { currentPassword: v.currentPassword, newPassword: v.newPassword },
            });
            setAccessToken(res.accessToken); // this device stays signed in
            setDone(true);
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={open}
            title="Change password"
            okText="Change password"
            confirmLoading={busy}
            onOk={() => form.submit()}
            onCancel={close}
            footer={
                done
                    ? [
                        <Button key="close" type="primary" onClick={close}>
                            Close
                        </Button>,
                    ]
                    : undefined
            }
            destroyOnClose
        >
            {done ? (
                <Alert
                    type="success"
                    showIcon
                    message="Your password was changed"
                    description="Your other devices will be signed out within 15 minutes."
                />
            ) : (
                <>
                    {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />}
                    <Form<Values> form={form} layout="vertical" onFinish={submit} requiredMark={false}>
                        <Form.Item
                            label="Current password"
                            name="currentPassword"
                            rules={[{ required: true, message: 'Enter your current password' }]}
                        >
                            <Input.Password autoComplete="current-password" autoFocus />
                        </Form.Item>
                        <Form.Item
                            label="New password"
                            name="newPassword"
                            rules={[
                                { required: true, message: 'Enter a new password' },
                                { min: 10, message: 'At least 10 characters' },
                                { max: 72, message: 'At most 72 characters' },
                            ]}
                        >
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Form.Item
                            label="Confirm new password"
                            name="confirm"
                            dependencies={['newPassword']}
                            rules={[
                                { required: true, message: 'Confirm the new password' },
                                ({ getFieldValue }) => ({
                                    validator: (_, value?: string) =>
                                        !value || getFieldValue('newPassword') === value
                                            ? Promise.resolve()
                                            : Promise.reject(new Error('The passwords do not match')),
                                }),
                            ]}
                        >
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                    </Form>
                </>
            )}
        </Modal>
    );
}