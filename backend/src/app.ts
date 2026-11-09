import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';
import { notFound } from './middleware/not-found';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { mastersRouter } from './modules/masters/masters.routes';
import { libraryRouter } from './modules/library/library.routes';
import { complianceRouter } from './modules/compliance/compliance.routes';
import { documentsRouter, documentFilesRouter } from './modules/documents/documents.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { reportsRouter } from './modules/reports/reports.routes';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 300,
        standardHeaders: true,
        legacyHeaders: false,
    }),
);

app.get('/health', (_req, res) => {
    res.json({ ok: true });
});

app.get('/health/db', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'connected' });
});

app.use('/api/auth', authRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/masters', requireAuth, mastersRouter);
app.use('/api/library', requireAuth, libraryRouter);
app.use('/api/compliance', requireAuth, complianceRouter);
app.use('/api/documents/files', documentFilesRouter);
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/notifications', requireAuth, notificationsRouter);
app.use('/api/audit', requireAuth, auditRouter);
app.use('/api/reports', requireAuth, reportsRouter);

app.use(notFound);
app.use(errorHandler);