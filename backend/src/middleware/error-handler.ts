import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
    }

    if (err instanceof ZodError) {
        res.status(400).json({
            error: 'Invalid input',
            details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        });
        return;
    }

    // Errors raised by the JSON body parser (bad JSON, body too large)
    const status = typeof err?.status === 'number' ? err.status : undefined;
    if (status && status >= 400 && status < 500) {
        res.status(status).json({ error: status === 413 ? 'Request too large' : 'Bad request' });
        return;
    }

    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
};