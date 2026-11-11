import rateLimit from 'express-rate-limit';

const make = (limit: number, message: string) =>
    rateLimit({
        windowMs: 15 * 60 * 1000,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: message },
    });

export const authLimiter = make(20, 'Too many attempts, try again later'); // login and register
export const resetRequestLimiter = make(5, 'Too many requests, try again later'); // "forgot password"
export const tokenLimiter = make(30, 'Too many attempts, try again later'); // opening and using links
export const changePasswordLimiter = make(15, 'Too many attempts, try again later');