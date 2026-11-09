import { app } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { startScheduler } from './jobs/scheduler';

const server = app.listen(env.PORT, () => {
    console.log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

const stopScheduler = env.RUN_JOBS ? startScheduler() : null;
if (!env.RUN_JOBS) console.log('[jobs] background jobs are off (RUN_JOBS=false)');

const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    stopScheduler?.();
    server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));