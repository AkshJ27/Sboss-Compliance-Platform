import { Prisma } from '@prisma/client';
import { parseDateOnly, todayInIndia } from '../../lib/dates';

// How many valid proof documents are attached to an item.
// The first statement locks the item's row, so no document can be added or removed
// while a submission is being checked, and the count is read after the lock is taken.
export async function countProof(
    tx: Prisma.TransactionClient,
    orgId: string,
    instanceId: string,
): Promise<number> {
    await tx.complianceInstance.updateMany({
        where: { id: instanceId, orgId, status: { in: ['DUE', 'RETURNED'] } },
        data: { updatedAt: new Date() },
    });

    const today = parseDateOnly(todayInIndia());
    return tx.document.count({
        where: {
            orgId,
            instanceId,
            deletedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gte: today } }],
        },
    });
}