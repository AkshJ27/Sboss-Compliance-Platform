import { dueAfterEvent } from './events.engine';
import { dueDateForPeriod } from './schedule.engine';

// Everything here is plain logic with no database, so it is easy to test.

// The fields that decide which dates a schedule produces
export type Rule = {
  frequency: string;
  periodBasis: string;
  dueDay: number | null;
  dueMonthOffset: number;
  event: string | null;
  dueDaysAfterEvent: number | null;
};

export const RULE_FIELDS = [
  'frequency',
  'periodBasis',
  'dueDay',
  'dueMonthOffset',
  'event',
  'dueDaysAfterEvent',
] as const;

export const isRuleField = (field: string) => (RULE_FIELDS as readonly string[]).includes(field);

export function sameRule(a: Rule, b: Rule): boolean {
  return RULE_FIELDS.every((f) => a[f] === b[f]);
}

// ---- What changed -----------------------------------------------------------------

export type FieldChange = { field: string; from: unknown; to: unknown };
export type ChangeView = {
  field: string;
  label: string;
  kind: 'RULE' | 'LIVE'; // RULE changes need a decision. LIVE changes are already visible.
  from: string | null;
  to: string | null;
  opaque: boolean; // the field only holds ids, so its values are not shown
};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Several revisions become one list: the earliest "from" and the latest "to".
// A field that ends where it started is dropped.
export function mergeChanges(revisions: { version: number; changes: unknown }[]): FieldChange[] {
  const merged = new Map<string, FieldChange>();
  for (const rev of [...revisions].sort((a, b) => a.version - b.version)) {
    if (!isObject(rev.changes) || rev.changes.created === true) continue;
    for (const [field, value] of Object.entries(rev.changes)) {
      if (!isObject(value) || !('to' in value)) continue;
      const seen = merged.get(field);
      if (seen) seen.to = value.to ?? null;
      else merged.set(field, { field, from: value.from ?? null, to: value.to ?? null });
    }
  }
  const rank = (f: string) => {
    const i = (RULE_FIELDS as readonly string[]).indexOf(f);
    return i === -1 ? RULE_FIELDS.length : i;
  };
  return [...merged.values()]
    .filter((c) => !sameValue(c.from, c.to))
    .sort((a, b) => rank(a.field) - rank(b.field) || byCodeUnits(a.field, b.field));
}

const LABELS: Record<string, string> = {
  frequency: 'Periodicity',
  periodBasis: 'Period basis',
  dueDay: 'Due day',
  dueMonthOffset: 'Months after the period',
  event: 'Event',
  dueDaysAfterEvent: 'Days after the event',
  risk: 'Risk',
  impact: 'Impact',
  attachment: 'Proof',
  title: 'Title',
  description: 'Description',
  form: 'Form',
  reference: 'Reference',
  penalty: 'Penalty',
  imprisonment: 'Imprisonment possible',
  isActive: 'Status',
  actId: 'Act',
  ruleId: 'Rule',
  natureId: 'Nature',
  typeId: 'Type',
};
const OPAQUE = new Set(['actId', 'ruleId', 'natureId', 'typeId']);

const FREQUENCY_LABEL: Record<string, string> = {
  ONE_TIME: 'One time',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half yearly',
  ANNUAL: 'Annual',
  EVENT_BASED: 'Event based',
};
const BASIS_LABEL: Record<string, string> = {
  FINANCIAL_YEAR: 'Financial year',
  CALENDAR_YEAR: 'Calendar year',
};

export const labelOf = (field: string) => LABELS[field] ?? field;

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function formatValue(field: string, v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (field === 'frequency') return FREQUENCY_LABEL[String(v)] ?? String(v);
  if (field === 'periodBasis') return BASIS_LABEL[String(v)] ?? String(v);
  if (field === 'isActive') return v ? 'Active' : 'Inactive';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  if (field === 'risk' || field === 'impact' || field === 'attachment') return titleCase(s);
  return s.length > 300 ? `${s.slice(0, 297)}...` : s;
}

export function formatChange(c: FieldChange): ChangeView {
  const opaque = OPAQUE.has(c.field);
  return {
    field: c.field,
    label: labelOf(c.field),
    kind: isRuleField(c.field) ? 'RULE' : 'LIVE',
    from: opaque ? null : formatValue(c.field, c.from),
    to: opaque ? null : formatValue(c.field, c.to),
    opaque,
  };
}

// Reads changes that were stored as JSON, ignoring anything that does not look right
export function toChangeViews(raw: unknown): ChangeView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    if (!isObject(x)) return [];
    const field = x.field;
    if (typeof field !== 'string') return [];
    return [formatChange({ field, from: x.from ?? null, to: x.to ?? null })];
  });
}

// ---- Describing a rule in words ----------------------------------------------------

export function describeRule(r: Rule): string {
  const f = FREQUENCY_LABEL[r.frequency] ?? r.frequency;
  if (r.frequency === 'EVENT_BASED') {
    const n = r.dueDaysAfterEvent;
    return `Event based: ${n ?? '?'} day${n === 1 ? '' : 's'} after "${r.event ?? 'the event'}"`;
  }
  if (r.frequency === 'ONE_TIME') {
    return r.dueDay == null ? 'One time, due on the start date' : `One time, day ${r.dueDay}`;
  }
  if (r.dueDay == null) return f;
  const when =
    r.dueMonthOffset === 0
      ? 'in the last month of the period'
      : `${r.dueMonthOffset} month${r.dueMonthOffset === 1 ? '' : 's'} after the period`;
  const basis = r.frequency !== 'MONTHLY' && r.periodBasis === 'CALENDAR_YEAR' ? ', calendar year' : '';
  return `${f}, day ${r.dueDay}, ${when}${basis}`;
}

// ---- Open items -------------------------------------------------------------------

export type OpenItem = { id: string; dueDate: string; periodStart: string; periodEnd: string };
export type Move = { id: string; from: string; to: string };
export type MoveReason = 'NONE' | 'PERIODICITY_CHANGED' | 'ONE_TIME' | 'NO_DUE_RULE';
export type MovePlan = { moves: Move[]; unchanged: number; kept: number; reason: MoveReason };

const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

// What happens to the open items of one schedule when it moves from oldRule to newRule.
// Dates are YYYY-MM-DD. Items that were already submitted or closed are never passed in.
export function planOpenItemMoves(oldRule: Rule, newRule: Rule, items: OpenItem[]): MovePlan {
  if (items.length === 0 || sameRule(oldRule, newRule)) {
    return { moves: [], unchanged: items.length, kept: 0, reason: 'NONE' };
  }
  // The periods themselves would differ, so they cannot be recalculated
  if (oldRule.frequency !== newRule.frequency || oldRule.periodBasis !== newRule.periodBasis) {
    return { moves: [], unchanged: 0, kept: items.length, reason: 'PERIODICITY_CHANGED' };
  }
  if (newRule.frequency === 'ONE_TIME') {
    return { moves: [], unchanged: 0, kept: items.length, reason: 'ONE_TIME' };
  }

  const moves: Move[] = [];
  let unchanged = 0;
  let kept = 0;
  for (const it of items) {
    let target: string | null;
    if (newRule.frequency === 'EVENT_BASED') {
      target =
        newRule.dueDaysAfterEvent === null ? null : dueAfterEvent(it.periodStart, newRule.dueDaysAfterEvent);
    } else {
      const due = dueDateForPeriod(newRule, asDate(it.periodEnd));
      target = due ? due.toISOString().slice(0, 10) : null;
    }
    if (target === null) kept++;
    else if (target === it.dueDate) unchanged++;
    else moves.push({ id: it.id, from: it.dueDate, to: target });
  }
  return { moves, unchanged, kept, reason: kept > 0 ? 'NO_DUE_RULE' : 'NONE' };
}

// ---- What is waiting for a company -------------------------------------------------

export type PinGroup = Rule & { complianceId: string; libraryVersion: number; count: number };
export type LibraryRule = Rule & { id: string; version: number };
export type Pending = {
  id: string;
  version: number;
  fromVersion: number; // the oldest library version any of the schedules still follows
  schedules: number;
  needsDecision: boolean; // true when a schedule's pinned rule differs from the library's
};

// `groups` is how many schedules follow each rule, per law and library version.
// Only schedules that are behind the library count as waiting.
export function summarizePending(groups: PinGroup[], library: LibraryRule[]): Pending[] {
  const current = new Map(library.map((c) => [c.id, c]));
  const out = new Map<string, Pending>();
  for (const g of groups) {
    const lib = current.get(g.complianceId);
    if (!lib || g.libraryVersion >= lib.version) continue;
    let p = out.get(lib.id);
    if (!p) {
      p = { id: lib.id, version: lib.version, fromVersion: g.libraryVersion, schedules: 0, needsDecision: false };
      out.set(lib.id, p);
    }
    p.fromVersion = Math.min(p.fromVersion, g.libraryVersion);
    p.schedules += g.count;
    if (!sameRule(g, lib)) p.needsDecision = true;
  }
  return [...out.values()];
}