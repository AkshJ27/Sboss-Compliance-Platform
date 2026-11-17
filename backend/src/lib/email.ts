import { promises as fs } from 'fs';
import path from 'path';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { env } from '../config/env';
import { sendViaGraph } from './email-graph';

export type Email = { id: string; to: string; subject: string; text: string };

const FROM = env.EMAIL_FROM ?? 'Compliance Platform <no-reply@localhost>';

// A subject must never contain a line break
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);

let ses: SESv2Client | null = null;

// Returns 'sent', or 'skipped' when email is switched off
export async function sendEmail(mail: Email): Promise<'sent' | 'skipped'> {
    if (env.EMAIL_DRIVER === 'off') return 'skipped';
    const subject = oneLine(mail.subject);

    if (env.EMAIL_DRIVER === 'file') {
        const dir = path.resolve(env.OUTBOX_DIR);
        await fs.mkdir(dir, { recursive: true });
        const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${mail.id}.txt`;
        await fs.writeFile(
            path.join(dir, name),
            `From: ${FROM}\nTo: ${mail.to}\nSubject: ${subject}\n\n${mail.text}\n`,
            { flag: 'wx' },
        );
        return 'sent';
    }

    if (env.EMAIL_DRIVER === 'outlook') {
        await sendViaGraph(
            {
                tenantId: env.AZURE_TENANT_ID as string,
                clientId: env.AZURE_CLIENT_ID as string,
                clientSecret: env.AZURE_CLIENT_SECRET as string,
            },
            { from: env.AZURE_SENDER_EMAIL as string, to: mail.to, subject, text: mail.text },
        );
        return 'sent';
    }

    ses ??= new SESv2Client({ region: env.AWS_REGION });
    await ses.send(
        new SendEmailCommand({
            FromEmailAddress: FROM,
            Destination: { ToAddresses: [mail.to] },
            Content: {
                Simple: {
                    Subject: { Data: subject, Charset: 'UTF-8' },
                    Body: { Text: { Data: mail.text, Charset: 'UTF-8' } },
                },
            },
        }),
    );
    return 'sent';
}