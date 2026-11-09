import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
    console.error('Usage: npm run make-admin -- user@example.com');
    process.exit(1);
}

const prisma = new PrismaClient();

(async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        console.error(`No user with email ${email}`);
        process.exit(1);
    }
    await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
    console.log(`${email} is now a platform admin`);
})()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());