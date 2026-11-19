import 'dotenv/config';
import { z } from 'zod';

const schema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        PORT: z.coerce.number().int().positive().default(4000),
        DATABASE_URL: z.string().min(1),
        JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
        CORS_ORIGIN: z
            .string()
            .default('http://localhost:5173')
            .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
        STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
        LOCAL_STORAGE_DIR: z.string().min(1).default('./storage'),
        S3_BUCKET: z.string().min(1).optional(),
        AWS_REGION: z.string().min(1).optional(),
        EMAIL_DRIVER: z.enum(['file', 'ses', 'outlook', 'off']).default('file'),
        EMAIL_FROM: z.string().min(3).optional(),
        // For EMAIL_DRIVER=outlook: the Azure app registration, and the mailbox it sends from
        AZURE_SENDER_EMAIL: z.string().trim().email().optional(),
        AZURE_TENANT_ID: z.string().min(1).optional(),
        AZURE_CLIENT_ID: z.string().min(1).optional(),
        AZURE_CLIENT_SECRET: z.string().min(1).optional(),
        OUTBOX_DIR: z.string().min(1).default('./outbox'),
        APP_URL: z.string().url().default('http://localhost:5173'),
        RUN_JOBS: z
            .enum(['true', 'false'])
            .default('true')
            .transform((v) => v === 'true'),
        DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(8),
        ALLOW_REGISTRATION: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
        // Requests allowed per internet address in 15 minutes. An office shares one address, so this is set high.
        RATE_LIMIT_PER_15_MIN: z.coerce.number().int().min(100).default(5000),
    })
    .superRefine((v, ctx) => {
        if (v.STORAGE_DRIVER === 's3') {
            if (!v.S3_BUCKET) {
                ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'Required when STORAGE_DRIVER is s3' });
            }
            if (!v.AWS_REGION) {
                ctx.addIssue({ code: 'custom', path: ['AWS_REGION'], message: 'Required when STORAGE_DRIVER is s3' });
            }
        }
        if (v.NODE_ENV === 'production' && v.STORAGE_DRIVER === 'local') {
            ctx.addIssue({
                code: 'custom',
                path: ['STORAGE_DRIVER'],
                message: 'Use s3 in production: files on local disk are lost when the server is replaced',
            });
        }
        if (v.EMAIL_DRIVER === 'ses') {
            if (!v.EMAIL_FROM) {
                ctx.addIssue({ code: 'custom', path: ['EMAIL_FROM'], message: 'Required when EMAIL_DRIVER is ses' });
            }
            if (!v.AWS_REGION) {
                ctx.addIssue({ code: 'custom', path: ['AWS_REGION'], message: 'Required when EMAIL_DRIVER is ses' });
            }
        }
        if (v.EMAIL_DRIVER === 'outlook') {
            for (const k of ['AZURE_SENDER_EMAIL', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'] as const) {
                if (!v[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'Required when EMAIL_DRIVER is outlook' });
            }
        }
        if (v.NODE_ENV === 'production' && v.EMAIL_DRIVER === 'file') {
            ctx.addIssue({
                code: 'custom',
                path: ['EMAIL_DRIVER'],
                message: 'Use outlook or ses (or off) in production: emails written to a folder are never delivered',
            });
        }
    });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
    console.error('Invalid environment variables:');
    for (const issue of parsed.error.issues) {
        console.error(` - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';