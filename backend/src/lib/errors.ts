import { Prisma } from '@prisma/client';

export class HttpError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'HttpError';
    }
}

// Turns a database "already exists" error into a clean 409
export function rethrowUnique(e: unknown, message: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new HttpError(409, message);
    }
    throw e;
}