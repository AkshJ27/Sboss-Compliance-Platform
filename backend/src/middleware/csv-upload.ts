import { RequestHandler } from 'express';
import multer from 'multer';
import { HttpError } from '../lib/errors';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
    fileFilter: (_req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.csv')) {
            cb(new HttpError(400, 'Upload a .csv file'));
            return;
        }
        cb(null, true);
    },
});

export const csvUpload: RequestHandler = (req, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
            const tooBig = err.code === 'LIMIT_FILE_SIZE';
            next(new HttpError(tooBig ? 413 : 400, tooBig ? 'File too large (max 5 MB)' : 'Invalid upload'));
            return;
        }
        next(err);
    });
};