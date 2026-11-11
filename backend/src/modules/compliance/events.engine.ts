// Everything here is plain logic with no database, so it is easy to test.

// "Change  of REGISTERED office" and "change of registered office" are the same event
export const normalizeEvent = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// The event date plus a number of calendar days, as YYYY-MM-DD
export function dueAfterEvent(eventDate: string, days: number): string {
    const ms = Date.parse(`${eventDate}T00:00:00Z`) + days * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
}

export type EventGroup = { key: string; label: string; count: number };

// Groups the wordings of one event. The label is the most common wording.
export function groupEvents(names: string[]): EventGroup[] {
    const groups = new Map<string, Map<string, number>>();
    for (const raw of names) {
        const text = tidy(raw);
        if (!text) continue;
        const key = normalizeEvent(text);
        const wordings = groups.get(key) ?? new Map<string, number>();
        wordings.set(text, (wordings.get(text) ?? 0) + 1);
        groups.set(key, wordings);
    }
    return [...groups]
        .map(([key, wordings]) => {
            const ranked = [...wordings].sort(([a, x], [b, y]) => y - x || byCodeUnits(a, b));
            const count = [...wordings.values()].reduce((n, c) => n + c, 0);
            return { key, label: ranked[0][0], count };
        })
        .sort((a, b) => byCodeUnits(a.label, b.label));
}

export type PlanSchedule = {
    id: string;
    event: string | null;
    dueDaysAfterEvent: number | null;
    startDate: string; // YYYY-MM-DD
};
export type PlannedItem = { scheduleId: string; dueDate: string };

// Decides what recording an event would do. `existing` holds the schedules that already
// have an item for this event date.
export function planTrigger(
    schedules: PlanSchedule[],
    key: string,
    eventDate: string,
    existing: ReadonlySet<string>,
) {
    const toCreate: PlannedItem[] = [];
    let matched = 0;
    let alreadyExist = 0;
    let skippedBeforeStart = 0;
    let skippedNoDueDays = 0;

    for (const s of schedules) {
        if (s.event === null || normalizeEvent(s.event) !== key) continue;
        matched++;
        if (s.dueDaysAfterEvent === null) {
            skippedNoDueDays++;
        } else if (s.startDate > eventDate) {
            skippedBeforeStart++; // the obligation did not apply yet when this happened
        } else if (existing.has(s.id)) {
            alreadyExist++;
        } else {
            toCreate.push({ scheduleId: s.id, dueDate: dueAfterEvent(eventDate, s.dueDaysAfterEvent) });
        }
    }
    return { matched, toCreate, alreadyExist, skippedBeforeStart, skippedNoDueDays };
}