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


// Document Data Upload: the Excel sheet in "details" and the zip of files in "zip"
export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_SHEET_BYTES = 10 * 1024 * 1024;

const dataUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ZIP_BYTES, files: 2, fields: 5, fieldSize: 1024, parts: 7 },
    fileFilter: (_req, file, cb) => {
        const name = file.originalname.toLowerCase();
        if (file.fieldname === 'details' && !name.endsWith('.xlsx')) {
            cb(new HttpError(400, 'The document details must be an Excel workbook (.xlsx)'));
            return;
        }
        if (file.fieldname === 'zip' && !name.endsWith('.zip')) {
            cb(new HttpError(400, 'The documents must be in a .zip file'));
            return;
        }
        cb(null, true);
    },
});

export const documentDataUpload: RequestHandler = (req, res, next) => {
    dataUpload.fields([
        { name: 'details', maxCount: 1 },
        { name: 'zip', maxCount: 1 },
    ])(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
            const tooBig = err.code === 'LIMIT_FILE_SIZE';
            next(new HttpError(tooBig ? 413 : 400, tooBig ? 'The zip is too large (max 100 MB). Split it into smaller uploads.' : 'Invalid upload'));
            return;
        }
        if (err) {
            next(err);
            return;
        }
        const files = req.files as Record<string, { size: number }[]> | undefined;
        if ((files?.details?.[0]?.size ?? 0) > MAX_SHEET_BYTES) {
            next(new HttpError(413, 'The Excel file is too large (max 10 MB)'));
            return;
        }
        next();
    });
};