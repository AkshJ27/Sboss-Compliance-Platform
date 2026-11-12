import { Prisma } from '@prisma/client';
import type { AmendmentDecisionType, InstanceStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly, toDateOnly } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import { notifyDueDatesMoved } from '../notifications/law-notify';
import {
    describeRule,
    formatChange,
    mergeChanges,
    planOpenItemMoves,
    sameRule,
    summarizePending,
    toChangeViews,
} from './amendments.engine';
import type { LibraryRule, Move, MoveReason, OpenItem, PinGroup, Rule } from './amendments.engine';
import type { DecisionInput, HistoryQuery, ListQuery } from './amendments.schema';

type Db = Prisma.TransactionClient;
type OpenItemWithOwner = OpenItem & { ownerId: string };

const OPEN: InstanceStatus[] = ['DUE', 'RETURNED'];
const MAX_SCHEDULES = 20_000;
const MAX_ITEMS = 200_000;
const BULK_LIMIT = 200;

const ruleSelect = {
    frequency: true,
    periodBasis: true,
    dueDay: true,
    dueMonthOffset: true,
    event: true,
    dueDaysAfterEvent: true,
} as const;

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const lowestOf = (xs: number[]) => xs.reduce((m, x) => (x < m ? x : m), Number.POSITIVE_INFINITY);

const REASON_TEXT: Record<MoveReason, string> = {
    NONE: '',
    PERIODICITY_CHANGED:
        'The periodicity or period basis changed, so the periods themselves differ. Open items keep their current dates.',
    ONE_TIME: 'One-time items keep their current dates.',
    NO_DUE_RULE: 'The new rule has no due day, so those items keep their current dates.',
};

// ---- What is waiting ---------------------------------------------------------------

// A schedule is waiting when the library version it follows is older than the library's.
// Nothing is stored for this: it is worked out every time, so it can never get out of step.
async function pendingFor(db: Db, orgId: string) {
    const groups = await db.complianceSchedule.groupBy({
        by: [
            'complianceId',
            'libraryVersion',
            'frequency',
            'periodBasis',
            'dueDay',
            'dueMonthOffset',
            'event',
            'dueDaysAfterEvent',
        ],
        where: { orgId, isActive: true },
        _count: { _all: true },
    });

    const ids = [...new Set(groups.map((g) => g.complianceId))];
    const library: LibraryRule[] = [];
    for (const part of chunks(ids, 5000)) {
        const rows = await db.compliance.findMany({
            where: { id: { in: part } },
            select: { id: true, version: true, ...ruleSelect },
        });
        library.push(...rows);
    }

    const pins: PinGroup[] = groups.map((g) => ({
        complianceId: g.complianceId,
        libraryVersion: g.libraryVersion,
        frequency: g.frequency,
        periodBasis: g.periodBasis,
        dueDay: g.dueDay,
        dueMonthOffset: g.dueMonthOffset,
        event: g.event,
        dueDaysAfterEvent: g.dueDaysAfterEvent,
        count: g._count._all,
    }));
    return summarizePending(pins, library);
}

export async function summary(actor: AuthUser) {
    const pending = await pendingFor(prisma, actor.orgId);
    const needDecision = pending.filter((p) => p.needsDecision).length;
    return { waiting: pending.length, needDecision, informational: pending.length - needDecision };
}

export async function list(actor: AuthUser, q: ListQuery) {
    const pending = (await pendingFor(prisma, actor.orgId)).filter(
        (p) => q.kind === 'all' || (q.kind === 'decision' ? p.needsDecision : !p.needsDecision),
    );

    const details = new Map<
        string,
        { id: string; code: string; title: string; risk: string; act: { name: string; state: string | null } }
    >();
    for (const part of chunks(pending.map((p) => p.id), 5000)) {
        const rows = await prisma.compliance.findMany({
            where: { id: { in: part } },
            select: { id: true, code: true, title: true, risk: true, act: { select: { name: true, state: true } } },
        });
        for (const r of rows) details.set(r.id, r);
    }

    const needle = q.search?.toLowerCase();
    const matched = pending.filter((p) => {
        const d = details.get(p.id);
        if (!d) return false;
        if (!needle) return true;
        return (
            d.code.toLowerCase().includes(needle) ||
            d.title.toLowerCase().includes(needle) ||
            d.act.name.toLowerCase().includes(needle)
        );
    });
    // Laws that need a decision first, then by code
    matched.sort(
        (a, b) =>
            Number(b.needsDecision) - Number(a.needsDecision) ||
            byCodeUnits(details.get(a.id)!.code, details.get(b.id)!.code),
    );

    const page = matched.slice((q.page - 1) * q.limit, q.page * q.limit);
    const revisions = page.length
        ? await prisma.complianceRevision.findMany({
            where: { complianceId: { in: page.map((p) => p.id) } },
            select: { complianceId: true, version: true, changes: true },
        })
        : [];

    const items = page.map((p) => {
        const d = details.get(p.id)!;
        const mine = revisions.filter(
            (r) => r.complianceId === p.id && r.version > p.fromVersion && r.version <= p.version,
        );
        return {
            complianceId: p.id,
            code: d.code,
            title: d.title,
            act: d.act,
            risk: d.risk,
            fromVersion: p.fromVersion,
            toVersion: p.version,
            schedules: p.schedules,
            needsDecision: p.needsDecision,
            changes: mergeChanges(mine).map(formatChange),
        };
    });
    return { items, total: matched.length, page: q.page, limit: q.limit };
}

// ---- Loading the work for one law --------------------------------------------------

async function loadWork(db: Db, orgId: string, complianceId: string) {
    const compliance = await db.compliance.findUnique({
        where: { id: complianceId },
        select: {
            id: true,
            code: true,
            title: true,
            version: true,
            risk: true,
            ...ruleSelect,
            act: { select: { name: true, state: true } },
        },
    });
    if (!compliance) throw new HttpError(404, 'Law not found');

    const schedules = await db.complianceSchedule.findMany({
        where: { orgId, complianceId, isActive: true, libraryVersion: { lt: compliance.version } },
        select: {
            id: true,
            libraryVersion: true,
            ...ruleSelect,
            location: { select: { name: true } },
            entity: { select: { code: true } },
        },
        orderBy: { id: 'asc' },
        take: MAX_SCHEDULES + 1,
    });
    if (schedules.length > MAX_SCHEDULES) {
        throw new HttpError(400, `Too many schedules follow this law (more than ${MAX_SCHEDULES}).`);
    }
    return { compliance, schedules };
}

async function loadOpenItems(db: Db, orgId: string, scheduleIds: string[]) {
    const bySchedule = new Map<string, OpenItemWithOwner[]>();
    let total = 0;
    for (const part of chunks(scheduleIds, 2000)) {
        const rows = await db.complianceInstance.findMany({
            where: { orgId, scheduleId: { in: part }, status: { in: OPEN } },
            select: { id: true, scheduleId: true, dueDate: true, periodStart: true, periodEnd: true, ownerId: true },
        });
        total += rows.length;
        if (total > MAX_ITEMS) {
            throw new HttpError(400, `Too many open items follow this law (more than ${MAX_ITEMS}).`);
        }
        for (const r of rows) {
            const list = bySchedule.get(r.scheduleId) ?? [];
            list.push({
                id: r.id,
                dueDate: toDateOnly(r.dueDate),
                periodStart: toDateOnly(r.periodStart),
                periodEnd: toDateOnly(r.periodEnd),
                ownerId: r.ownerId,
            });
            bySchedule.set(r.scheduleId, list);
        }
    }
    return bySchedule;
}

type PlannedMove = Move & { scheduleId: string; ownerId: string };

// What applying the new rule would do to the open items of every schedule
function planAll(lib: Rule, schedules: (Rule & { id: string })[], itemsBy: Map<string, OpenItemWithOwner[]>) {
    let open = 0;
    let unchanged = 0;
    let kept = 0;
    const reasons = new Set<MoveReason>();
    const moves: PlannedMove[] = [];

    for (const s of schedules) {
        const items = itemsBy.get(s.id) ?? [];
        open += items.length;
        const plan = planOpenItemMoves(s, lib, items);
        unchanged += plan.unchanged;
        kept += plan.kept;
        if (plan.kept > 0 && plan.reason !== 'NONE') reasons.add(plan.reason);
        const ownerOf = new Map(items.map((i) => [i.id, i.ownerId]));
        for (const m of plan.moves) moves.push({ ...m, scheduleId: s.id, ownerId: ownerOf.get(m.id) as string });
    }
    return { open, unchanged, kept, reasons, moves };
}

async function changesBetween(db: Db, complianceId: string, fromVersion: number, toVersion: number) {
    const revisions = await db.complianceRevision.findMany({
        where: { complianceId, version: { gt: fromVersion, lte: toVersion } },
        select: { version: true, changes: true },
    });
    return mergeChanges(revisions);
}

// ---- The review screen -------------------------------------------------------------

export async function preview(actor: AuthUser, complianceId: string) {
    const { compliance, schedules } = await loadWork(prisma, actor.orgId, complianceId);
    if (schedules.length === 0) throw new HttpError(404, 'Nothing is waiting for this law');

    const fromVersion = lowestOf(schedules.map((s) => s.libraryVersion));
    const changes = (await changesBetween(prisma, complianceId, fromVersion, compliance.version)).map(formatChange);
    const needsDecision = schedules.some((s) => !sameRule(s, compliance));

    const pinned = new Map<string, number>();
    for (const s of schedules) {
        const text = describeRule(s);
        pinned.set(text, (pinned.get(text) ?? 0) + 1);
    }
    const currentRules = [...pinned]
        .map(([rule, count]) => ({ rule, schedules: count }))
        .sort((a, b) => b.schedules - a.schedules || byCodeUnits(a.rule, b.rule));

    const itemsBy = await loadOpenItems(prisma, actor.orgId, schedules.map((s) => s.id));
    const plan = planAll(compliance, schedules, itemsBy);

    const label = new Map(schedules.map((s) => [s.id, `${s.entity.code} / ${s.location.name}`]));
    const sampleMoves = [...plan.moves]
        .sort((a, b) => byCodeUnits(a.from, b.from) || byCodeUnits(a.id, b.id))
        .slice(0, 20)
        .map((m) => ({ location: label.get(m.scheduleId) ?? '', from: m.from, to: m.to }));

    return {
        complianceId,
        code: compliance.code,
        title: compliance.title,
        act: compliance.act,
        risk: compliance.risk,
        fromVersion,
        version: compliance.version,
        needsDecision,
        changes,
        newRule: describeRule(compliance),
        currentRules,
        schedules: schedules.length,
        sampleLocations: [...label.values()].slice(0, 10),
        items: {
            open: plan.open,
            willMove: plan.moves.length,
            unchanged: plan.unchanged,
            kept: plan.kept,
        },
        notes: [...plan.reasons].map((r) => REASON_TEXT[r]),
        sampleMoves,
    };
}

// ---- Deciding ----------------------------------------------------------------------

export async function decide(actor: AuthUser, complianceId: string, input: DecisionInput) {
    return prisma.$transaction(
        async (tx) => {
            const { compliance, schedules } = await loadWork(tx, actor.orgId, complianceId);

            if (compliance.version !== input.version) {
                throw new HttpError(
                    409,
                    'This law changed again while you were reviewing it. Reload the page and review the new changes.',
                );
            }
            if (schedules.length === 0) {
                throw new HttpError(409, 'Nothing is waiting for this law. Someone else may have just decided.');
            }

            const needsDecision = schedules.some((s) => !sameRule(s, compliance));
            if (needsDecision && input.decision === 'ACKNOWLEDGE') {
                throw new HttpError(400, 'This change affects due dates, so choose Apply or Keep my current rule.');
            }
            if (!needsDecision && input.decision !== 'ACKNOWLEDGE') {
                throw new HttpError(400, 'This change does not affect due dates. Acknowledge it.');
            }

            const scheduleIds = schedules.map((s) => s.id);
            const fromVersion = lowestOf(schedules.map((s) => s.libraryVersion));
            const changes = await changesBetween(tx, complianceId, fromVersion, compliance.version);

            // Claim the schedules. If anyone decided or changed them in the meantime, the count is short and all of this is undone.
            const data: Prisma.ComplianceScheduleUncheckedUpdateManyInput =
                input.decision === 'APPLY'
                    ? {
                        libraryVersion: compliance.version,
                        frequency: compliance.frequency,
                        periodBasis: compliance.periodBasis,
                        dueDay: compliance.dueDay,
                        dueMonthOffset: compliance.dueMonthOffset,
                        event: compliance.event,
                        dueDaysAfterEvent: compliance.dueDaysAfterEvent,
                    }
                    : { libraryVersion: compliance.version };
            let claimed = 0;
            for (const part of chunks(scheduleIds, 5000)) {
                const r = await tx.complianceSchedule.updateMany({
                    where: {
                        id: { in: part },
                        orgId: actor.orgId,
                        isActive: true,
                        libraryVersion: { lt: compliance.version },
                    },
                    data,
                });
                claimed += r.count;
            }
            if (claimed !== scheduleIds.length) {
                throw new HttpError(409, 'These schedules were just changed by someone else. Reload and try again.');
            }

            // Move the open items
            let itemsMoved = 0;
            let itemsKept = 0;
            const movedOwners: { ownerId: string; dueDate: string }[] = [];
            if (input.decision === 'APPLY') {
                const itemsBy = await loadOpenItems(tx, actor.orgId, scheduleIds);
                const plan = planAll(compliance, schedules, itemsBy);
                itemsKept = plan.kept;

                const byTarget = new Map<string, PlannedMove[]>();
                for (const m of plan.moves) {
                    const list = byTarget.get(m.to) ?? [];
                    list.push(m);
                    byTarget.set(m.to, list);
                }

                const events: Prisma.InstanceEventCreateManyInput[] = [];
                for (const [to, group] of byTarget) {
                    const toDate = parseDateOnly(to);
                    const fromOf = new Map(group.map((m) => [m.id, m.from]));
                    for (const part of chunks(group.map((m) => m.id), 5000)) {
                        // Only items that are still open are touched. One that was submitted a moment ago is skipped.
                        await tx.complianceInstance.updateMany({
                            where: { id: { in: part }, orgId: actor.orgId, status: { in: OPEN } },
                            data: { dueDate: toDate },
                        });
                        // The rows we updated are locked until this transaction ends. Skipped rows still have their old date.
                        const moved = await tx.complianceInstance.findMany({
                            where: { id: { in: part }, orgId: actor.orgId, dueDate: toDate },
                            select: { id: true, status: true, ownerId: true },
                        });
                        for (const r of moved) {
                            events.push({
                                orgId: actor.orgId,
                                instanceId: r.id,
                                actorId: actor.id,
                                action: 'DUE_DATE_CHANGED',
                                fromStatus: r.status,
                                toStatus: r.status,
                                remarks: input.note || null,
                                data: { from: fromOf.get(r.id) ?? null, to, libraryVersion: compliance.version },
                            });
                            movedOwners.push({ ownerId: r.ownerId, dueDate: to });
                        }
                        itemsMoved += moved.length;
                    }
                }
                for (const part of chunks(events, 1000)) await tx.instanceEvent.createMany({ data: part });
            }

            // Items that can still be edited follow the law's current risk for whether an approver is needed.
            // Items already in review keep the route they started on.
            const high = compliance.risk === 'HIGH';
            let approvalRuleUpdated = 0;
            for (const part of chunks(scheduleIds, 5000)) {
                const r = await tx.complianceInstance.updateMany({
                    where: { orgId: actor.orgId, scheduleId: { in: part }, status: { in: OPEN }, requiresApprover: !high },
                    data: { requiresApprover: high },
                });
                approvalRuleUpdated += r.count;
            }

            const decisionType: AmendmentDecisionType =
                input.decision === 'APPLY' ? 'APPLIED' : input.decision === 'KEEP' ? 'KEPT' : 'ACKNOWLEDGED';
            await tx.amendmentDecision.create({
                data: {
                    orgId: actor.orgId,
                    complianceId,
                    decision: decisionType,
                    fromVersion,
                    toVersion: compliance.version,
                    changes: JSON.parse(JSON.stringify(changes)) as Prisma.InputJsonValue,
                    schedulesUpdated: scheduleIds.length,
                    itemsMoved,
                    note: input.note || null,
                    decidedById: actor.id,
                },
            });
            await recordAudit(tx, actor, `LAW_CHANGE_${decisionType}`, 'Compliance', complianceId, {
                code: compliance.code,
                fromVersion,
                toVersion: compliance.version,
                schedules: scheduleIds.length,
                itemsMoved,
                approvalRuleUpdated,
                fields: changes.map((c) => c.field),
            });

            if (movedOwners.length > 0) {
                const me = await tx.user.findFirst({
                    where: { id: actor.id, orgId: actor.orgId },
                    select: { name: true },
                });
                await notifyDueDatesMoved(tx, {
                    orgId: actor.orgId,
                    actorId: actor.id,
                    actorName: me?.name ?? 'An administrator',
                    code: compliance.code,
                    title: compliance.title,
                    moves: movedOwners,
                });
            }

            return {
                decision: decisionType,
                code: compliance.code,
                schedulesUpdated: scheduleIds.length,
                itemsMoved,
                itemsKept,
                approvalRuleUpdated,
            };
        },
        { timeout: 5 * 60 * 1000, maxWait: 10_000 },
    );
}

// Acknowledges the changes that do not touch due dates, one decision per law so each has its own record
export async function acknowledgeAll(actor: AuthUser) {
    const info = (await pendingFor(prisma, actor.orgId))
        .filter((p) => !p.needsDecision)
        .sort((a, b) => byCodeUnits(a.id, b.id));
    const batch = info.slice(0, BULK_LIMIT);

    let acknowledged = 0;
    let skipped = 0;
    for (const p of batch) {
        try {
            await decide(actor, p.id, { decision: 'ACKNOWLEDGE', version: p.version });
            acknowledged++;
        } catch (e) {
            if (e instanceof HttpError) skipped++; // for example, someone else decided it first
            else throw e;
        }
    }
    return { acknowledged, skipped, remaining: info.length - batch.length };
}

// ---- Past decisions ----------------------------------------------------------------

export async function history(actor: AuthUser, q: HistoryQuery) {
    const where: Prisma.AmendmentDecisionWhereInput = {
        orgId: actor.orgId,
        ...(q.decision ? { decision: q.decision } : {}),
    };
    const [total, rows] = await prisma.$transaction([
        prisma.amendmentDecision.count({ where }),
        prisma.amendmentDecision.findMany({
            where,
            select: {
                id: true,
                decision: true,
                fromVersion: true,
                toVersion: true,
                changes: true,
                schedulesUpdated: true,
                itemsMoved: true,
                note: true,
                createdAt: true,
                compliance: { select: { id: true, code: true, title: true } },
                decidedBy: { select: { id: true, name: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    return {
        items: rows.map((r) => ({ ...r, changes: toChangeViews(r.changes) })),
        total,
        page: q.page,
        limit: q.limit,
    };
}