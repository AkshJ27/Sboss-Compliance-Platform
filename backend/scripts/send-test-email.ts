import 'dotenv/config';
import { randomUUID } from 'crypto';
import { env } from '../src/config/env';
import { sendEmail } from '../src/lib/email';

// Sends one test email with the current settings, so you can check them before inviting anyone.
// Usage: npm run email:test -- you@sboss.net.in
const to = process.argv[2]?.trim();
if (!to || !to.includes('@')) {
    console.error('Usage: npm run email:test -- you@example.com');
    process.exit(1);
}

(async () => {
    const from = env.EMAIL_DRIVER === 'outlook' ? env.AZURE_SENDER_EMAIL : env.EMAIL_FROM;
    console.log(`Sending with EMAIL_DRIVER=${env.EMAIL_DRIVER} from ${from ?? '(sender not set)'} to ${to} ...`);
    const result = await sendEmail({
        id: randomUUID(),
        to,
        subject: 'Test email from the Compliance Platform',
        text: `This is a test. If you can read it, emails are working.\n\nLinks in emails will open: ${env.APP_URL}\n`,
    });
    if (result === 'skipped') console.log('Not sent: EMAIL_DRIVER is off.');
    else if (env.EMAIL_DRIVER === 'file') console.log(`Not really sent: EMAIL_DRIVER is file, so it was saved in ${env.OUTBOX_DIR}`);
    else console.log('Sent. Check the inbox (and the junk folder).');
})().catch((e: unknown) => {
    console.error('Failed:', e instanceof Error ? e.message : e);
    process.exit(1);
});