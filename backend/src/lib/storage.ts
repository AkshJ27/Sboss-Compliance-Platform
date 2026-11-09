import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

export type Storage = {
    put(key: string, body: Buffer, contentType: string): Promise<void>;
    remove(key: string): Promise<void>;
    // S3: a direct link that expires. Local disk: null, because the API serves the file itself.
    signedUrl(key: string, fileName: string, contentType: string, ttlSeconds: number): Promise<string | null>;
    // Local disk only
    read(key: string): Readable;
};

// encodeURIComponent leaves some characters that are not allowed in a header value
const rfc5987 = (s: string) =>
    encodeURIComponent(s).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function local(): Storage {
    const root = path.resolve(env.LOCAL_STORAGE_DIR);

    const fullPath = (key: string) => {
        const p = path.resolve(root, key);
        if (!p.startsWith(root + path.sep)) throw new Error('Invalid storage key');
        return p;
    };

    return {
        async put(key, body) {
            const p = fullPath(key);
            await fs.mkdir(path.dirname(p), { recursive: true });
            await fs.writeFile(p, body, { flag: 'wx' });
        },
        async remove(key) {
            await fs.rm(fullPath(key), { force: true });
        },
        async signedUrl() {
            return null;
        },
        read(key) {
            return createReadStream(fullPath(key));
        },
    };
}

function s3(): Storage {
    const client = new S3Client({ region: env.AWS_REGION });
    const bucket = env.S3_BUCKET as string;

    return {
        async put(key, body, contentType) {
            await client.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: body,
                    ContentType: contentType,
                    ServerSideEncryption: 'AES256',
                }),
            );
        },
        async remove(key) {
            await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        },
        signedUrl(key, fileName, contentType, ttlSeconds) {
            return getSignedUrl(
                client,
                new GetObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    ResponseContentType: contentType,
                    ResponseContentDisposition: `attachment; filename*=UTF-8''${rfc5987(fileName)}`,
                }),
                { expiresIn: ttlSeconds },
            );
        },
        read() {
            throw new Error('Files are served directly from S3');
        },
    };
}

export const storage: Storage = env.STORAGE_DRIVER === 's3' ? s3() : local();