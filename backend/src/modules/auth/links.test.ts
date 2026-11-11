import { describe, it, expect } from 'vitest';
import { buildLink, inviteEmail, resetEmail } from './links';

describe('buildLink', () => {
    it('puts the token after a # so it is never sent to a server', () => {
        expect(buildLink('https://app.example.com', '/reset-password', 'abc123')).toBe(
            'https://app.example.com/reset-password#token=abc123',
        );
    });

    it('ignores trailing slashes on the base address', () => {
        expect(buildLink('http://localhost:5173/', '/accept-invite', 't')).toBe('http://localhost:5173/accept-invite#token=t');
        expect(buildLink('http://localhost:5173///', '/accept-invite', 't')).toBe('http://localhost:5173/accept-invite#token=t');
    });

    it('keeps a path prefix in the base address', () => {
        expect(buildLink('https://example.com/app/', '/reset-password', 't')).toBe(
            'https://example.com/app/reset-password#token=t',
        );
    });
});

describe('emails', () => {
    it('the invitation names the inviter and company, and the subject stays on one line', () => {
        const m = inviteEmail({
            name: 'Kiran  Member',
            inviter: 'Asha Admin',
            org: 'Acme\nPvt  Ltd',
            link: 'https://x.test/accept-invite#token=t',
        });
        expect(m.subject).toBe('You have been invited to join Acme Pvt Ltd');
        expect(m.subject).not.toMatch(/[\r\n]/);
        expect(m.text).toContain('Hello Kiran,');
        expect(m.text).toContain('Asha Admin has invited you to join Acme Pvt Ltd');
        expect(m.text).toContain('https://x.test/accept-invite#token=t');
    });

    it('the reset email greets by first name and carries the link and the time limit', () => {
        const m = resetEmail({ name: 'Meera Manager', link: 'https://x.test/reset-password#token=t' });
        expect(m.subject).toBe('Reset your password');
        expect(m.text).toContain('Hello Meera,');
        expect(m.text).toContain('https://x.test/reset-password#token=t');
        expect(m.text).toContain('within 1 hour');
    });
});