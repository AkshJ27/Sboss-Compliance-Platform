import { InstanceAction, InstanceStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { parseDateOnly, todayInIndia } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import { getInstance, visibleTo } from './instances.service';
import { assertAssignees } from './schedules.service';
import { countProof } from './proof';
import type { AssigneesInput, DraftInput, SubmitInput } from './workflow.schema';
import { notifyWorkflow } from '../notifications/notify';

type Tx = Prisma.TransactionClient;
type Update = Prisma.ComplianceInstanceUncheckedUpdateManyInput;

const statusText = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const blank = (s: string | undefined) => (s ? s : null);

async function load(tx: Tx, actor: AuthUser, id: string) {
    const inst = await tx.complianceInstance.findFirst({
        where: { id, orgId: actor.orgId },
        include: { compliance: { select: { attachment: true, code: true, title: true } } },
    });
    if (!inst) throw new HttpError(404, 'Compliance item not found');

    // A member who has no part in this item can't even tell it exists
    const involved =
        actor.id === inst.ownerId || actor.id === inst.managerId || actor.id === inst.approverId;
    if (!involved && actor.role === 'MEMBER') throw new HttpError(404, 'Compliance item not found');
    return inst;
}
type Loaded = Awaited<ReturnType<typeof load>>;

// Moves or edits an item, but only if nobody changed it since it was read
async function change(
    tx: Tx,
    actor: AuthUser,
    inst: Loaded,
    action: InstanceAction,
    toStatus: InstanceStatus | null,
    data: Update,
    event: { remarks?: string | null; data?: Prisma.InputJsonValue },
) {
    const r = await tx.complianceInstance.updateMany({
        where: { id: inst.id, orgId: actor.orgId, status: inst.status },
        data: { ...data, ...(toStatus ? { status: toStatus } : {}) },
    });
    if (r.count !== 1) {
        throw new HttpError(409, 'This item was just changed by someone else. Refresh and try again.');
    }

    const to = toStatus ?? inst.status;
    await tx.instanceEvent.create({
        data: {
            orgId: actor.orgId,
            instanceId: inst.id,
            actorId: actor.id,
            action,
            fromStatus: inst.status,
            toStatus: to,
            remarks: event.remarks ?? null,
            data: event.data,
        },
    });
    await recordAudit(tx, actor, `INSTANCE_${action}`, 'ComplianceInstance', inst.id, {
        from: inst.status,
        to,
        ...(event.remarks ? { remarks: event.remarks } : {}),
    });

    await notifyWorkflow(tx, {
        orgId: actor.orgId,
        actorId: actor.id,
        action,
        toStatus: to,
        instanceId: inst.id,
        code: inst.compliance.code,
        title: inst.compliance.title,
        dueDate: inst.dueDate,
        before: { ownerId: inst.ownerId, managerId: inst.managerId, approverId: inst.approverId },
        after: {
            ownerId: typeof data.ownerId === 'string' ? data.ownerId : inst.ownerId,
            managerId: typeof data.managerId === 'string' ? data.managerId : inst.managerId,
            approverId: data.approverId === undefined ? inst.approverId : (data.approverId as string | null),
        },
        remarks: event.remarks,
    });
}

function checkDoneDate(doneDate: string, periodStart: Date) {
    if (doneDate > todayInIndia()) throw new HttpError(400, 'Done date cannot be in the future');
    if (parseDateOnly(doneDate).getTime() < periodStart.getTime()) {
        throw new HttpError(400, 'Done date cannot be before the period starts');
    }
}

function assertOwnerCanEdit(inst: Loaded, actor: AuthUser, verb: string) {
    if (inst.ownerId !== actor.id) {
        throw new HttpError(403, `Only the assigned owner can ${verb} this item`);
    }
    if (inst.status !== 'DUE' && inst.status !== 'RETURNED') {
        throw new HttpError(409, `This item cannot be changed while it is ${statusText(inst.status)}`);
    }
}

export async function saveDraft(actor: AuthUser, id: string, input: DraftInput) {
    await prisma.$transaction(async (tx) => {
        const inst = await load(tx, actor, id);
        assertOwnerCanEdit(inst, actor, 'edit');
        if (input.doneDate) checkDoneDate(input.doneDate, inst.periodStart);

        const data: Update = { isWip: true };
        if (input.submissionType !== undefined) data.submissionType = input.submissionType;
        if (input.doneDate !== undefined) data.doneDate = parseDateOnly(input.doneDate);
        if (input.refNo !== undefined) data.refNo = blank(input.refNo);
        if (input.challanNo !== undefined) data.challanNo = blank(input.challanNo);
        if (input.actualImprisonment !== undefined) data.actualImprisonment = input.actualImprisonment;
        if (input.penaltyPaid !== undefined) data.penaltyPaid = input.penaltyPaid;
        if (input.payableAmount !== undefined) data.payableAmount = input.payableAmount;
        if (input.amountPaid !== undefined) data.amountPaid = input.amountPaid;
        if (input.remarks !== undefined) data.remarks = blank(input.remarks);

        await change(tx, actor, inst, 'DRAFT_SAVED', null, data, {
            data: { fields: Object.keys(input) },
        });
    });
    return getInstance(actor, id);
}

export async function submit(actor: AuthUser, id: string, input: SubmitInput) {
    await prisma.$transaction(async (tx) => {
        const inst = await load(tx, actor, id);
        assertOwnerCanEdit(inst, actor, 'submit');
        checkDoneDate(input.doneDate, inst.periodStart);

        const notApplicable = input.submissionType === 'NOT_APPLICABLE';
        if (notApplicable && !input.remarks) {
            throw new HttpError(400, 'Explain why this is not applicable, in the remarks');
        }
        if (
            !notApplicable &&
            inst.compliance.attachment === 'MANDATORY' &&
            (await countProof(tx, actor.orgId, inst.id)) === 0
        ) {
            throw new HttpError(400, 'A proof document must be attached before submitting this item');
        }

        const payment = notApplicable
            ? {
                refNo: null,
                challanNo: null,
                actualImprisonment: false,
                penaltyPaid: null,
                payableAmount: null,
                amountPaid: null,
            }
            : {
                refNo: blank(input.refNo),
                challanNo: blank(input.challanNo),
                actualImprisonment: input.actualImprisonment ?? false,
                penaltyPaid: input.penaltyPaid ?? 0,
                payableAmount: input.payableAmount ?? 0,
                amountPaid: input.amountPaid ?? 0,
            };

        await change(
            tx,
            actor,
            inst,
            'SUBMITTED',
            'SUBMITTED',
            {
                submissionType: input.submissionType,
                doneDate: parseDateOnly(input.doneDate),
                ...payment,
                remarks: blank(input.remarks),
                returnRemarks: null,
                isWip: false,
                submittedAt: new Date(),
                submittedById: actor.id,
                managerActionAt: null,
                managerActionById: null,
                closedAt: null,
                closedById: null,
            },
            {
                remarks: input.remarks,
                data: { submissionType: input.submissionType, doneDate: input.doneDate, ...payment },
            },
        );
    });
    return getInstance(actor, id);
}

// Works out which review step this is and whether the actor may do it
function reviewStage(inst: Loaded, actor: AuthUser): 'MANAGER' | 'APPROVER' {
    if (inst.status === 'SUBMITTED') {
        if (actor.id !== inst.managerId) {
            throw new HttpError(403, 'Only the assigned manager can review this item');
        }
        if (actor.id === inst.submittedById) {
            throw new HttpError(403, 'You cannot review an item you submitted');
        }
        return 'MANAGER';
    }
    if (inst.status === 'MANAGER_APPROVED') {
        if (actor.id !== inst.approverId) {
            throw new HttpError(403, 'Only the assigned approver can review this item');
        }
        if (actor.id === inst.submittedById || actor.id === inst.managerActionById) {
            throw new HttpError(403, 'You cannot review an item you already handled');
        }
        return 'APPROVER';
    }
    throw new HttpError(409, `Nothing to review: the item is ${statusText(inst.status)}`);
}

export async function approve(actor: AuthUser, id: string, remarks?: string) {
    await prisma.$transaction(async (tx) => {
        const inst = await load(tx, actor, id);
        const stage = reviewStage(inst, actor);

        // High-risk items continue to the approver after the manager
        if (stage === 'MANAGER' && inst.requiresApprover) {
            if (!inst.approverId) {
                throw new HttpError(409, 'This high-risk item needs an approver. Ask an admin to assign one.');
            }
            await change(
                tx,
                actor,
                inst,
                'MANAGER_APPROVED',
                'MANAGER_APPROVED',
                { managerActionAt: new Date(), managerActionById: actor.id },
                { remarks },
            );
            return;
        }

        const final: InstanceStatus =
            inst.submissionType === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'CLOSED';
        await change(
            tx,
            actor,
            inst,
            'APPROVED',
            final,
            {
                closedAt: new Date(),
                closedById: actor.id,
                ...(stage === 'MANAGER' ? { managerActionAt: new Date(), managerActionById: actor.id } : {}),
            },
            { remarks },
        );
    });
    return getInstance(actor, id);
}

export async function returnItem(actor: AuthUser, id: string, remarks: string) {
    await prisma.$transaction(async (tx) => {
        const inst = await load(tx, actor, id);
        reviewStage(inst, actor);
        await change(
            tx,
            actor,
            inst,
            'RETURNED',
            'RETURNED',
            { returnRemarks: remarks, managerActionAt: null, managerActionById: null },
            { remarks },
        );
    });
    return getInstance(actor, id);
}

const REASSIGNABLE: InstanceStatus[] = ['DUE', 'RETURNED', 'SUBMITTED', 'MANAGER_APPROVED'];

export async function reassign(actor: AuthUser, id: string, input: AssigneesInput) {
    await prisma.$transaction(async (tx) => {
        const inst = await load(tx, actor, id);
        if (!REASSIGNABLE.includes(inst.status)) {
            throw new HttpError(409, 'A finished item cannot be reassigned');
        }

        const ownerId = input.ownerId ?? inst.ownerId;
        const managerId = input.managerId ?? inst.managerId;
        const approverId = input.approverId === undefined ? inst.approverId : input.approverId;

        if (ownerId === managerId) throw new HttpError(400, 'Owner and manager must be different people');
        if (approverId && (approverId === ownerId || approverId === managerId)) {
            throw new HttpError(400, 'The approver must be a different person from the owner and manager');
        }
        if (inst.requiresApprover && !approverId) {
            throw new HttpError(400, 'A high-risk item needs an approver');
        }
        await assertAssignees(tx, actor.orgId, [input.ownerId, input.managerId, input.approverId]);

        // Someone who already handled the item can't end up reviewing it
        if (inst.status === 'SUBMITTED' || inst.status === 'MANAGER_APPROVED') {
            if (managerId === inst.submittedById) {
                throw new HttpError(400, 'The manager cannot be the person who submitted this item');
            }
            if (approverId && (approverId === inst.submittedById || approverId === inst.managerActionById)) {
                throw new HttpError(400, 'The approver cannot be someone who already handled this item');
            }
        }

        await change(
            tx,
            actor,
            inst,
            'REASSIGNED',
            null,
            { ownerId, managerId, approverId },
            {
                remarks: input.remarks,
                data: {
                    from: { ownerId: inst.ownerId, managerId: inst.managerId, approverId: inst.approverId },
                    to: { ownerId, managerId, approverId },
                },
            },
        );
    });
    return getInstance(actor, id);
}

export async function history(actor: AuthUser, id: string) {
    const visible = await prisma.complianceInstance.findFirst({
        where: { id, orgId: actor.orgId, ...visibleTo(actor) },
        select: { id: true },
    });
    if (!visible) throw new HttpError(404, 'Compliance item not found');

    return prisma.instanceEvent.findMany({
        where: { orgId: actor.orgId, instanceId: id },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
}