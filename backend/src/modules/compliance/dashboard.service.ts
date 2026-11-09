import type { Prisma } from '@prisma/client';
import { chunks } from '../../lib/chunks';
import { toDateOnly, todayInIndia } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import {
    addInto, bucket, countsByDay, emptyCounts, percentOf, totalOf,
} from './dashboard.calc';
import { DIMENSIONS, buildInstanceWhere, dashboardStatusWhere, dueRange } from './filters';
import type { DashboardQuery, DimensionFilters } from './filters';
import { visibleTo } from './instances.service';
import {
    fyLabel, fyRange, fyStartYear, monthLabel, monthRange, monthsOfFy,
    quarterOf, quarterRange, resolvePeriod,
} from './periods';

// Items per due date, split into the six dashboard statuses.
// Two grouped queries: one by stored status, one for items closed after their due date.
async function loadDays(actor: AuthUser, filters: DimensionFilters, from?: string, to?: string) {
    const today = todayInIndia();
    const where: Prisma.ComplianceInstanceWhereInput = {
        AND: [buildInstanceWhere(actor, filters), dueRange(from, to)],
    };

    const [rows, late] = await Promise.all([
        prisma.complianceInstance.groupBy({
            by: ['dueDate', 'status'],
            where,
            _count: { _all: true },
        }),
        prisma.complianceInstance.groupBy({
            by: ['dueDate'],
            where: { AND: [where, dashboardStatusWhere(['LATE_CLOSURE'], today)] },
            _count: { _all: true },
        }),
    ]);

    return countsByDay(
        rows.map((r) => ({ due: toDateOnly(r.dueDate), status: r.status, count: r._count._all })),
        late.map((r) => ({ due: toDateOnly(r.dueDate), count: r._count._all })),
        today,
    );
}

export async function summary(actor: AuthUser, q: DashboardQuery) {
    const today = todayInIndia();
    const period = resolvePeriod(q, today);

    const days = await loadDays(actor, q, period.from, period.to);
    const counts = emptyCounts();
    for (const c of days.values()) addInto(counts, c);
    const total = totalOf(counts);

    // Across all time: items nobody submitted by their due date
    const pendingWhere: Prisma.ComplianceInstanceWhereInput = {
        AND: [buildInstanceWhere(actor, q), dashboardStatusWhere(['NON_COMPLIANCE'], today)],
    };
    const [pendingForSubmission, oldest] = await Promise.all([
        prisma.complianceInstance.count({ where: pendingWhere }),
        prisma.complianceInstance.aggregate({ where: pendingWhere, _min: { dueDate: true } }),
    ]);

    const card = (n: number) => ({ count: n, percent: percentOf(n, total) });
    return {
        asOf: today,
        period,
        total,
        applicable: total - counts.notApplicable,
        cards: {
            nonCompliance: card(counts.nonCompliance),
            lateClosure: card(counts.lateClosure),
            onTime: card(counts.onTime),
            due: card(counts.due),
            notApplicable: card(counts.notApplicable),
            pendingApproval: card(counts.pendingApproval),
        },
        headline: {
            pendingForSubmission,
            oldestDueDate: oldest._min.dueDate ? toDateOnly(oldest._min.dueDate) : null,
        },
    };
}

export async function charts(actor: AuthUser, q: DashboardQuery) {
    const today = todayInIndia();
    const period = resolvePeriod(q, today);
    const chartFy = q.fy ?? fyStartYear(period.from);

    // All time, so the yearly chart can show every financial year that has items
    const days = await loadDays(actor, q);

    const yearly = [...bucket(days, (due) => fyLabel(fyStartYear(due))).entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([financialYear, counts]) => ({
            financialYear,
            ...fyRange(Number(financialYear.slice(0, 4))),
            counts,
            total: totalOf(counts),
        }));

    const range = fyRange(chartFy);
    const inYear = new Map([...days].filter(([due]) => due >= range.from && due <= range.to));

    const byQuarter = bucket(inYear, (due) => `Q${quarterOf(due)}`);
    const quarterly = ([1, 2, 3, 4] as const).map((n) => {
        const counts = byQuarter.get(`Q${n}`) ?? emptyCounts();
        return { quarter: `Q${n}`, ...quarterRange(chartFy, n), counts, total: totalOf(counts) };
    });

    const byMonth = bucket(inYear, (due) => due.slice(0, 7));
    const monthly = monthsOfFy(chartFy).map((month) => {
        const counts = byMonth.get(month) ?? emptyCounts();
        return { month, label: monthLabel(month), ...monthRange(month), counts, total: totalOf(counts) };
    });

    // Non compliance by risk, for the selected period
    const base: Prisma.ComplianceInstanceWhereInput = {
        AND: [
            buildInstanceWhere(actor, q),
            dueRange(period.from, period.to),
            dashboardStatusWhere(['NON_COMPLIANCE'], today),
        ],
    };
    const nonComplianceByRisk = await Promise.all(
        (['HIGH', 'MEDIUM', 'LOW'] as const).map(async (risk) => ({
            risk,
            count: await prisma.complianceInstance.count({
                where: { AND: [base, { compliance: { risk } }] },
            }),
        })),
    );

    return {
        asOf: today,
        period,
        financialYear: fyLabel(chartFy),
        yearly,
        quarterly,
        monthly,
        nonComplianceByRisk,
    };
}

// ---- Filter options -------------------------------------------------------------

type FacetKey = (typeof DIMENSIONS)[number];
type FacetRow = Record<FacetKey, string | null>;
export type FacetOption = { value: string; label: string };

const titleCase = (s: string) =>
    s
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

async function byIds<T>(ids: Iterable<string>, fetch: (part: string[]) => Promise<T[]>) {
    const out: T[] = [];
    for (const part of chunks([...ids], 5000)) out.push(...(await fetch(part)));
    return out;
}

const namesOf = <T extends { id: string; name: string }>(
    rows: T[],
    label: (r: T) => string = (r) => r.name,
) => new Map(rows.map((r) => [r.id, label(r)]));

/**
 * For each filter, the values that exist among the items the user can see, after applying
 * every OTHER selected filter. A filter's own selection never narrows its own list.
 */
export async function facets(actor: AuthUser, selected: DimensionFilters) {
    const orgId = actor.orgId;

    // One row per distinct combination, not per period, so this stays small
    const combos = await prisma.complianceInstance.groupBy({
        by: ['entityId', 'locationId', 'departmentId', 'verticalId', 'ownerId', 'managerId', 'complianceId'],
        where: { orgId, AND: [visibleTo(actor)] },
        _count: { _all: true },
    });

    const [locations, compliances] = await Promise.all([
        prisma.location.findMany({
            where: { orgId },
            select: { id: true, name: true, state: true, locationTypeId: true },
        }),
        byIds(new Set(combos.map((c) => c.complianceId)), (part) =>
            prisma.compliance.findMany({
                where: { id: { in: part } },
                select: {
                    id: true,
                    actId: true,
                    ruleId: true,
                    natureId: true,
                    typeId: true,
                    risk: true,
                    frequency: true,
                    attachment: true,
                    act: { select: { lawCategoryId: true } },
                },
            }),
        ),
    ]);
    const locationById = new Map(locations.map((l) => [l.id, l]));
    const complianceById = new Map(compliances.map((c) => [c.id, c]));

    const rows: FacetRow[] = [];
    for (const c of combos) {
        const loc = locationById.get(c.locationId);
        const comp = complianceById.get(c.complianceId);
        if (!loc || !comp) continue;
        rows.push({
            entityId: c.entityId,
            locationId: c.locationId,
            departmentId: c.departmentId,
            verticalId: c.verticalId,
            locationTypeId: loc.locationTypeId,
            state: loc.state,
            lawCategoryId: comp.act.lawCategoryId,
            actId: comp.actId,
            ruleId: comp.ruleId,
            natureId: comp.natureId,
            typeId: comp.typeId,
            risk: comp.risk,
            frequency: comp.frequency,
            attachment: comp.attachment,
            ownerId: c.ownerId,
            managerId: c.managerId,
        });
    }

    const active = DIMENSIONS.filter((k) => selected[k] !== undefined);
    const wanted = new Map(active.map((k) => [k, new Set(selected[k] as readonly string[])]));

    const values = {} as Record<FacetKey, Set<string>>;
    for (const key of DIMENSIONS) {
        const others = active.filter((k) => k !== key);
        const found = new Set<string>();
        for (const r of rows) {
            const v = r[key];
            if (v === null || found.has(v)) continue;
            if (others.every((k) => wanted.get(k)!.has(r[k] ?? ''))) found.add(v);
        }
        values[key] = found;
    }

    // Names for the options
    const [entities, departments, verticals, locationTypes, users, lawCategories, acts, rules, natures, types] =
        await Promise.all([
            prisma.entity.findMany({ where: { orgId }, select: { id: true, name: true } }),
            prisma.department.findMany({ where: { orgId }, select: { id: true, name: true } }),
            prisma.vertical.findMany({ where: { orgId }, select: { id: true, name: true } }),
            prisma.locationType.findMany({ where: { orgId }, select: { id: true, name: true } }),
            prisma.user.findMany({ where: { orgId }, select: { id: true, name: true } }),
            byIds(values.lawCategoryId, (part) =>
                prisma.lawCategory.findMany({ where: { id: { in: part } }, select: { id: true, name: true } }),
            ),
            byIds(values.actId, (part) =>
                prisma.act.findMany({ where: { id: { in: part } }, select: { id: true, name: true, state: true } }),
            ),
            byIds(values.ruleId, (part) =>
                prisma.rule.findMany({ where: { id: { in: part } }, select: { id: true, name: true } }),
            ),
            byIds(values.natureId, (part) =>
                prisma.complianceNature.findMany({ where: { id: { in: part } }, select: { id: true, name: true } }),
            ),
            byIds(values.typeId, (part) =>
                prisma.complianceType.findMany({ where: { id: { in: part } }, select: { id: true, name: true } }),
            ),
        ]);

    const labels: Partial<Record<FacetKey, Map<string, string>>> = {
        entityId: namesOf(entities),
        locationId: namesOf(locations),
        departmentId: namesOf(departments),
        verticalId: namesOf(verticals),
        locationTypeId: namesOf(locationTypes),
        lawCategoryId: namesOf(lawCategories),
        actId: namesOf(acts, (a) => (a.state ? `${a.name} (${a.state})` : a.name)),
        ruleId: namesOf(rules),
        natureId: namesOf(natures),
        typeId: namesOf(types),
        ownerId: namesOf(users),
        managerId: namesOf(users),
    };

    const labelOf = (key: FacetKey, value: string) => {
        if (key === 'state') return value;
        if (key === 'risk' || key === 'frequency' || key === 'attachment') return titleCase(value);
        return labels[key]?.get(value) ?? value;
    };

    const out = {} as Record<FacetKey, FacetOption[]>;
    for (const key of DIMENSIONS) {
        out[key] = [...values[key]]
            .map((value) => ({ value, label: labelOf(key, value) }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }
    return out;
}