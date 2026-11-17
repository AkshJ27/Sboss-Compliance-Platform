import { describe, it, expect, beforeEach } from 'vitest';
import { clearGraphToken, mailboxOf, sendViaGraph } from './email-graph';

const cfg = { tenantId: 't-1', clientId: 'c-1', clientSecret: 's-1' };
const mail = { from: 'SBOSS Compliance <Compliance@sboss.net.in>', to: 'a@x.in', subject: 'Hi', text: 'Body' };

type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function fakeFetch(replies: Response[]) {
    const calls: Call[] = [];
    const http = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const r = replies.shift();
        if (!r) throw new Error('unexpected call');
        return r;
    }) as unknown as typeof fetch;
    return { http, calls };
}

describe('Outlook email', () => {
    beforeEach(() => clearGraphToken());

    it('reads the mailbox from EMAIL_FROM', () => {
        expect(mailboxOf('SBOSS Compliance <Compliance@sboss.net.in>')).toBe('compliance@sboss.net.in');
        expect(mailboxOf(' alerts@sboss.net.in ')).toBe('alerts@sboss.net.in');
        expect(() => mailboxOf('Compliance Platform')).toThrow();
    });

    it('signs in once, then sends from the mailbox', async () => {
        const { http, calls } = fakeFetch([json(200, { access_token: 'tok', expires_in: 3600 }), new Response(null, { status: 202 }), new Response(null, { status: 202 })]);
        await sendViaGraph(cfg, mail, http, 1000);
        await sendViaGraph(cfg, { ...mail, to: 'b@x.in' }, http, 2000);
        expect(calls.map((c) => c.url)).toEqual([
            'https://login.microsoftonline.com/t-1/oauth2/v2.0/token',
            'https://graph.microsoft.com/v1.0/users/compliance%40sboss.net.in/sendMail',
            'https://graph.microsoft.com/v1.0/users/compliance%40sboss.net.in/sendMail',
        ]);
        expect(String(calls[0].init.body)).toContain('grant_type=client_credentials');
        const sent = JSON.parse(String(calls[1].init.body));
        expect(sent.message.toRecipients[0].emailAddress.address).toBe('a@x.in');
        expect(sent.message.body).toEqual({ contentType: 'Text', content: 'Body' });
        expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    });

    it('explains a missing permission', async () => {
        const { http } = fakeFetch([json(200, { access_token: 'tok' }), json(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } })]);
        await expect(sendViaGraph(cfg, mail, http, 0)).rejects.toThrow('Mail.Send');
    });

    it('explains a wrong secret', async () => {
        const { http } = fakeFetch([json(401, { error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' })]);
        await expect(sendViaGraph(cfg, mail, http, 0)).rejects.toThrow('Invalid client secret');
    });
});