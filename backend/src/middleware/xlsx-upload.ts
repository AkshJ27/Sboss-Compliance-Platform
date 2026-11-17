import { RequestHandler } from 'express';
import multer from 'multer';
import { HttpError } from '../lib/errors';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 },
    fileFilter: (_req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
            cb(new HttpError(400, 'Upload an Excel workbook (.xlsx)'));
            return;
        }
        cb(null, true);
    },
});

export const xlsxUpload: RequestHandler = (req, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
            const tooBig = err.code === 'LIMIT_FILE_SIZE';
            next(new HttpError(tooBig ? 413 : 400, tooBig ? 'File too large (max 10 MB)' : 'Invalid upload'));
            return;
        }
        next(err);
    });
};

// Several Excel files at once, in the "files" field: for exports that come one period per file
const manyUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 6, fields: 5 },
    fileFilter: (_req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
            cb(new HttpError(400, `${file.originalname} is not an Excel workbook (.xlsx)`));
            return;
        }
        cb(null, true);
    },
});

export const xlsxFilesUpload: RequestHandler = (req, res, next) => {
    manyUpload.array('files', 6)(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
            const message =
                err.code === 'LIMIT_FILE_SIZE' ? 'A file is too large (max 15 MB each)'
                    : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Upload at most 6 files'
                        : 'Invalid upload';
            next(new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, message));
            return;
        }
        next(err);
    });
};