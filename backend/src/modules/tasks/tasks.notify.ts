import type { Prisma, TaskStatus } from '@prisma/client';
import { EMAIL_TYPES } from '../notifications/notify';

export type Notice = { userId: string; type: 'TASK_ASSIGNED' | 'TASK_UPDATED'; title: string; body: string };

type Base = { actorId: string; actorName: string; taskTitle: string };

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const label = (p: string) => p.charAt(0) + p.slice(1).toLowerCase();

// The person who made the change is never told about their own action
const others = (ids: string[], actorId: string) => [...new Set(ids)].filter((id) => id !== actorId);

export function planAssigned(
    i: Base & {
        assigneeId: string;
        priority: string;
        dueDate: string | null;
        previousAssigneeId?: string | null;
    },
): Notice[] {
    const title = oneLine(i.taskTitle);
    const who = oneLine(i.actorName);
    const out: Notice[] = [];

    if (i.assigneeId !== i.actorId) {
        out.push({
            userId: i.assigneeId,
            type: 'TASK_ASSIGNED',
            title: `New task: ${title}`,
            body: `${who} assigned this task to you (${label(i.priority)} priority${i.dueDate ? `, due ${i.dueDate}` : ''}).`,
        });
    }
    const prev = i.previousAssigneeId;
    if (prev && prev !== i.actorId && prev !== i.assigneeId) {
        out.push({
            userId: prev,
            type: 'TASK_UPDATED',
            title: `Task reassigned: ${title}`,
            body: `${who} reassigned this task to someone else.`,
        });
    }
    return out;
}

// Finishing, cancelling and reopening are told to the other person. Starting a task is not.
export function planStatus(
    i: Base & { creatorId: string; assigneeId: string; from: TaskStatus; to: TaskStatus; remarks?: string | null },
): Notice[] {
    let heading: string;
    let verb: string;
    if (i.to === 'DONE') {
        heading = 'Task completed';
        verb = 'marked this task as done';
    } else if (i.to === 'CANCELLED') {
        heading = 'Task cancelled';
        verb = 'cancelled this task';
    } else if (i.from === 'DONE' && i.to === 'OPEN') {
        heading = 'Task reopened';
        verb = 'reopened this task';
    } else {
        return [];
    }

    const title = oneLine(i.taskTitle);
    const note = i.remarks ? ` Note: ${oneLine(i.remarks).slice(0, 500)}` : '';
    return others([i.creatorId, i.assigneeId], i.actorId).map((userId) => ({
        userId,
        type: 'TASK_UPDATED' as const,
        title: `${heading}: ${title}`,
        body: `${oneLine(i.actorName)} ${verb}.${note}`,
    }));
}

export function planComment(i: Base & { creatorId: string; assigneeId: string; text: string }): Notice[] {
    const title = oneLine(i.taskTitle);
    const text = oneLine(i.text).slice(0, 300);
    return others([i.creatorId, i.assigneeId], i.actorId).map((userId) => ({
        userId,
        type: 'TASK_UPDATED' as const,
        title: `New comment: ${title}`,
        body: `${oneLine(i.actorName)} commented: ${text}`,
    }));
}

// Runs inside the same transaction as the change, so a change and its notices succeed or fail together
export async function sendTaskNotices(
    tx: Prisma.TransactionClient,
    orgId: string,
    taskId: string,
    notices: Notice[],
) {
    if (notices.length === 0) return;

    const users = await tx.user.findMany({
        where: { id: { in: [...new Set(notices.map((n) => n.userId))] }, orgId, isActive: true },
        select: { id: true, emailAlerts: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const data = notices.flatMap((n) => {
        const user = byId.get(n.userId);
        if (!user) return [];
        return [
            {
                orgId,
                userId: user.id,
                type: n.type,
                title: n.title,
                body: n.body,
                taskId,
                emailStatus: EMAIL_TYPES.has(n.type) && user.emailAlerts ? ('PENDING' as const) : ('NONE' as const),
            },
        ];
    });
    if (data.length) await tx.notification.createMany({ data });
}