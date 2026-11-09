import { Prisma } from '@prisma/client';

// Step 7 replaces this with a real count of the documents attached to the item.
// Until then it returns 0, so an item that needs proof cannot be submitted as
// Applicable. That is the safe way to fail.
export async function countProof(
    _tx: Prisma.TransactionClient,
    _orgId: string,
    _instanceId: string,
): Promise<number> {
    return 0;
}