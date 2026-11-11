import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import { chunks } from '../../lib/chunks';
import { parseDateOnly, toDateOnly, todayInIndia } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import { notifyEventTriggered } from '../notifications/event-notify';
import { groupEvents, normalizeEvent, planTrigger } from './events.engine';
import type { TriggerInput, TriggerListQuery } from './events.schema';

type Db = Prisma.TransactionClient;

const MAX_SCHEDULES = 5000;

// Active schedules at a location whose compliance starts from an event
function eventSchedules(orgId: string, locationId: string): Prisma.ComplianceScheduleWhereInput {
    return {
        orgId,
        locationId,
        isActive: true,
        compliance: { isActive: true, frequency: 'EVENT_BASED', event: { not: null } },
        location: { isActive: true, entity: { isActive: true } },
    };
}

// The events a location can have, with how many items each would create
export async function eventOptions(actor: AuthUser, locationId: string) {
    const rows = await prisma.complianceSchedule.findMany({
        where: eventSchedules(actor.orgId, locationId),
        select: { compliance: { select: { event: true } } },
        take: MAX_SCHEDULES,
    });
    return groupEvents(rows.flatMap((r) => (r.compliance.event ? [r.compliance.event] : []))).map((g) => ({
        event: g.label,
        items: g.count,
    }));
}

// Works out what recording the event would do, without writing anything
async function loadPlan(db: Db, actor: AuthUser, input: TriggerInput) {
    if (input.eventDate > todayInIndia()) throw new HttpError(400, 'The event date cannot be in the future');

    const location = await db.location.findFirst({
        where: {
            id: input.locationId,
            entityId: input.entityId,
            orgId: actor.orgId,
            isActive: true,
            entity: { isActive: true },
        },
        select: { id: true, name: true },
    });
    if (!location) throw new HttpError(400, 'Location not found for this entity, or it is inactive');

    const key = normalizeEvent(input.event);
    const rows = await db.complianceSchedule.findMany({
        where: eventSchedules(actor.orgId, location.id),
        select: {
            id: true,
            complianceId: true,
            entityId: true,
            locationId: true,
            departmentId: true,
            verticalId: true,
            ownerId: true,
            managerId: true,
            approverId: true,
            startDate: true,
            compliance: {
                select: { code: true, title: true, risk: true, event: true, dueDaysAfterEvent: true },
            },
        },
        orderBy: { id: 'asc' },
        take: MAX_SCHEDULES + 1,
    });
    if (rows.length > MAX_SCHEDULES) {
        throw new HttpError(400, `Too many event-based schedules at this location (more than ${MAX_SCHEDULES})`);
    }

    const matching = rows.filter((r) => r.compliance.event !== null && normalizeEvent(r.compliance.event) === key);
    if (matching.length === 0) {
        throw new HttpError(400, 'No active schedule at this location uses that event');
    }
    const label = groupEvents(matching.map((r) => r.compliance.event as string))[0].label;

    const eventDate = parseDateOnly(input.eventDate);
    const found = await db.complianceInstance.findMany({
        where: { orgId: actor.orgId, scheduleId: { in: matching.map((r) => r.id) }, periodStart: eventDate },
        select: { scheduleId: true },
    });

    const plan = planTrigger(
        matching.map((r) => ({
            id: r.id,
            event: r.compliance.event,
            dueDaysAfterEvent: r.compliance.dueDaysAfterEvent,
            startDate: toDateOnly(r.startDate),
        })),
        key,
        input.eventDate,
        new Set(found.map((f) => f.scheduleId)),
    );
    return { location, label, matching, eventDate, plan };
}
type Plan = Awaited<ReturnType<typeof loadPlan>>;

function summarize(p: Plan, input: TriggerInput, dryRun: boolean) {
    const byId = new Map(p.matching.map((r) => [r.id, r]));
    const sorted = [...p.plan.toCreate].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return {
        dryRun,
        location: p.location.name,
        event: p.label,
        eventDate: input.eventDate,
        matched: p.plan.matched,
        toCreate: sorted.length,
        alreadyExist: p.plan.alreadyExist,
        skippedBeforeStart: p.plan.skippedBeforeStart,
        skippedNoDueDays: p.plan.skippedNoDueDays,
        firstDue: sorted[0]?.dueDate ?? null,
        lastDue: sorted[sorted.length - 1]?.dueDate ?? null,
        sample: sorted.slice(0, 20).map((x) => {
            const r = byId.get(x.scheduleId)!;
            return { code: r.compliance.code, title: r.compliance.title, risk: r.compliance.risk, dueDate: x.dueDate };
        }),
    };
}

export async function trigger(actor: AuthUser, input: TriggerInput, dryRun: boolean) {
    if (dryRun) {
        const p = await loadPlan(prisma, actor, input);
        return { ...summarize(p, input, true), created: 0, triggerId: null as string | null };
    }

    return prisma.$transaction(
        async (tx) => {
            // Plan again inside the transaction, so what is created is never based on stale data
            const p = await loadPlan(tx, actor, input);
            const base = summarize(p, input, false);
            if (p.plan.toCreate.length === 0) return { ...base, created: 0, triggerId: null as string | null };

            // The same event on the same date at the same location joins the existing record,
            // for example when a schedule was activated after the first time it was recorded
            const key = normalizeEvent(input.event);
            const sameDay = await tx.eventTrigger.findMany({
                where: { orgId: actor.orgId, locationId: p.location.id, eventDate: p.eventDate, cancelledAt: null },
                select: { id: true, event: true },
                orderBy: { createdAt: 'asc' },
            });
            let triggerId = sameDay.find((t) => normalizeEvent(t.event) === key)?.id;
            const isNew = triggerId === undefined;
            if (triggerId === undefined) {
                const t = await tx.eventTrigger.create({
                    data: {
                        orgId: actor.orgId,
                        entityId: input.entityId,
                        locationId: p.location.id,
                        event: p.label,
                        eventDate: p.eventDate,
                        note: input.note || null,
                        createdById: actor.id,
                    },
                    select: { id: true },
                });
                triggerId = t.id;
            }
            const id: string = triggerId;

            const byId = new Map(p.matching.map((r) => [r.id, r]));
            const rows: Prisma.ComplianceInstanceCreateManyInput[] = p.plan.toCreate.map((x) => {
                const r = byId.get(x.scheduleId)!;
                return {
                    orgId: actor.orgId,
                    scheduleId: r.id,
                    complianceId: r.complianceId,
                    entityId: r.entityId,
                    locationId: r.locationId,
                    departmentId: r.departmentId,
                    verticalId: r.verticalId,
                    ownerId: r.ownerId,
                    managerId: r.managerId,
                    approverId: r.approverId,
                    requiresApprover: r.compliance.risk === 'HIGH',
                    periodStart: p.eventDate,
                    periodEnd: p.eventDate, // an event is a single day
                    dueDate: parseDateOnly(x.dueDate),
                    triggerId: id,
                };
            });

            let created = 0;
            for (const part of chunks(rows)) {
                const r = await tx.complianceInstance.createMany({ data: part, skipDuplicates: true });
                created += r.count;
            }
            if (created === 0) {
                // Someone else recorded it at the same moment. Leave no empty record behind.
                if (isNew) await tx.eventTrigger.delete({ where: { id } });
                return { ...base, created: 0, triggerId: null as string | null };
            }

            await recordAudit(tx, actor, 'EVENT_TRIGGERED', 'EventTrigger', id, {
                event: p.label,
                eventDate: input.eventDate,
                location: p.location.name,
                created,
            });

            const actorRow = await tx.user.findFirst({
                where: { id: actor.id, orgId: actor.orgId },
                select: { name: true },
            });
            await notifyEventTriggered(tx, {
                orgId: actor.orgId,
                actorId: actor.id,
                actorName: actorRow?.name ?? 'An administrator',
                event: p.label,
                location: p.location.name,
                eventDate: input.eventDate,
                items: p.plan.toCreate.map((x) => ({ ownerId: byId.get(x.scheduleId)!.ownerId, dueDate: x.dueDate })),
            });

            return { ...base, created, triggerId: id as string | null };
        },
        { timeout: 60_000 },
    );
}

export async function listTriggers(actor: AuthUser, q: TriggerListQuery) {
    const where: Prisma.EventTriggerWhereInput = {
        orgId: actor.orgId,
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.locationId ? { locationId: q.locationId } : {}),
        ...(q.status === 'active' ? { cancelledAt: null } : q.status === 'cancelled' ? { cancelledAt: { not: null } } : {}),
    };

    const [total, items] = await prisma.$transaction([
        prisma.eventTrigger.count({ where }),
        prisma.eventTrigger.findMany({
            where,
            select: {
                id: true,
                event: true,
                eventDate: true,
                note: true,
                createdAt: true,
                cancelledAt: true,
                entity: { select: { id: true, name: true, code: true } },
                location: { select: { id: true, name: true, state: true } },
                createdBy: { select: { id: true, name: true } },
                _count: { select: { instances: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
}

// Removes the items of an event that nobody has started on, and keeps the record as cancelled
export async function cancelTrigger(actor: AuthUser, id: string) {
    return prisma.$transaction(async (tx) => {
        const trig = await tx.eventTrigger.findFirst({
            where: { id, orgId: actor.orgId },
            select: { id: true, event: true, eventDate: true, cancelledAt: true },
        });
        if (!trig) throw new HttpError(404, 'Event not found');
        if (trig.cancelledAt) throw new HttpError(409, 'This event was already cancelled');

        // Lock the items first. Anyone saving a draft or uploading proof now waits,
        // and then finds the item gone instead of changing something half removed.
        await tx.complianceInstance.updateMany({
            where: { triggerId: id, orgId: actor.orgId },
            data: { updatedAt: new Date() },
        });

        const items = await tx.complianceInstance.findMany({
            where: { triggerId: id, orgId: actor.orgId },
            select: { id: true, status: true, _count: { select: { events: true, documents: true } } },
        });
        const busy = items.filter((i) => i.status !== 'DUE' || i._count.events > 0 || i._count.documents > 0);
        if (busy.length > 0) {
            throw new HttpError(
                409,
                `${busy.length} of ${items.length} item(s) already have activity (a draft, a document or a submission), so this event cannot be cancelled. Close those items as not applicable instead.`,
            );
        }

        await tx.complianceInstance.deleteMany({ where: { triggerId: id, orgId: actor.orgId, status: 'DUE' } });
        await tx.eventTrigger.update({ where: { id }, data: { cancelledAt: new Date(), cancelledById: actor.id } });
        await recordAudit(tx, actor, 'EVENT_TRIGGER_CANCELLED', 'EventTrigger', id, {
            event: trig.event,
            eventDate: toDateOnly(trig.eventDate),
            removed: items.length,
        });
        return { removed: items.length };
    });
}