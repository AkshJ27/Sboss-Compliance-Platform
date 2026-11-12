import { InstanceAction, InstanceStatus, NotificationType, Prisma } from '@prisma/client';
import { toDateOnly } from '../../lib/dates';

type Tx = Prisma.TransactionClient;
type People = { ownerId: string; managerId: string; approverId: string | null };

export type WorkflowEvent = {
    orgId: string;
    actorId: string;
    action: InstanceAction;
    toStatus: InstanceStatus;
    instanceId: string;
    code: string;
    title: string;
    dueDate: Date;
    before: People;
    after: People;
    remarks?: string | null;
};

export type Planned = { userId: string; type: NotificationType; title: string; body: string };

// Closed-item notices stay in the app. The rest are also emailed.
export const EMAIL_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
    'REVIEW_REQUESTED',
    'RETURNED',
    'ASSIGNED',
    'DAILY_DIGEST',
    'EVENT_TRIGGERED',
    'LAW_CHANGE'
]);

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

// Pure: no database. The person who acted is never notified about their own action.
export function planWorkflowNotifications(e: WorkflowEvent, actorName: string): Planned[] {
    const label = oneLine(`${e.code}: ${e.title}`);
    const due = toDateOnly(e.dueDate);
    const out: Planned[] = [];
    const add = (userId: string | null, type: NotificationType, title: string, body: string) => {
        if (userId && userId !== e.actorId) out.push({ userId, type, title, body });
    };

    switch (e.action) {
        case 'SUBMITTED':
            add(
                e.after.managerId,
                'REVIEW_REQUESTED',
                `Review requested: ${label}`,
                `${actorName} submitted this item (due ${due}). It is waiting for your review.`,
            );
            break;
        case 'MANAGER_APPROVED':
            add(
                e.after.approverId,
                'REVIEW_REQUESTED',
                `Approval requested: ${label}`,
                `${actorName} approved this item as manager (due ${due}). It is waiting for your final approval.`,
            );
            break;
        case 'APPROVED':
            add(
                e.after.ownerId,
                'CLOSED',
                `Closed: ${label}`,
                e.toStatus === 'NOT_APPLICABLE'
                    ? `${actorName} approved this item as not applicable.`
                    : `${actorName} approved this item. It is now closed.`,
            );
            break;
        case 'RETURNED': {
            const reason = e.remarks ? ` Reason: ${oneLine(e.remarks).slice(0, 500)}` : '';
            add(e.after.ownerId, 'RETURNED', `Returned: ${label}`, `${actorName} returned this item (due ${due}).${reason}`);
            break;
        }
        case 'REASSIGNED':
            if (e.after.ownerId !== e.before.ownerId) {
                add(e.after.ownerId, 'ASSIGNED', `You are now the owner: ${label}`, `${actorName} assigned this item to you as owner (due ${due}).`);
            }
            if (e.after.managerId !== e.before.managerId) {
                add(e.after.managerId, 'ASSIGNED', `You are now the manager: ${label}`, `${actorName} assigned this item to you as manager (due ${due}).`);
            }
            if (e.after.approverId !== e.before.approverId) {
                add(e.after.approverId, 'ASSIGNED', `You are now the approver: ${label}`, `${actorName} assigned this item to you as approver (due ${due}).`);
            }
            break;
        default: // DRAFT_SAVED tells nobody anything
            break;
    }
    return out;
}

// Runs inside the workflow transaction, so an action and its notifications succeed or fail together
export async function notifyWorkflow(tx: Tx, e: WorkflowEvent) {
    if (planWorkflowNotifications(e, '').length === 0) return;

    const actor = await tx.user.findFirst({
        where: { id: e.actorId, orgId: e.orgId },
        select: { name: true },
    });
    const planned = planWorkflowNotifications(e, actor?.name ?? 'A colleague');

    const users = await tx.user.findMany({
        where: { id: { in: [...new Set(planned.map((p) => p.userId))] }, orgId: e.orgId, isActive: true },
        select: { id: true, emailAlerts: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const data = planned.flatMap((p) => {
        const user = byId.get(p.userId);
        if (!user) return [];
        return [
            {
                orgId: e.orgId,
                userId: p.userId,
                type: p.type,
                title: p.title,
                body: p.body,
                instanceId: e.instanceId,
                emailStatus: EMAIL_TYPES.has(p.type) && user.emailAlerts ? ('PENDING' as const) : ('NONE' as const),
            },
        ];
    });
    if (data.length) await tx.notification.createMany({ data });
}