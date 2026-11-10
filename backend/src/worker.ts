import { prisma } from './lib/prisma';
import { startScheduler } from './jobs/scheduler';

// The scheduler's timer does not keep the process alive on its own, so this does
const keepAlive = setInterval(() => undefined, 60_000);
const stopScheduler = startScheduler();
console.log('[worker] started');

const shutdown = (signal: string) => {
    console.log(`[worker] ${signal} received, shutting down`);
    stopScheduler();
    clearInterval(keepAlive);
    void prisma.$disconnect().finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));