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


// Several files at once, in the "files" field (the Documents menu)
export const MAX_FILES_PER_UPLOAD = 10;

const multiUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_UPLOAD, fields: 5, fieldSize: 1024, parts: MAX_FILES_PER_UPLOAD + 5 },
});

export const documentFilesUpload: RequestHandler = (req, res, next) => {
    multiUpload.array('files', MAX_FILES_PER_UPLOAD)(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
            const message =
                err.code === 'LIMIT_FILE_SIZE'
                    ? 'A file is too large (max 10 MB each)'
                    : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
                        ? `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time`
                        : 'Invalid upload';
            next(new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, message));
            return;
        }
        next(err);
    });
};