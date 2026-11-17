// Reminders for documents nearing their expiry date. Plain logic with no database, so it is easy to test.
//
// A document with an expiry date and alert days gets one reminder at each of these points:
//   when it enters its alert window (alert days before expiry), 7 days before, 1 day before,
//   on the expiry day, and once more just after it expires.
// Points beyond its alert days are skipped. If the job missed some days, only the latest point is sent,
// so nobody gets a pile of reminders at once. A new expiry date starts the reminders again.

const DAY = 86_400_000;
const LATE_NOTICE_DAYS = 7; // the "has expired" reminder is still sent if the job was down for up to a week

export type ExpiringRecord = {
    id: string;
    orgId: string;
    name: string;
    expiryDate: string; // YYYY-MM-DD
    alertDays: number;
    location: string;
    category: string;
    ownerId: string;
    managerId: string | null;
};

export type ExpiryNotice = { recordId: string; orgId: string; userId: string; title: string; body: string; dedupeKey: string };

export const daysBetween = (from: string, to: string) =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

// Which reminder is due today, if any
export function expiryStage(expiryDate: string, alertDays: number, today: string): { stage: string; daysLeft: number } | null {
    const daysLeft = daysBetween(today, expiryDate);
    if (daysLeft < 0) return daysLeft >= -LATE_NOTICE_DAYS ? { stage: 'expired', daysLeft } : null;
    const points = [...new Set([alertDays, 7, 1, 0].filter((t) => t <= alertDays))].sort((a, b) => a - b);
    const reached = points.find((t) => daysLeft <= t);
    return reached === undefined ? null : { stage: `d${reached}`, daysLeft };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pretty = (d: string) => `${d.slice(8, 10)}-${MONTHS[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}`;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function planExpiryNotices(records: readonly ExpiringRecord[], today: string): ExpiryNotice[] {
    const out: ExpiryNotice[] = [];
    for (const r of records) {
        const s = expiryStage(r.expiryDate, r.alertDays, today);
        if (!s) continue;
        const name = oneLine(r.name).slice(0, 150);
        const when =
            s.daysLeft < 0
                ? `expired on ${pretty(r.expiryDate)}`
                : s.daysLeft === 0
                    ? `expires today (${pretty(r.expiryDate)})`
                    : `expires on ${pretty(r.expiryDate)}, in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}`;
        const title =
            s.daysLeft < 0 ? `Document expired: ${name}` : s.daysLeft === 0 ? `Document expires today: ${name}` : `Document expiring in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}: ${name}`;
        const body = `"${name}" (${oneLine(r.category)}, ${oneLine(r.location)}) ${when}. Renew it and upload the new copy in Documents.`;
        const dedupeKey = `doc-expiry:${r.id}:${r.expiryDate}:${s.stage}`;
        for (const userId of new Set([r.ownerId, ...(r.managerId ? [r.managerId] : [])])) {
            out.push({ recordId: r.id, orgId: r.orgId, userId, title, body, dedupeKey });
        }
    }
    return out;
}