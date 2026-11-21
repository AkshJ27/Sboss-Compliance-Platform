import type { ReactNode } from 'react';
import { Card, Typography } from 'antd';
import { BRAND } from '../../theme';

// Sign-in, password and invite pages: the SBOSS logo on a card over the brand gradient
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: BRAND.gradient, padding: 16 }}>
            <Card style={{ width: 420, maxWidth: '100%', boxShadow: '0 12px 40px rgba(46, 47, 105, 0.35)' }}>
                <img src="/sboss-logo.png" alt="SBI Operations Support" style={{ width: 240, maxWidth: '100%', display: 'block', margin: '4px auto 20px' }} />
                <Typography.Title level={3} style={{ marginTop: 0 }}>
                    {title}
                </Typography.Title>
                {children}
            </Card>
        </div>
    );
}