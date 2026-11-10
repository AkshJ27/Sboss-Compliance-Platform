import { Alert, Button } from 'antd';

type Props = { label: string; error: boolean; onRetry: () => void };

export function LoadWarning({ label, error, onRetry }: Props) {
    if (!error) return null;
    return (
        <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${label} could not be loaded`}
            action={
                <Button size="small" onClick={onRetry}>
                    Retry
                </Button>
            }
        />
    );
}