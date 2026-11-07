import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, rethrowUnique } from '../../lib/errors';
import { recordAudit, changedFields } from '../../lib/audit';
import type { AuthUser } from '../../middleware/auth';

const DUP_MESSAGE = 'A financial year with this label already exists';

const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

export const list = (orgId: string) =>
    prisma.financialYear.findMany({ where: { orgId }, orderBy: { startDate: 'desc' } });

async function assertNoOverlap(
    tx: Prisma.TransactionClient,
    orgId: string,
    start: Date,
    end: Date,
    excludeId?: string,
) {
    const clash = await tx.financialYear.findFirst({
        where: {
            orgId,
            ...(excludeId ? { NOT: { id: excludeId } } : {}),
            startDate: { lte: end },
            endDate: { gte: start },
        },
    });
    if (clash) throw new HttpError(409, `Dates overlap with financial year ${clash.label}`);
}

export async function create(
    actor: AuthUser,
    input: { label: string; startDate: string; endDate: string; isCurrent: boolean },
) {
    try {
        return await prisma.$transaction(async (tx) => {
            const start = toDate(input.startDate);
            const end = toDate(input.endDate);
            await assertNoOverlap(tx, actor.orgId, start, end);

            if (input.isCurrent) {
                await tx.financialYear.updateMany({
                    where: { orgId: actor.orgId, isCurrent: true },
                    data: { isCurrent: false },
                });
            }

            const row = await tx.financialYear.create({
                data: {
                    orgId: actor.orgId,
                    label: input.label,
                    startDate: start,
                    endDate: end,
                    isCurrent: input.isCurrent,
                },
            });
            await recordAudit(tx, actor, 'FINANCIAL_YEAR_CREATED', 'FinancialYear', row.id, {
                label: row.label,
                startDate: input.startDate,
                endDate: input.endDate,
                isCurrent: row.isCurrent,
            });
            return row;
        });
    } catch (e) {
        rethrowUnique(e, DUP_MESSAGE);
    }
}

export async function update(
    actor: AuthUser,
    id: string,
    input: { label?: string; startDate?: string; endDate?: string; isCurrent?: boolean },
) {
    try {
        return await prisma.$transaction(async (tx) => {
            const before = await tx.financialYear.findFirst({ where: { id, orgId: actor.orgId } });
            if (!before) throw new HttpError(404, 'Financial year not found');

            const start = input.startDate ? toDate(input.startDate) : before.startDate;
            const end = input.endDate ? toDate(input.endDate) : before.endDate;
            if (end <= start) throw new HttpError(400, 'End date must be after start date');

            if (input.startDate || input.endDate) {
                await assertNoOverlap(tx, actor.orgId, start, end, id);
            }
            if (input.isCurrent) {
                await tx.financialYear.updateMany({
                    where: { orgId: actor.orgId, isCurrent: true, NOT: { id } },
                    data: { isCurrent: false },
                });
            }

            const after = await tx.financialYear.update({
                where: { id },
                data: {
                    label: input.label,
                    startDate: input.startDate ? start : undefined,
                    endDate: input.endDate ? end : undefined,
                    isCurrent: input.isCurrent,
                },
            });
            const changes = changedFields(before, after, ['label', 'startDate', 'endDate', 'isCurrent']);
            if (Object.keys(changes as object).length) {
                await recordAudit(tx, actor, 'FINANCIAL_YEAR_UPDATED', 'FinancialYear', id, changes);
            }
            return after;
        });
    } catch (e) {
        rethrowUnique(e, DUP_MESSAGE);
    }
}