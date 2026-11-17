// Sends email through Microsoft 365 (Outlook) with an Azure app registration, using Microsoft Graph.
// Microsoft is switching off password login for SMTP, so the app signs in with its own Azure credentials instead.
// Azure setup: the app needs the Microsoft Graph *application* permission Mail.Send, with admin consent.

export type GraphConfig = { tenantId: string; clientId: string; clientSecret: string };
export type GraphMail = { from: string; to: string; subject: string; text: string };
type Fetch = typeof fetch;

// "SBOSS Compliance <compliance@sboss.net.in>" or "compliance@sboss.net.in" → the mailbox address
export function mailboxOf(from: string): string {
    const m = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
    const address = (m ? m[1] : from).trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) throw new Error(`AZURE_SENDER_EMAIL is not an email address: ${from}`);
    return address.toLowerCase();
}

let cached: { key: string; token: string; expiresAt: number } | null = null;

// An app token lasts about an hour. It is reused until a minute before it runs out.
async function token(cfg: GraphConfig, http: Fetch, now: number): Promise<string> {
    const key = `${cfg.tenantId}|${cfg.clientId}`;
    if (cached && cached.key === key && cached.expiresAt > now + 60_000) return cached.token;

    const res = await http(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
        }).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !data.access_token) {
        throw new Error(`Microsoft sign-in failed (${res.status}): ${data.error_description?.split('\r\n')[0] ?? 'check the tenant ID, client ID and secret'}`);
    }
    cached = { key, token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) * 1000 };
    return data.access_token;
}

export async function sendViaGraph(cfg: GraphConfig, mail: GraphMail, http: Fetch = fetch, now = Date.now()): Promise<void> {
    const mailbox = mailboxOf(mail.from);
    const send = async (accessToken: string) =>
        http(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: {
                    subject: mail.subject,
                    body: { contentType: 'Text', content: mail.text },
                    toRecipients: [{ emailAddress: { address: mail.to } }],
                },
                saveToSentItems: false,
            }),
        });

    let res = await send(await token(cfg, http, now));
    // A token can be cancelled early. Sign in again once and retry.
    if (res.status === 401) {
        cached = null;
        res = await send(await token(cfg, http, now));
    }
    if (res.status !== 202) {
        const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
        const hint =
            res.status === 403
                ? ' The Azure app needs the Mail.Send application permission with admin consent, and must be allowed to send as this mailbox.'
                : res.status === 404
                    ? ` No mailbox ${mailbox} was found in your Microsoft 365.`
                    : '';
        throw new Error(`Outlook did not accept the email (${res.status} ${data.error?.code ?? ''}): ${data.error?.message ?? ''}${hint}`);
    }
}

// For tests
export function clearGraphToken() {
    cached = null;
}