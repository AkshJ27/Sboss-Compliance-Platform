import bcrypt from 'bcryptjs';

const COST = 12;

// Compared against when the email doesn't exist, so response time
// doesn't reveal which emails are registered
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);

export async function verifyPassword(plain: string, hash: string | null | undefined) {
    const ok = await bcrypt.compare(plain, hash ?? DUMMY_HASH);
    return ok && !!hash;
}