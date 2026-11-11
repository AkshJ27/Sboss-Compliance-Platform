import type { ReactNode } from 'react';
import { Card, Typography } from 'antd';

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#f5f7fa', padding: 16 }}>
            <Card style={{ width: 420, maxWidth: '100%' }}>
                <Typography.Title level={3} style={{ marginTop: 0 }}>
                    {title}
                </Typography.Title>
                {children}
            </Card>
        </div>
    );
}