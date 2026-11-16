import { addInto, emptyCounts, percentOf, totalOf, type StatusCounts } from '../compliance/dashboard.calc';

// The ways the summary report can be grouped. Each is also a filter of the record list,
// so a count in the report can open the matching records.
export const GROUP_BY = [
    'entityId',
    'locationId',
    'state',
    'departmentId',
    'verticalId',
    'lawCategoryId',
    'actId',
    'ownerId',
    'managerId',
    'risk',
    'frequency',
] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export const GROUP_LABEL: Record<GroupBy, string> = {
    entityId: 'Entity',
    locationId: 'Location',
    state: 'State',
    departmentId: 'Department',
    verticalId: 'Vertical',
    lawCategoryId: 'Law category',
    actId: 'Act',
    ownerId: 'Owner',
    managerId: 'Manager',
    risk: 'Risk',
    frequency: 'Periodicity',
};

// The column of an item the database groups by. Some groupings need one more step:
// law category, act, risk and periodicity come from the compliance, state from the location.
export type BaseField =
    | 'entityId'
    | 'locationId'
    | 'departmentId'
    | 'verticalId'
    | 'ownerId'
    | 'managerId'
    | 'complianceId';

export function baseFieldOf(g: GroupBy): BaseField {
    switch (g) {
        case 'lawCategoryId':
        case 'actId':
        case 'risk':
        case 'frequency':
            return 'complianceId';
        case 'state':
            return 'locationId';
        default:
            return g;
    }
}

export type Money = { payable: number; paid: number; penalty: number };
const emptyMoney = (): Money => ({ payable: 0, paid: 0, penalty: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

// One database count: how many items with this base value are in one dashboard status
export type StatusCountRow = { base: string | null; status: keyof StatusCounts; count: number };
export type MoneyRow = { base: string | null } & Money;

export type SummaryRow = {
    key: string | null; // null when the item has no value, such as no department
    label: string;
    counts: StatusCounts;
    total: number;
    applicable: number;
    decided: number; // items closed or past their due date, which have an outcome
    onTimePercent: number | null;
    money: Money;
};

// Share of decided items closed on time. Items not yet due, waiting for approval
// or not applicable do not count for or against.
export function onTimePercentOf(c: StatusCounts): number | null {
    const decided = c.onTime + c.lateClosure + c.nonCompliance;
    return decided === 0 ? null : percentOf(c.onTime, decided);
}

function finish(key: string | null, label: string, counts: StatusCounts, money: Money): SummaryRow {
    const total = totalOf(counts);
    return {
        key,
        label,
        counts,
        total,
        applicable: total - counts.notApplicable,
        decided: counts.onTime + counts.lateClosure + counts.nonCompliance,
        onTimePercent: onTimePercentOf(counts),
        money: { payable: round2(money.payable), paid: round2(money.paid), penalty: round2(money.penalty) },
    };
}

/**
 * Adds database counts up into report rows.
 * `groupOf` turns a base value (a compliance or location id) into the group key, and
 * `labelOf` names a group. Rows come back with the most non compliance first.
 */
export function buildSummary(
    counts: StatusCountRow[],
    money: MoneyRow[],
    groupOf: (base: string | null) => string | null,
    labelOf: (key: string | null) => string,
) {
    const NONE = '\u0000none';
    const byKey = new Map<string, { counts: StatusCounts; money: Money }>();
    const at = (base: string | null) => {
        const key = groupOf(base) ?? NONE;
        let g = byKey.get(key);
        if (!g) {
            g = { counts: emptyCounts(), money: emptyMoney() };
            byKey.set(key, g);
        }
        return g;
    };

    for (const r of counts) at(r.base).counts[r.status] += r.count;
    for (const r of money) {
        const g = at(r.base);
        g.money.payable += r.payable;
        g.money.paid += r.paid;
        g.money.penalty += r.penalty;
    }

    const rows: SummaryRow[] = [];
    const totals = emptyCounts();
    const totalMoney = emptyMoney();
    for (const [k, g] of byKey) {
        if (totalOf(g.counts) === 0) continue; // money without items cannot happen, but skip it anyway
        const key = k === NONE ? null : k;
        rows.push(finish(key, labelOf(key), g.counts, g.money));
        addInto(totals, g.counts);
        totalMoney.payable += g.money.payable;
        totalMoney.paid += g.money.paid;
        totalMoney.penalty += g.money.penalty;
    }

    // Items with no value (no department, say) come last
    rows.sort(
        (a, b) =>
            Number(a.key === null) - Number(b.key === null) ||
            b.counts.nonCompliance - a.counts.nonCompliance ||
            b.total - a.total ||
            a.label.localeCompare(b.label),
    );

    return { rows, totals: finish(null, 'Total', totals, totalMoney) };
}