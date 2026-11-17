// Who to tell about newly published legal updates. Plain logic with no database, so it is easy to test.
//
// Everyone who follows an Act ("Select for Display") gets one bell notice per batch, however many updates
// the batch has. Those who also ticked "Email Alerts" for one of those Acts get it by email too.
// Old updates (published more than a week ago) never notify, so loading history stays quiet.

export const RECENT_DAYS = 7;
const MAX_LISTED = 5;
const DAY = 86_400_000;

export type PublishedUpdate = { id: string; actId: string; actName: string; title: string; publishedDate: string };
export type Follower = { userId: string; orgId: string; actId: string; emailAlerts: boolean };
export type LegalNotice = { userId: string; orgId: string; title: string; body: string; email: boolean };

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function planLegalNotices(updates: readonly PublishedUpdate[], followers: readonly Follower[], today: string): LegalNotice[] {
    const cutoff = Date.parse(`${today}T00:00:00Z`) - RECENT_DAYS * DAY;
    const recent = updates.filter((u) => Date.parse(`${u.publishedDate}T00:00:00Z`) >= cutoff);
    if (!recent.length) return [];

    const byAct = new Map<string, PublishedUpdate[]>();
    for (const u of recent) byAct.set(u.actId, [...(byAct.get(u.actId) ?? []), u]);

    const perUser = new Map<string, { orgId: string; updates: Map<string, PublishedUpdate>; email: boolean }>();
    for (const f of followers) {
        const list = byAct.get(f.actId);
        if (!list) continue;
        const entry = perUser.get(f.userId) ?? { orgId: f.orgId, updates: new Map(), email: false };
        for (const u of list) entry.updates.set(u.id, u);
        entry.email = entry.email || f.emailAlerts;
        perUser.set(f.userId, entry);
    }

    const out: LegalNotice[] = [];
    for (const [userId, e] of perUser) {
        const list = [...e.updates.values()].sort((a, b) => b.publishedDate.localeCompare(a.publishedDate));
        const title =
            list.length === 1
                ? `Legal update: ${oneLine(list[0].title).slice(0, 180)}`
                : `${list.length} new legal updates for the Acts you follow`;
        const lines = list.slice(0, MAX_LISTED).map((u) => `- ${oneLine(u.title).slice(0, 200)} (${oneLine(u.actName)})`);
        if (list.length > MAX_LISTED) lines.push(`... and ${list.length - MAX_LISTED} more`);
        out.push({ userId, orgId: e.orgId, title, body: `${lines.join('\n')}\nSee them under Legal Update.`, email: e.email });
    }
    return out;
}