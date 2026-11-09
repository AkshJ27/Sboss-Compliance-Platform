import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { sendEmail } from '../../lib/email';

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 5 * 60 * 1000;

export async function sendPendingEmails(batch = 200) {
    const retryBefore = new Date(Date.now() - RETRY_AFTER_MS);
    const due = await prisma.notification.findMany({
        where: {
            emailStatus: 'PENDING',
            emailAttempts: { lt: MAX_ATTEMPTS },
            OR: [{ emailLastAttemptAt: null }, { emailLastAttemptAt: { lt: retryBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take: batch,
        select: {
            id: true,
            title: true,
            body: true,
            emailAttempts: true,
            user: { select: { email: true, isActive: true, emailAlerts: true } },
        },
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const n of due) {
        // Whoever raises the attempt counter first owns this send, so two servers never both send it
        const claimed = await prisma.notification.updateMany({
            where: { id: n.id, emailStatus: 'PENDING', emailAttempts: n.emailAttempts },
            data: { emailAttempts: { increment: 1 }, emailLastAttemptAt: new Date() },
        });
        if (claimed.count !== 1) continue;

        if (!n.user.isActive || !n.user.emailAlerts) {
            await prisma.notification.update({ where: { id: n.id }, data: { emailStatus: 'SKIPPED' } });
            skipped++;
            continue;
        }

        try {
            const result = await sendEmail({
                id: n.id,
                to: n.user.email,
                subject: n.title,
                text:
                    `${n.body}\n\n--\nOpen the portal: ${env.APP_URL}\n` +
                    'You can turn these emails off in your notification settings.',
            });
            await prisma.notification.update({
                where: { id: n.id },
                data: result === 'sent' ? { emailStatus: 'SENT', emailedAt: new Date() } : { emailStatus: 'SKIPPED' },
            });
            if (result === 'sent') sent++;
            else skipped++;
        } catch (e) {
            console.error(`[email] sending ${n.id} failed`, e);
            await prisma.notification.update({
                where: { id: n.id },
                data: { emailStatus: n.emailAttempts + 1 >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING' },
            });
            failed++;
        }
    }
    return { sent, failed, skipped };
}