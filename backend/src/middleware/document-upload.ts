import { RequestHandler } from 'express';
import multer from 'multer';
import { HttpError } from '../lib/errors';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10, fieldSize: 4096, parts: 12 },
});

export const documentUpload: RequestHandler = (req, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
            const tooBig = err.code === 'LIMIT_FILE_SIZE';
            next(new HttpError(tooBig ? 413 : 400, tooBig ? 'File too large (max 10 MB)' : 'Invalid upload'));
            return;
        }
        next(err);
    });
};