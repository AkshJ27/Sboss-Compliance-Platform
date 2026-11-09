import type { InstanceStatus, Role } from '@prisma/client';

export const REMINDER_DAYS: readonly number[] = [7, 3, 1, 0];
export const MANAGER_ESCALATION_DAYS = 3;
export const ADMIN_ESCALATION_DAYS = 15;
export const LIST_LIMIT = 10;

export type DigestItem = {
    id: string;
    code: string;
    title: string;
    location: string;
    dueDate: string; // YYYY-MM-DD
    status: InstanceStatus;
    ownerId: string;
    managerId: string;
    approverId: string | null;
};

export type DigestUser = { id: string; name: string; role: Role };

export type Digest = {
    userId: string;
    dueSoon: DigestItem[]; // owner: due in 7, 3 or 1 days, or today
    overdue: DigestItem[]; // owner: past the due date
    escalated: DigestItem[]; // manager: 3 or more days overdue
    awaitingReview: DigestItem[]; // reviewer: waiting for this person
    adminEscalated: number; // admin: company-wide items 15 or more days overdue
};

const DAY_MS = 86_400_000;

export const daysUntil = (due: string, today: string) =>
    Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

export const addDays = (date: string, n: number) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const emptyDigest = (userId: string): Digest => ({
    userId,
    dueSoon: [],
    overdue: [],
    escalated: [],
    awaitingReview: [],
    adminEscalated: 0,
});

// Only people in `users` get a digest, so viewers and deactivated users are left out
export function buildDigests(items: DigestItem[], users: DigestUser[], today: string): Map<string, Digest> {
    const eligible = new Set(users.map((u) => u.id));
    const out = new Map<string, Digest>();
    const get = (id: string | null) => {
        if (!id || !eligible.has(id)) return null;
        let d = out.get(id);
        if (!d) {
            d = emptyDigest(id);
            out.set(id, d);
        }
        return d;
    };

    let seriouslyOverdue = 0;
    for (const it of items) {
        if (it.status === 'DUE' || it.status === 'RETURNED') {
            const days = daysUntil(it.dueDate, today);
            if (days >= 0 && REMINDER_DAYS.includes(days)) get(it.ownerId)?.dueSoon.push(it);
            if (days < 0) {
                get(it.ownerId)?.overdue.push(it);
                if (-days >= MANAGER_ESCALATION_DAYS) get(it.managerId)?.escalated.push(it);
                if (-days >= ADMIN_ESCALATION_DAYS) seriouslyOverdue++;
            }
        } else if (it.status === 'SUBMITTED') {
            get(it.managerId)?.awaitingReview.push(it);
        } else if (it.status === 'MANAGER_APPROVED') {
            get(it.approverId)?.awaitingReview.push(it);
        }
    }

    if (seriouslyOverdue > 0) {
        for (const u of users) {
            if (u.role === 'ORG_ADMIN') {
                const d = get(u.id);
                if (d) d.adminEscalated = seriouslyOverdue;
            }
        }
    }

    for (const d of out.values()) {
        for (const list of [d.dueSoon, d.overdue, d.escalated, d.awaitingReview]) {
            list.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.code.localeCompare(b.code));
        }
    }
    return out;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function section(heading: string, items: DigestItem[], how: (i: DigestItem) => string): string[] {
    if (items.length === 0) return [];
    const lines = items
        .slice(0, LIST_LIMIT)
        .map((i) => `- ${i.code}: ${oneLine(i.title)} (${oneLine(i.location)}), ${how(i)}`);
    if (items.length > LIST_LIMIT) lines.push(`...and ${items.length - LIST_LIMIT} more`);
    return [`${heading} (${items.length})`, ...lines, ''];
}

export function renderDigest(d: Digest, name: string, today: string): { title: string; body: string } {
    const parts: string[] = [];
    if (d.awaitingReview.length) parts.push(`${d.awaitingReview.length} awaiting your review`);
    if (d.overdue.length) parts.push(`${d.overdue.length} overdue`);
    if (d.escalated.length) parts.push(`${d.escalated.length} escalated to you`);
    if (d.dueSoon.length) parts.push(`${d.dueSoon.length} due soon`);
    if (d.adminEscalated) parts.push(`${d.adminEscalated} seriously overdue company-wide`);

    const first = oneLine(name).split(' ')[0] || 'there';
    const lines = [
        `Hello ${first},`,
        '',
        `Here is your compliance summary for ${today}.`,
        '',
        ...section('Waiting for your review', d.awaitingReview, (i) => `due ${i.dueDate}`),
        ...section('Overdue', d.overdue, (i) => `${plural(-daysUntil(i.dueDate, today), 'day')} overdue (due ${i.dueDate})`),
        ...section(
            `Escalated to you: overdue ${plural(MANAGER_ESCALATION_DAYS, 'day')} or more`,
            d.escalated,
            (i) => `${plural(-daysUntil(i.dueDate, today), 'day')} overdue (due ${i.dueDate})`,
        ),
        ...section('Due soon', d.dueSoon, (i) => {
            const n = daysUntil(i.dueDate, today);
            return n === 0 ? 'due today' : `due in ${plural(n, 'day')} (${i.dueDate})`;
        }),
    ];
    if (d.adminEscalated) {
        lines.push(
            `Across the company, ${plural(d.adminEscalated, 'item')} ${d.adminEscalated === 1 ? 'is' : 'are'} overdue by ${plural(ADMIN_ESCALATION_DAYS, 'day')} or more.`,
        );
    }

    return { title: `Compliance summary: ${parts.join(', ')}`, body: lines.join('\n').trim() };
}