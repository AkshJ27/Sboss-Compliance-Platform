// The token goes after the # so a browser never sends it to a server and it never lands in a log
export function buildLink(base: string, path: string, token: string): string {
    return `${base.replace(/\/+$/, '')}${path}#token=${token}`;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const firstName = (name: string) => oneLine(name).split(' ')[0] || 'there';

export function inviteEmail(p: { name: string; inviter: string; org: string; link: string }) {
    const org = oneLine(p.org);
    return {
        subject: `You have been invited to join ${org}`,
        text: [
            `Hello ${firstName(p.name)},`,
            '',
            `${oneLine(p.inviter)} has invited you to join ${org} on the compliance platform.`,
            '',
            'Set your password to get started. The link works once and expires in 3 days:',
            p.link,
            '',
            'If you were not expecting this invitation, you can ignore this email.',
        ].join('\n'),
    };
}

export function resetEmail(p: { name: string; link: string }) {
    return {
        subject: 'Reset your password',
        text: [
            `Hello ${firstName(p.name)},`,
            '',
            'We received a request to reset the password for your account.',
            'Use this link within 1 hour. It works once:',
            p.link,
            '',
            'If you did not ask for this, ignore this email. Your password will not change.',
        ].join('\n'),
    };
}