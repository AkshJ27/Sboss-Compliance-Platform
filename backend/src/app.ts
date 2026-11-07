import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { errorHandler } from './middleware/error-handler';
import { notFound } from './middleware/not-found';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // one proxy (the AWS load balancer) sits in front of the app

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '100kb' }));

app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 300,
        standardHeaders: true,
        legacyHeaders: false,
    }),
);

// For the AWS load balancer: no database call
app.get('/health', (_req, res) => {
    res.json({ ok: true });
});

// For you, while developing: checks the database connection
app.get('/health/db', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'connected' });
});

// Feature routes get mounted here from step 2 onward

app.use(notFound);
app.use(errorHandler);