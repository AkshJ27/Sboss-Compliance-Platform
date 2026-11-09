import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { todayInIndia } from '../../lib/dates';
import { getUser } from '../../middleware/auth';
import { requirePlatformAdmin } from '../../middleware/platform-admin';
import { runDigest } from './digest.job';
import { sendPendingEmails } from './email.queue';
import * as s from './notifications.schema';
import * as svc from './notifications.service';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
    res.json(await svc.list(getUser(req), s.listQuerySchema.parse(req.query)));
});

notificationsRouter.get('/unread-count', async (req, res) => {
    res.json(await svc.unreadCount(getUser(req)));
});

notificationsRouter.post('/read', async (req, res) => {
    const { ids } = s.idsSchema.parse(req.body);
    res.json(await svc.setRead(getUser(req), ids, true));
});

notificationsRouter.post('/unread', async (req, res) => {
    const { ids } = s.idsSchema.parse(req.body);
    res.json(await svc.setRead(getUser(req), ids, false));
});

notificationsRouter.post('/read-all', async (req, res) => {
    res.json(await svc.readAll(getUser(req)));
});

notificationsRouter.get('/preferences', async (req, res) => {
    res.json(await svc.getPreferences(getUser(req)));
});

notificationsRouter.patch('/preferences', async (req, res) => {
    const { emailAlerts } = s.preferencesSchema.parse(req.body);
    res.json(await svc.setPreferences(getUser(req), emailAlerts));
});

// Platform admin only. These work across every company, because the digest does.
notificationsRouter.post('/admin/digest', requirePlatformAdmin, async (req, res) => {
    const q = s.digestRunQuerySchema.parse(req.query);
    if (!q.dryRun && q.asOf) throw new HttpError(400, 'asOf can only be used with dryRun=true');

    const result = await runDigest(q.asOf ?? todayInIndia(), {
        dryRun: q.dryRun,
        sampleUserId: q.sampleUserId,
    });
    const emails = q.dryRun ? null : await sendPendingEmails();
    res.json({ dryRun: q.dryRun, ...result, emails });
});

notificationsRouter.post('/admin/send-emails', requirePlatformAdmin, async (_req, res) => {
    res.json(await sendPendingEmails());
});