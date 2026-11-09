import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { todayInIndia } from '../lib/dates';
import { purgeOld, runDigest } from '../modules/notifications/digest.job';
import { sendPendingEmails } from '../modules/notifications/email.queue';

const TICK_MS = 60_000;
const RETRY_AFTER_MS = 30 * 60 * 1000;

// Only one server wins the right to run a job for a given day.
// A run that crashed or failed can be taken over after 30 minutes.
async function claim(name: string, runKey: string): Promise<boolean> {
    try {
        await prisma.jobRun.create({ data: { name, runKey, status: 'RUNNING' } });
        return true;
    } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        const takeover = await prisma.jobRun.updateMany({
            where: {
                name,
                runKey,
                status: { in: ['RUNNING', 'FAILED'] },
                startedAt: { lt: new Date(Date.now() - RETRY_AFTER_MS) },
            },
            data: { status: 'RUNNING', startedAt: new Date(), error: null },
        });
        return takeover.count === 1;
    }
}

async function runOnce(name: string, runKey: string, work: () => Promise<Prisma.InputJsonValue>) {
    if (!(await claim(name, runKey))) return;
    try {
        const summary = await work();
        await prisma.jobRun.update({
            where: { name_runKey: { name, runKey } },
            data: { status: 'SUCCEEDED', finishedAt: new Date(), summary },
        });
        console.log(`[jobs] ${name} ${runKey} done`, summary);
    } catch (e) {
        console.error(`[jobs] ${name} ${runKey} failed`, e);
        await prisma.jobRun.update({
            where: { name_runKey: { name, runKey } },
            data: { status: 'FAILED', finishedAt: new Date(), error: String((e as Error).message).slice(0, 500) },
        });
    }
}

async function tick() {
    const today = todayInIndia();
    const hourInIndia = new Date(Date.now() + 330 * 60_000).getUTCHours();

    // From the digest hour onwards, so a server that was down at 8am still runs it when it comes back
    if (hourInIndia >= env.DIGEST_HOUR) {
        await runOnce('daily-digest', today, async () => {
            const r = await runDigest(today, { dryRun: false });
            const purged = await purgeOld();
            return { digests: r.totalDigests, created: r.created, ...purged };
        });
    }
    await sendPendingEmails();
}

export function startScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            await tick();
        } catch (e) {
            console.error('[jobs] tick failed', e);
        } finally {
            running = false;
        }
    };

    const timer = setInterval(run, TICK_MS);
    timer.unref();
    void run();
    console.log(`[jobs] scheduler started (daily digest from ${env.DIGEST_HOUR}:00 India time)`);
    return () => clearInterval(timer);
}