import { useState } from 'react';
import { Alert, Input, Modal, Typography } from 'antd';

type Props = {
    title: string;
    help?: string;
    okText: string;
    danger?: boolean;
    busy: boolean;
    onConfirm: (reason: string) => void;
    onCancel: () => void;
};

export function ReasonModal({ title, help, okText, danger, busy, onConfirm, onCancel }: Props) {
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);

    const confirm = () => {
        const reason = text.trim();
        if (reason.length < 3) {
            setError('Add a short reason (at least 3 characters)');
            return;
        }
        onConfirm(reason);
    };

    return (
        <Modal
            open
            title={title}
            okText={okText}
            okButtonProps={{ danger }}
            confirmLoading={busy}
            onOk={confirm}
            onCancel={onCancel}
            destroyOnClose
        >
            {help && <Typography.Paragraph type="secondary">{help}</Typography.Paragraph>}
            {error && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={error} />}
            <Input.TextArea
                rows={3}
                maxLength={500}
                showCount
                autoFocus
                value={text}
                onChange={(e) => {
                    setText(e.target.value);
                    setError(null);
                }}
            />
        </Modal>
    );
}