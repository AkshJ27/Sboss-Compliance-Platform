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