import type { InstanceStatus } from '@prisma/client';

// Everything here is plain logic with no database, so it is easy to test.

export type Role = 'OWNER' | 'MANAGER' | 'APPROVER';
export type People = { ownerId: string; managerId: string; approverId: string | null };
export type PeopleOverride = { ownerId?: string; managerId?: string; approverId?: string };
export type Assignment = { ownerId?: string; managerId?: string; approverId?: string };

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---- Copying schedules to another location -----------------------------------------

export function effectivePeople(src: People, o: PeopleOverride): People {
    return {
        ownerId: o.ownerId ?? src.ownerId,
        managerId: o.managerId ?? src.managerId,
        approverId: o.approverId ?? src.approverId,
    };
}

// One person in two roles on the same record
export function collides(p: People): boolean {
    if (p.ownerId === p.managerId) return true;
    return p.approverId !== null && (p.approverId === p.ownerId || p.approverId === p.managerId);
}

export type PeopleProblem = 'SAME_OWNER_MANAGER' | 'APPROVER_NOT_DISTINCT' | 'HIGH_RISK_NO_APPROVER';

export function peopleProblem(p: People, highRisk: boolean): PeopleProblem | null {
    if (p.ownerId === p.managerId) return 'SAME_OWNER_MANAGER';
    if (p.approverId !== null && (p.approverId === p.ownerId || p.approverId === p.managerId)) {
        return 'APPROVER_NOT_DISTINCT';
    }
    if (highRisk && p.approverId === null) return 'HIGH_RISK_NO_APPROVER';
    return null;
}

export type SourceSchedule = {
    complianceId: string;
    risk: string;
    jurisdiction: string; // CENTRAL or STATE
    actName: string;
    actState: string | null;
};

// What copying the source's schedules to one target would do.
// `existing` maps a compliance id to whether the target already has it active.
export function planReplicate<T extends SourceSchedule>(
    sources: T[],
    targetState: string,
    existing: ReadonlyMap<string, boolean>,
) {
    const wrong = new Map<string, number>();
    const toCreate: T[] = [];
    let alreadyActive = 0;
    let alreadyInactive = 0;

    for (const s of sources) {
        if (s.jurisdiction === 'STATE' && s.actState !== targetState) {
            const key = `${s.actName} (${s.actState ?? 'no state'})`;
            wrong.set(key, (wrong.get(key) ?? 0) + 1);
            continue;
        }
        const e = existing.get(s.complianceId);
        if (e === undefined) toCreate.push(s);
        else if (e) alreadyActive++;
        else alreadyInactive++;
    }

    const skippedWrongState = [...wrong]
        .map(([act, count]) => ({ act, count }))
        .sort((a, b) => byCodeUnits(a.act, b.act));
    return { toCreate, alreadyActive, alreadyInactive, skippedWrongState };
}

// ---- Moving one person's work to another -------------------------------------------

export const OWNER_STATUSES: readonly InstanceStatus[] = ['DUE', 'RETURNED'];
export const MANAGER_STATUSES: readonly InstanceStatus[] = ['DUE', 'RETURNED', 'SUBMITTED'];
export const APPROVER_STATUSES: readonly InstanceStatus[] = ['DUE', 'RETURNED', 'SUBMITTED', 'MANAGER_APPROVED'];
const IN_REVIEW: readonly InstanceStatus[] = ['SUBMITTED', 'MANAGER_APPROVED'];

type Allowed = { owner: boolean; manager: boolean; approver: boolean };

// The columns that would change. Every changed column gets the new person.
function wanted(r: People, from: string, to: string, roles: ReadonlySet<Role>, ok: Allowed): Assignment {
    const set: Assignment = {};
    if (ok.owner && roles.has('OWNER') && r.ownerId === from) set.ownerId = to;
    if (ok.manager && roles.has('MANAGER') && r.managerId === from) set.managerId = to;
    if (ok.approver && roles.has('APPROVER') && r.approverId === from) set.approverId = to;
    return set;
}

const nextPeople = (r: People, set: Assignment): People => ({
    ownerId: set.ownerId ?? r.ownerId,
    managerId: set.managerId ?? r.managerId,
    approverId: set.approverId ?? r.approverId,
});

export type ScheduleRow = People & { id: string };
export type ScheduleMove = { id: string; set: Assignment };

export function planScheduleSwap(rows: ScheduleRow[], from: string, to: string, roles: ReadonlySet<Role>) {
    const moves: ScheduleMove[] = [];
    let conflicts = 0;
    for (const r of rows) {
        const set = wanted(r, from, to, roles, { owner: true, manager: true, approver: true });
        if (Object.keys(set).length === 0) continue;
        if (collides(nextPeople(r, set))) conflicts++;
        else moves.push({ id: r.id, set });
    }
    return { moves, conflicts };
}

export type InstanceRow = People & {
    id: string;
    status: InstanceStatus;
    submittedById: string | null;
    managerActionById: string | null;
};
export type InstanceMove = { id: string; status: InstanceStatus; set: Assignment };

// conflicts: the new person would hold two roles. blocked: the new person would review work they handled.
export function planInstanceSwap(rows: InstanceRow[], from: string, to: string, roles: ReadonlySet<Role>) {
    const moves: InstanceMove[] = [];
    let conflicts = 0;
    let blocked = 0;

    for (const r of rows) {
        const set = wanted(r, from, to, roles, {
            owner: OWNER_STATUSES.includes(r.status),
            manager: MANAGER_STATUSES.includes(r.status),
            approver: APPROVER_STATUSES.includes(r.status),
        });
        if (Object.keys(set).length === 0) continue;

        const next = nextPeople(r, set);
        if (collides(next)) {
            conflicts++;
            continue;
        }
        if (
            IN_REVIEW.includes(r.status) &&
            (next.managerId === r.submittedById ||
                (next.approverId !== null &&
                    (next.approverId === r.submittedById || next.approverId === r.managerActionById)))
        ) {
            blocked++;
            continue;
        }
        moves.push({ id: r.id, status: r.status, set });
    }
    return { moves, conflicts, blocked };
}

// "O", "M", "A" for each column that changes, in that order
export function signatureOf(set: Assignment): string {
    return (set.ownerId ? 'O' : '') + (set.managerId ? 'M' : '') + (set.approverId ? 'A' : '');
}

export function columnsFor(signature: string, value: string): Assignment {
    const out: Assignment = {};
    if (signature.includes('O')) out.ownerId = value;
    if (signature.includes('M')) out.managerId = value;
    if (signature.includes('A')) out.approverId = value;
    return out;
}