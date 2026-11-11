import { prisma } from '../../lib/prisma';
import { chunks } from '../../lib/chunks';
import { parseDateOnly, toDateOnly } from '../../lib/dates';
import {
    addDays, buildDigests, renderDigest,
    type Digest, type DigestItem,
} from './digest';

const MAX_ITEMS = 100_000;
const DAY = 86_400_000;

export type DigestSummary = {
    userId: string;
    name: string;
    overdue: number;
    dueSoon: number;
    escalated: number;
    awaitingReview: number;
    adminEscalated: number;
};

export type DigestRun = {
    asOf: string;
    itemsConsidered: number;
    totalDigests: number;
    digests: DigestSummary[]; // the first 100 by name
    created: number;
    sample: { userId: string; name: string; title: string; body: string } | null;
};

export async function runDigest(
    today: string,
    opts: { dryRun: boolean; sampleUserId?: string },
): Promise<DigestRun> {
    const horizon = parseDateOnly(addDays(today, 7));

    // Only items someone needs to act on: open items due within a week or already late, and anything waiting for review
    const rows = await prisma.complianceInstance.findMany({
        where: {
            OR: [
                { status: { in: ['DUE', 'RETURNED'] }, dueDate: { lte: horizon } },
                { status: { in: ['SUBMITTED', 'MANAGER_APPROVED'] } },
            ],
        },
        select: {
            id: true,
            orgId: true,
            status: true,
            dueDate: true,
            ownerId: true,
            managerId: true,
            approverId: true,
            compliance: { select: { code: true, title: true } },
            location: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
        take: MAX_ITEMS + 1,
    });
    if (rows.length > MAX_ITEMS) {
        throw new Error(`Too many open items for one digest run (more than ${MAX_ITEMS})`);
    }

    const users = await prisma.user.findMany({
        where: { isActive: true, role: { in: ['ORG_ADMIN', 'MEMBER'] } },
        select: { id: true, orgId: true, name: true, role: true, emailAlerts: true },
    });
    type U = (typeof users)[number];

    const itemsByOrg = new Map<string, DigestItem[]>();
    for (const r of rows) {
        const list = itemsByOrg.get(r.orgId) ?? [];
        list.push({
            id: r.id,
            code: r.compliance.code,
            title: r.compliance.title,
            location: r.location.name,
            dueDate: toDateOnly(r.dueDate),
            status: r.status,
            ownerId: r.ownerId,
            managerId: r.managerId,
            approverId: r.approverId,
        });
        itemsByOrg.set(r.orgId, list);
    }
    const usersByOrg = new Map<string, U[]>();
    for (const u of users) usersByOrg.set(u.orgId, [...(usersByOrg.get(u.orgId) ?? []), u]);

    const planned: { user: U; digest: Digest }[] = [];
    for (const [orgId, items] of itemsByOrg) {
        const orgUsers = usersByOrg.get(orgId) ?? [];
        const byId = new Map(orgUsers.map((u) => [u.id, u]));
        for (const digest of buildDigests(items, orgUsers, today).values()) {
            planned.push({ user: byId.get(digest.userId) as U, digest });
        }
    }
    planned.sort((a, b) => a.user.name.localeCompare(b.user.name));

    const summaries: DigestSummary[] = planned.map(({ user, digest }) => ({
        userId: user.id,
        name: user.name,
        overdue: digest.overdue.length,
        dueSoon: digest.dueSoon.length,
        escalated: digest.escalated.length,
        awaitingReview: digest.awaitingReview.length,
        adminEscalated: digest.adminEscalated,
    }));

    const chosen = planned.find((p) => p.user.id === opts.sampleUserId) ?? planned[0];
    const sample = chosen
        ? { userId: chosen.user.id, name: chosen.user.name, ...renderDigest(chosen.digest, chosen.user.name, today) }
        : null;

    let created = 0;
    if (!opts.dryRun) {
        const data = planned.map(({ user, digest }) => {
            const { title, body } = renderDigest(digest, user.name, today);
            return {
                orgId: user.orgId,
                userId: user.id,
                type: 'DAILY_DIGEST' as const,
                title,
                body,
                dedupeKey: `digest:${today}`,
                emailStatus: user.emailAlerts ? ('PENDING' as const) : ('NONE' as const),
            };
        });
        for (const part of chunks(data, 500)) {
            // The unique key (person + day) makes running this twice harmless
            const r = await prisma.notification.createMany({ data: part, skipDuplicates: true });
            created += r.count;
        }
    }

    return {
        asOf: today,
        itemsConsidered: rows.length,
        totalDigests: planned.length,
        digests: summaries.slice(0, 100),
        created,
        sample,
    };
}

export async function purgeOld() {
    const notifications = await prisma.notification.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 90 * DAY) } },
    });
    const jobRuns = await prisma.jobRun.deleteMany({
        where: { startedAt: { lt: new Date(Date.now() - 180 * DAY) } },
    });
    const authTokens = await prisma.authToken.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 30 * DAY) } },
    });
    const refreshTokens = await prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 30 * DAY) } },
    });
    return {
        purgedNotifications: notifications.count,
        purgedJobRuns: jobRuns.count,
        purgedAuthTokens: authTokens.count,
        purgedRefreshTokens: refreshTokens.count,
    };
}