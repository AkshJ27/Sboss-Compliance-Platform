import { Prisma } from '@prisma/client';
import type { AuthUser } from '../middleware/auth';

export async function recordAudit(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    action: string,
    entityType: string,
    entityId: string,
    meta?: Prisma.InputJsonValue,
) {
    await tx.auditLog.create({
        data: { orgId: actor.orgId, userId: actor.id, action, entityType, entityId, meta },
    });
}

// Lists only the fields that actually changed, as { field: { from, to } }
export function changedFields(before: object, after: object, keys: string[]) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const k of keys) {
        const same =
            b[k] instanceof Date && a[k] instanceof Date
                ? (b[k] as Date).getTime() === (a[k] as Date).getTime()
                : b[k] === a[k];
        if (!same) changes[k] = { from: b[k], to: a[k] };
    }
    // The round trip turns dates into plain text, which the JSON column needs
    return JSON.parse(JSON.stringify(changes)) as Prisma.InputJsonValue;
}