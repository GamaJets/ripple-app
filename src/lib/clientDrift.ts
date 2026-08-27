// Coach · the client book, ordered by who is breaking their own pattern.
//
// Framework-agnostic on purpose — the pure rules take plain data and the one
// read takes the Supabase client as an argument, so a phone screen and the web
// console can both use it and neither owns it. See src/lib/gymVisits.ts for the
// same shape.
//
// ── What "drifting" means here, and why ────────────────────────────────────
//
// Drift is a CHANGE, not a level. A client who trains twice a week and always
// has is not drifting. A client who trained four times a week and now trains
// once is, even though they are still the more active of the two. So every
// verdict below is measured against that person's OWN earlier rate, never
// against a fixed target — an absolute threshold would rank the whole book by
// how keen its members are, which the coach already knows.
//
// The unit is ACTIVE DAYS PER WEEK, not events per week, matching
// `streaks.activeDays`: logging five exercises in one session is one day of
// training, and counting it as five would let a single busy evening hide a
// month of silence.
//
// ── The trap this module exists to avoid ───────────────────────────────────
//
// A client with no data at all must never rank as "fine". Absence of evidence
// is the commonest way a client silently leaves, and an average over an empty
// set makes them look identical to somebody perfect. So:
//
//   · there is no baseline unless the record actually shows one. No pattern,
//     no verdict — the client comes back UNKNOWN, with the reason saying what
//     was missing;
//   · UNKNOWN sorts SECOND, directly under the clients who are measurably
//     drifting, never last. `STATUS_RANK` in status.ts puts `idle` last, and
//     that is right there: a trainer with no sessions on their employer's
//     dashboard is "nothing to assess". It is wrong here. On a coach's own
//     book the absence IS the signal, and burying it is the bug;
//   · every derived rate is null when its window was never observed. A rate
//     over zero opportunities is not 0/week and not 100% — it is unknown.
//
// This is the same failure `atRiskClient` in trainerMock.ts still has: a client
// with `adherence: null` and `lastActive: 'no activity yet'` fails both of its
// clauses and is reported as not at risk.
import { STATUS_LABEL, STATUS_RANK, statusFromRisk, type StatusLevel } from './status';

type Queryable = { from: (table: string) => any };

const DAY = 86_400_000;

/** Where a sign of life came from. All four count the same toward drift — the
 *  kind is kept so a screen can say which sources are silent. */
export type ActivityKind = 'check_in' | 'workout' | 'session' | 'visit';

export interface ActivityEvent {
  /** ISO timestamp of the thing the client did. */
  at: string;
  kind: ActivityKind;
}

export interface DriftInput {
  clientId: string;
  /**
   * Everything the record knows this client did, over at least `historyDays`.
   * An empty array means NOTHING WAS RECORDED — it does not mean zero activity,
   * and this module never treats the two as the same.
   */
  events: ActivityEvent[];
  /** When the client joined the book, if known. Null when it is not. */
  since?: string | null;
}

export interface DriftWindows {
  /** The near window whose rate is compared against the baseline. */
  recentDays: number;
  /** How far back the record is read. The baseline is what lies between. */
  historyDays: number;
}

/**
 * Two weeks near, the six before it as the baseline.
 *
 * Two weeks rather than one because a single quiet week is a holiday, not a
 * trend, and a coach chasing noise stops reading the list. Six weeks of
 * baseline because that is long enough for a weekly rhythm to be a rhythm.
 */
export const DEFAULT_WINDOWS: DriftWindows = { recentDays: 14, historyDays: 56 };

/** A baseline shorter than this is a first impression, not a pattern. */
export const MIN_BASELINE_SPAN_DAYS = 21;
/** Fewer active days than this in the baseline is not a rhythm to break. */
export const MIN_BASELINE_ACTIVE_DAYS = 3;
/** A weekly rate cannot be stated from less than a week of observation. */
const MIN_RATE_SPAN_DAYS = 7;

/** Fall from their own baseline at which the book calls it drifting. */
const AT_RISK_DROP = 0.6;
/** …and at which it is worth a look. */
const WATCH_DROP = 0.3;

export interface Drift {
  clientId: string;
  /** The settled product scale (status.ts). `idle` is this module's UNKNOWN. */
  status: StatusLevel;
  /** True when nothing could be assessed. The coach must find out, not assume. */
  unknown: boolean;
  /** Active days per week in the near window. Null when under a week observed. */
  recentPerWeek: number | null;
  /** Active days per week across their own baseline. Null when they have none. */
  baselinePerWeek: number | null;
  /** Fall from baseline as a fraction: 0.75 = doing a quarter of what they did.
   *  Negative when they are doing more. Null when there is no baseline. */
  drop: number | null;
  /** Active days per week lost. Negative when gained. Null with no baseline. */
  lostPerWeek: number | null;
  /** Ranking key, 0..1 — `drop` with a rise clamped to 0. Null when unknown. */
  score: number | null;
  /** Days since the newest event GIVEN. Null when the window held none — which
   *  is not the same as "never": it is silence across everything we read. */
  quietDays: number | null;
  /** Days of record this client has, from `since` or their first event. */
  observedDays: number | null;
  /** How long they have been silent, for ordering the unknown band. Null when
   *  even that is unknowable. */
  silentDays: number | null;
  recentActiveDays: number;
  baselineActiveDays: number;
  /** Length of the baseline window actually available. Null when none. */
  baselineSpanDays: number | null;
  /** Which sources produced anything at all, for "no check-ins, no logs". */
  kinds: ActivityKind[];
  /** Short, human, and true about the record rather than about the person. */
  reason: string;
}

/**
 * The book's ordering. Built from STATUS_RANK and differing from it in exactly
 * one place, deliberately: `idle` moves from last to second.
 *
 * STATUS_RANK is right for the owner's trainer list, where `idle` means there
 * is nothing to assess and floating it up would bury the rows that need action.
 * On a coach's own client book the opposite holds — a client the record knows
 * nothing about is the one most likely to already be gone.
 */
export const DRIFT_RANK: Record<StatusLevel, number> = {
  ...STATUS_RANK,
  at_risk: 0,
  idle: 1,
  watch: 2,
  on_track: 3,
};

/**
 * The book's labels. STATUS_LABEL's three concern levels are reused verbatim;
 * only `idle` is re-worded, because "Idle" printed beside a client's name reads
 * as a verdict about them, when what is actually true is that we do not know.
 */
export const DRIFT_LABEL: Record<StatusLevel, string> = {
  ...STATUS_LABEL,
  idle: 'Unknown',
};

/* ── pure rules (no database, so they are testable and shared) ─────────────── */

/** LOCAL calendar day, matching streaks.ts: an evening session belongs to that
 *  evening, not to the next UTC day. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parsed(events: ActivityEvent[]): { at: number; kind: ActivityKind }[] {
  const out: { at: number; kind: ActivityKind }[] = [];
  for (const e of events) {
    const at = Date.parse(e.at);
    if (Number.isNaN(at)) continue;   // an unreadable date is not a day of training
    out.push({ at, kind: e.kind });
  }
  return out;
}

function activeDaysIn(evs: { at: number }[], fromMs: number, toMs: number): number {
  const days = new Set<string>();
  for (const e of evs) if (e.at >= fromMs && e.at < toMs) days.add(dayKey(e.at));
  return days.size;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Assess one client against their own record.
 *
 * `now` and `windows` are arguments rather than ambient so the result is
 * reproducible in a test and identical on every screen that asks.
 */
export function assessDrift(
  input: DriftInput,
  now: number = Date.now(),
  windows: DriftWindows = DEFAULT_WINDOWS,
): Drift {
  const evs = parsed(input.events);
  const kinds = [...new Set(evs.map((e) => e.kind))].sort() as ActivityKind[];

  const recentStart = now - windows.recentDays * DAY;
  const historyStart = now - windows.historyDays * DAY;

  const sinceMs = input.since ? Date.parse(input.since) : NaN;
  const firstEvent = evs.length ? Math.min(...evs.map((e) => e.at)) : null;
  const lastEvent = evs.length ? Math.max(...evs.map((e) => e.at)) : null;

  // When their record begins. `since` and the first event can disagree; take
  // the earlier, because an event is proof they existed by then.
  const starts: number[] = [];
  if (!Number.isNaN(sinceMs)) starts.push(sinceMs);
  if (firstEvent != null) starts.push(firstEvent);
  const recordFrom = starts.length ? Math.min(...starts) : null;

  const observedDays = recordFrom == null ? null : Math.max(0, Math.floor((now - recordFrom) / DAY));
  const quietDays = lastEvent == null ? null : Math.max(0, Math.floor((now - lastEvent) / DAY));
  // How long they have been silent. With nothing recorded, silence runs for as
  // long as they have been on the book — which is exactly the figure that
  // orders the unknown band.
  const silentDays = quietDays != null ? quietDays : observedDays;

  const recentFrom = Math.max(recentStart, recordFrom ?? recentStart);
  const recentSpanDays = (now - recentFrom) / DAY;
  const recentActiveDays = activeDaysIn(evs, recentFrom, now + 1);
  const recentPerWeek =
    recentSpanDays >= MIN_RATE_SPAN_DAYS ? round1(recentActiveDays / (recentSpanDays / 7)) : null;

  const baselineFrom = Math.max(historyStart, recordFrom ?? historyStart);
  const rawSpan = (recentStart - baselineFrom) / DAY;
  const baselineSpanDays = rawSpan > 0 ? round1(rawSpan) : null;
  const baselineActiveDays = baselineSpanDays == null ? 0 : activeDaysIn(evs, baselineFrom, recentStart);
  const hasBaseline =
    baselineSpanDays != null &&
    baselineSpanDays >= MIN_BASELINE_SPAN_DAYS &&
    baselineActiveDays >= MIN_BASELINE_ACTIVE_DAYS;
  // Never a zero: an unobserved baseline has no rate, and `hasBaseline`
  // guarantees the denominator below is a real, measured span.
  const baselinePerWeek = hasBaseline ? round1(baselineActiveDays / (baselineSpanDays! / 7)) : null;

  const base: Omit<Drift, 'status' | 'unknown' | 'reason'> = {
    clientId: input.clientId,
    recentPerWeek,
    baselinePerWeek,
    drop: null,
    lostPerWeek: null,
    score: null,
    quietDays,
    observedDays,
    silentDays,
    recentActiveDays,
    baselineActiveDays,
    baselineSpanDays,
    kinds,
  };

  // ── nothing to compare against: UNKNOWN, and it says why ────────────────
  if (baselinePerWeek == null || recentPerWeek == null) {
    return {
      ...base,
      status: statusFromRisk('idle'),
      unknown: true,
      reason: unknownReason(base, windows, evs.length),
    };
  }

  const drop = round1(((baselinePerWeek - recentPerWeek) / baselinePerWeek) * 100) / 100;
  const risk = drop >= AT_RISK_DROP ? 'high' : drop >= WATCH_DROP ? 'watch' : 'ok';
  return {
    ...base,
    drop,
    lostPerWeek: round1(baselinePerWeek - recentPerWeek),
    score: Math.max(0, Math.min(1, drop)),
    status: statusFromRisk(risk),
    unknown: false,
    reason: measuredReason(baselinePerWeek, recentPerWeek, drop, quietDays),
  };
}

function unknownReason(
  d: Omit<Drift, 'status' | 'unknown' | 'reason'>,
  windows: DriftWindows,
  eventCount: number,
): string {
  if (eventCount === 0) {
    if (d.observedDays != null) {
      return `Nothing recorded in ${d.observedDays} day${d.observedDays === 1 ? '' : 's'} on your book — no check-ins, no logged workouts, no visits.`;
    }
    return `Nothing recorded in the last ${windows.historyDays} days — no check-ins, no logged workouts, no visits.`;
  }
  if (d.baselineSpanDays == null || d.baselineSpanDays < MIN_BASELINE_SPAN_DAYS) {
    const days = d.observedDays ?? Math.round(d.baselineSpanDays ?? 0);
    return `Only ${days} day${days === 1 ? '' : 's'} of record — too little to say whether anything has changed.`;
  }
  if (d.baselineActiveDays < MIN_BASELINE_ACTIVE_DAYS) {
    return `${d.baselineActiveDays} active day${d.baselineActiveDays === 1 ? '' : 's'} before the last ${windows.recentDays} — no settled pattern to compare against.`;
  }
  return `Not enough of a record to judge a change.`;
}

function measuredReason(base: number, recent: number, drop: number, quietDays: number | null): string {
  const pct = Math.round(drop * 100);
  if (recent === 0) {
    const q = quietDays == null ? null : quietDays;
    const was = `was ${base} day${base === 1 ? '' : 's'} a week`;
    return q == null
      ? `Nothing at all lately — ${was}.`
      : `Nothing for ${q} day${q === 1 ? '' : 's'} — ${was}.`;
  }
  if (drop >= WATCH_DROP) return `Down from ${base} to ${recent} days a week — ${pct}% below their own pattern.`;
  if (drop <= -0.15) return `Up from ${base} to ${recent} days a week.`;
  return `Holding at about ${recent} days a week (was ${base}).`;
}

/**
 * Compare two assessments for the book's order: worst first.
 *
 * Within a band the bigger break leads, then the bigger absolute loss — of two
 * clients equally far down on their own scale, the one who lost three sessions
 * a week is the call to make before the one who lost half of one. Within the
 * unknown band the longest silence leads, and a client we cannot even date
 * leads that, because they are the ones we know least about.
 */
export function compareDrift(a: Drift, b: Drift): number {
  const r = DRIFT_RANK[a.status] - DRIFT_RANK[b.status];
  if (r !== 0) return r;
  if (a.unknown && b.unknown) {
    if (a.silentDays == null && b.silentDays != null) return -1;
    if (b.silentDays == null && a.silentDays != null) return 1;
    if (a.silentDays != null && b.silentDays != null && a.silentDays !== b.silentDays) {
      return b.silentDays - a.silentDays;
    }
    return a.clientId.localeCompare(b.clientId);
  }
  const sa = a.score ?? -1, sb = b.score ?? -1;
  if (sa !== sb) return sb - sa;
  const la = a.lostPerWeek ?? -1, lb = b.lostPerWeek ?? -1;
  if (la !== lb) return lb - la;
  const qa = a.quietDays ?? -1, qb = b.quietDays ?? -1;
  if (qa !== qb) return qb - qa;
  return a.clientId.localeCompare(b.clientId);
}

/** The book in drift order. Does not mutate the caller's array. */
export function sortByDrift(list: Drift[]): Drift[] {
  return list.slice().sort(compareDrift);
}

/** Assess a whole book and order it. */
export function rankClients(
  inputs: DriftInput[],
  now: number = Date.now(),
  windows: DriftWindows = DEFAULT_WINDOWS,
): Drift[] {
  return sortByDrift(inputs.map((i) => assessDrift(i, now, windows)));
}

export interface DriftSummary {
  total: number;
  drifting: number;
  watch: number;
  unknown: number;
  steady: number;
}

/**
 * Band counts for a header.
 *
 * Null in means null out: "not read yet" is not "nobody is drifting", and a
 * screen that prints 0 for the first has told the coach everyone is fine.
 */
export function summariseDrift(list: Drift[] | null): DriftSummary | null {
  if (list == null) return null;
  let drifting = 0, watch = 0, unknown = 0, steady = 0;
  for (const d of list) {
    if (d.status === 'at_risk') drifting++;
    else if (d.status === 'idle') unknown++;
    else if (d.status === 'watch') watch++;
    else steady++;
  }
  return { total: list.length, drifting, watch, unknown, steady };
}

/** The heading a band gets in the book. */
export function bandTitle(status: StatusLevel): string {
  switch (status) {
    case 'at_risk': return 'Drifting';
    case 'idle': return 'Nothing recorded';
    case 'watch': return 'Slipping';
    default: return 'Holding their pattern';
  }
}

/** What a band means, said once under its heading rather than on every row. */
export function bandNote(status: StatusLevel, windows: DriftWindows = DEFAULT_WINDOWS): string {
  switch (status) {
    case 'at_risk': return `Well below their own rate over the last ${windows.recentDays} days.`;
    case 'idle': return 'No pattern to judge. Not the same as fine — find out which.';
    case 'watch': return 'Down on their own rate, but not yet far.';
    default: return 'Doing about as much as they always have.';
  }
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

export interface ActivityQuery {
  /** How far back to read. Defaults to the drift history window. */
  days?: number;
  /** The gym, when there is one. Without it the door log is not read at all —
   *  it is tenant-scoped, and reading it unscoped is how `gym_classes` leaked. */
  tenantId?: string | null;
  now?: number;
}

/**
 * Every sign of life for a set of clients, keyed by client id.
 *
 * A client with nothing gets an empty array, NOT a missing key — the caller
 * must be able to tell "read, and there was nothing" from "not asked about".
 *
 * supabase-js resolves on a database error, so every `.error` is checked and
 * thrown rather than left to arrive as an empty list. An empty list and a
 * failed read mean opposite things here: one says the client is silent, the
 * other says we do not know, and the difference is the whole feature.
 */
/**
 * Whether an id is something the database can be asked about.
 *
 * A client added by hand on the trainer's phone gets a local id like `c900`.
 * Those columns are `uuid`, and Postgres does not skip a value it cannot
 * parse — it refuses the entire statement:
 *
 *     invalid input syntax for type uuid: "c900"
 *
 * which was reaching a coach on the dashboard as a raw database error, with
 * drift ordering switched off for as long as one hand-added client was on the
 * roster. Seen in the simulator with a roster of exactly one.
 */
export function isQueryableId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());
}

export async function fetchClientActivity(
  sb: Queryable,
  clientIds: string[],
  opts: ActivityQuery = {},
): Promise<Record<string, ActivityEvent[]>> {
  const out: Record<string, ActivityEvent[]> = {};
  for (const id of clientIds) out[id] = [];
  if (!clientIds.length) return out;

  // Everyone keeps their entry in `out`; only the ones the database can answer
  // for are asked about. Somebody with no Repple account has no server-side
  // activity by definition, and an empty list is the truthful answer for them —
  // it flows into the same "nothing recorded" state the roster already shows,
  // rather than taking the whole read down with it.
  const askable = clientIds.filter(isQueryableId);
  if (!askable.length) return out;

  const now = opts.now ?? Date.now();
  const days = opts.days ?? DEFAULT_WINDOWS.historyDays;
  const sinceIso = new Date(now - days * DAY).toISOString();

  const push = (id: string | null, at: string | null, kind: ActivityKind) => {
    if (!id || !at || !out[id]) return;
    out[id].push({ at, kind });
  };

  const ci = await sb.from('check_ins').select('user_id, at').in('user_id', askable).gte('at', sinceIso);
  if (ci.error) throw ci.error;
  for (const r of ci.data ?? []) push(r.user_id, r.at, 'check_in');

  const wo = await sb.from('workouts').select('user_id, performed_at').in('user_id', askable).gte('performed_at', sinceIso);
  if (wo.error) throw wo.error;
  for (const r of wo.data ?? []) push(r.user_id, r.performed_at, 'workout');

  // Only sessions somebody confirmed took place. A booked slot whose clock has
  // passed is not evidence the client turned up — that inference is the bug
  // 33-session-outcomes.sql was written to end, and it would read here as a
  // client still attending when they had stopped.
  const se = await sb.from('sessions').select('client_id, starts_at, outcome').in('client_id', askable).gte('starts_at', sinceIso).eq('outcome', 'completed');
  if (se.error) throw se.error;
  for (const r of se.data ?? []) push(r.client_id, r.starts_at, 'session');

  if (opts.tenantId) {
    const vi = await sb.from('gym_visits').select('member_id, entered_at').eq('tenant_id', opts.tenantId).in('member_id', askable).gte('entered_at', sinceIso);
    if (vi.error) throw vi.error;
    for (const r of vi.data ?? []) push(r.member_id, r.entered_at, 'visit');
  }

  return out;
}
