import type { InstanceStatus } from '@prisma/client';

export type StatusCounts = {
    nonCompliance: number;
    lateClosure: number;
    onTime: number;
    due: number;
    notApplicable: number;
    pendingApproval: number;
};

export const emptyCounts = (): StatusCounts => ({
    nonCompliance: 0,
    lateClosure: 0,
    onTime: 0,
    due: 0,
    notApplicable: 0,
    pendingApproval: 0,
});

export const totalOf = (c: StatusCounts) =>
    c.nonCompliance + c.lateClosure + c.onTime + c.due + c.notApplicable + c.pendingApproval;

export function addInto(target: StatusCounts, src: StatusCounts) {
    for (const k of Object.keys(target) as (keyof StatusCounts)[]) target[k] += src[k];
}

export const percentOf = (count: number, total: number) =>
    total === 0 ? 0 : Math.round((count / total) * 1000) / 10;

export type DayRow = { due: string; status: InstanceStatus; count: number };
export type LateRow = { due: string; count: number };

// Turns "how many items per due date and stored status" into dashboard counts per due date.
// `late` is how many closed items per due date were closed after the due date.
export function countsByDay(rows: DayRow[], late: LateRow[], today: string) {
    const days = new Map<string, StatusCounts>();
    const at = (due: string) => {
        let c = days.get(due);
        if (!c) {
            c = emptyCounts();
            days.set(due, c);
        }
        return c;
    };

    for (const r of rows) {
        const c = at(r.due);
        switch (r.status) {
            case 'NOT_APPLICABLE':
                c.notApplicable += r.count;
                break;
            case 'SUBMITTED':
            case 'MANAGER_APPROVED':
                c.pendingApproval += r.count;
                break;
            case 'CLOSED':
                c.onTime += r.count; // late ones are moved out below
                break;
            default: // DUE and RETURNED: still the owner's to do
                if (r.due < today) c.nonCompliance += r.count;
                else c.due += r.count;
        }
    }

    for (const l of late) {
        const c = at(l.due);
        c.lateClosure += l.count;
        c.onTime = Math.max(0, c.onTime - l.count);
    }
    return days;
}

// Adds up days into groups (months, quarters, years). Return null to skip a day.
export function bucket(days: Map<string, StatusCounts>, keyOf: (due: string) => string | null) {
    const out = new Map<string, StatusCounts>();
    for (const [due, counts] of days) {
        const key = keyOf(due);
        if (key === null) continue;
        let target = out.get(key);
        if (!target) {
            target = emptyCounts();
            out.set(key, target);
        }
        addInto(target, counts);
    }
    return out;
}