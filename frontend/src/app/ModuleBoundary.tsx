import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Alert, Button, Result } from 'antd';

type Props = {
    children: ReactNode;
    resetKey?: string; // changes when the user navigates, which clears a previous error
    compact?: boolean; // a small box instead of a full-page message
    label?: string;
    fallback?: ReactNode; // shown instead of any message
};
type State = { error: Error | null };

const isChunkError = (e: Error) =>
    /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(
        `${e.name} ${e.message}`,
    );

export class ModuleBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ui] a section failed', error, info.componentStack);
    }

    componentDidUpdate(prev: Props) {
        if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
    }

    private reset = () => this.setState({ error: null });

    render() {
        const { error } = this.state;
        const { children, compact, label, fallback } = this.props;
        if (!error) return children;
        if (fallback !== undefined) return fallback;

        // A bundle that failed to download cannot be retried in place, so reload the page
        const chunk = isChunkError(error);
        const action = chunk ? () => window.location.reload() : this.reset;
        const actionLabel = chunk ? 'Reload the page' : 'Try again';

        if (compact) {
            return (
                <Alert
                    type="error"
                    showIcon
                    message={`${label ?? 'This section'} could not be shown`}
                    description="The rest of the page still works."
                    action={
                        <Button size="small" onClick={action}>
                            {actionLabel}
                        </Button>
                    }
                />
            );
        }
        return (
            <Result
                status="error"
                title={`${label ?? 'This page'} could not be shown`}
                subTitle="The menu and the rest of the app still work. Try again, or open another page."
                extra={
                    <Button type="primary" onClick={action}>
                        {actionLabel}
                    </Button>
                }
            />
        );
    }
}