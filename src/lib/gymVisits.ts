// The door log — who came in, when, and how long they stayed.
//
// Framework-agnostic on purpose — it takes the Supabase client as an argument,
// so the web console and the phone app can both use it and neither owns it.
// See src/lib/gymRecord.ts for the same shape.
//
// Why this exists: attendance was only counted where a class was booked and
// ticked off, so every member who walks in, trains on the floor and leaves was
// invisible. That under-count reaches further than the headline figure —
// retention is inferred from attendance pattern breaks, so a member who moved
// from classes to the floor looked exactly like a member who stopped coming.

import { assertWhole, capLimit } from './rowCap';
import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any };

export type VisitSource = 'desk' | 'qr' | 'door' | 'app' | 'manual';

export interface Visit {
  id: string;
  memberId: string | null;
  memberName: string | null;
  passId: string | null;
  classId: string | null;
  enteredAt: string;
  /** Null means still inside, or nobody recorded an exit. Not zero minutes. */
  exitedAt: string | null;
  source: VisitSource;
  note: string | null;
}

/* ── pure rules (no database, so they are testable and shared) ─────────────── */

/**
 * How long a visit lasted, in minutes. Null when there is no exit — the visitor
 * may still be inside, or the door may simply not record exits.
 *
 * Returns null rather than 0 for an unfinished visit, because a gym reading
 * "average stay: 4 minutes" caused by counting open visits as zero will draw a
 * conclusion about its layout that the data never supported.
 */
export function dwellMinutes(v: Pick<Visit, 'enteredAt' | 'exitedAt'>): number | null {
  if (!v.exitedAt) return null;
  const a = Date.parse(v.enteredAt);
  const b = Date.parse(v.exitedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const mins = (b - a) / 60000;
  // The table forbids a negative dwell, but a clock-skewed terminal writing
  // directly could still produce one. Refuse it rather than average it in.
  return mins < 0 ? null : Math.round(mins);
}

/**
 * Mean dwell in minutes across the visits that actually recorded an exit.
 *
 * `closed` reports how many of `total` could be measured, so a screen can say
 * "48 min, from 210 of 380 visits" instead of implying it measured them all.
 */
export function averageDwellMinutes(
  visits: Pick<Visit, 'enteredAt' | 'exitedAt'>[],
): { minutes: number | null; closed: number; total: number } {
  let sum = 0;
  let closed = 0;
  for (const v of visits) {
    const d = dwellMinutes(v);
    if (d == null) continue;
    sum += d;
    closed += 1;
  }
  return { minutes: closed === 0 ? null : Math.round(sum / closed), closed, total: visits.length };
}

/** Visits that have no recorded exit — who the gym believes is inside now. */
export function currentlyInside(visits: Visit[]): Visit[] {
  return visits.filter((v) => !v.exitedAt);
}

/** ISO date (YYYY-MM-DD) of a visit, in the viewer's timezone. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  // Local, not UTC: a gym's "Tuesday" is its own Tuesday. A 22:00 visit in
  // Dubai belongs to that evening, not to the next UTC day.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Visit counts per calendar day, oldest first. Days with no visits are absent. */
export function visitsPerDay(visits: Pick<Visit, 'enteredAt'>[]): { day: string; visits: number }[] {
  const byDay = new Map<string, number>();
  for (const v of visits) byDay.set(dayOf(v.enteredAt), (byDay.get(dayOf(v.enteredAt)) ?? 0) + 1);
  return [...byDay.entries()]
    .map(([day, n]) => ({ day, visits: n }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Visit counts by hour of the day, 0–23, every hour present.
 *
 * Every hour is included even at zero, because the shape of a day is the point:
 * a gap at 14:00 is information, and omitting it would let a chart draw a line
 * straight through the quiet hours as though they were busy.
 */
export function visitsByHour(visits: Pick<Visit, 'enteredAt'>[]): { hour: number; visits: number }[] {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, visits: 0 }));
  for (const v of visits) {
    const h = new Date(v.enteredAt).getHours();
    if (h >= 0 && h < 24) hours[h].visits += 1;
  }
  return hours;
}

/**
 * The busiest hour, or null when there is nothing to rank.
 *
 * Ties go to the earlier hour: told two slots are equally busy, a gym should
 * look at the one it reaches first in the day.
 */
export function peakHour(visits: Pick<Visit, 'enteredAt'>[]): { hour: number; visits: number } | null {
  if (visits.length === 0) return null;
  const byHour = visitsByHour(visits);
  let best = byHour[0];
  for (const h of byHour) if (h.visits > best.visits) best = h;
  return best.visits === 0 ? null : best;
}

/** Distinct identified members. Anonymous head-counts are excluded by design. */
export function uniqueMembers(visits: Pick<Visit, 'memberId'>[]): number {
  const seen = new Set<string>();
  for (const v of visits) if (v.memberId) seen.add(v.memberId);
  return seen.size;
}

export interface VisitSummary {
  visits: number;
  /** Visits that could not be attributed to a member. */
  anonymous: number;
  uniqueMembers: number;
  /** Mean visits per member, or null when nobody was identified. */
  visitsPerMember: number | null;
  averageDwell: number | null;
  /** How many visits the dwell average was computed from. */
  dwellFrom: number;
  peak: { hour: number; visits: number } | null;
  inside: number;
}

/** The door-log picture for a period. */
export function summariseVisits(visits: Visit[]): VisitSummary {
  const members = uniqueMembers(visits);
  const anonymous = visits.filter((v) => !v.memberId).length;
  const dwell = averageDwellMinutes(visits);
  return {
    visits: visits.length,
    anonymous,
    uniqueMembers: members,
    // Averaging over zero members would be a divide-by-zero dressed as insight.
    visitsPerMember: members === 0 ? null : Math.round(((visits.length - anonymous) / members) * 10) / 10,
    averageDwell: dwell.minutes,
    dwellFrom: dwell.closed,
    peak: peakHour(visits),
    inside: currentlyInside(visits).length,
  };
}

/**
 * Days since each member was last seen, for the retention view.
 *
 * Members absent from `visits` are absent here too — this reports on the log,
 * not on the membership list. Joining the two is the caller's job, and it is
 * the caller who knows which members are frozen or cancelled.
 */
export function lastSeenDays(
  visits: Pick<Visit, 'memberId' | 'enteredAt'>[],
  today: number = Date.now(),
): { memberId: string; days: number }[] {
  const latest = new Map<string, number>();
  for (const v of visits) {
    if (!v.memberId) continue;
    const t = Date.parse(v.enteredAt);
    if (Number.isNaN(t)) continue;
    if (!latest.has(v.memberId) || t > latest.get(v.memberId)!) latest.set(v.memberId, t);
  }
  return [...latest.entries()]
    .map(([memberId, t]) => ({ memberId, days: Math.max(0, Math.floor((today - t) / 86400000)) }))
    .sort((a, b) => b.days - a.days || a.memberId.localeCompare(b.memberId));
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * The door log for a gym, newest first.
 *
 * Capped through src/lib/rowCap.ts, and this is the read that most needed it.
 * Every caller is in the web console and every one of them turns these rows
 * into a figure somebody acts on: "Inside now" and "Visits today" on the
 * Overview, the conversion rate on Passes, the visits-per-month series on
 * Analytics, and — worst of the four — `lastSeenDays` on Retention, which names
 * a member and says how long it has been since they came in.
 *
 * PostgREST stops at 1000 rows and says nothing, and the order here is
 * `entered_at desc`, so a truncated read keeps the most RECENT thousand visits
 * and drops the older ones. Every member whose last visit fell off the end then
 * looks like a member who has never been through the door: the retention board
 * bands them as lost and the owner rings somebody who trained on Tuesday. That
 * is not a smaller number, it is a false statement about a named person, so the
 * read refuses rather than reporting it.
 *
 * An explicit `limit` is the caller deliberately asking for a prefix — a "last
 * ten arrivals" strip — and is left alone: a set you asked to be cut off is not
 * a set that was cut off behind your back.
 */
export async function fetchVisits(
  sb: Queryable,
  tenantId: string,
  opts: { sinceIso?: string; limit?: number } = {},
): Promise<Visit[]> {
  let q = sb
    .from('gym_visits')
    .select('id, member_id, pass_id, class_id, entered_at, exited_at, source, note, profiles(full_name)')
    .eq('tenant_id', tenantId)
    .order('entered_at', { ascending: false });
  if (opts.sinceIso) q = q.gte('entered_at', opts.sinceIso);
  q = q.limit(opts.limit ?? capLimit());
  const { data, error } = await q;
  if (error) throw error;
  const rows = opts.limit
    ? (data ?? [])
    : assertWhole(data, opts.sinceIso ? 'visits in this period' : "this gym's door log");
  return rows.map(rowToVisit);
}

function rowToVisit(r: any): Visit {
  const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  return {
    id: r.id,
    memberId: r.member_id ?? null,
    memberName: p?.full_name ?? null,
    passId: r.pass_id ?? null,
    classId: r.class_id ?? null,
    enteredAt: r.entered_at,
    exitedAt: r.exited_at ?? null,
    source: r.source ?? 'desk',
    note: r.note ?? null,
  };
}

/* ── writes ────────────────────────────────────────────────────────────────── */

export interface CheckIn {
  memberId?: string | null;
  passId?: string | null;
  classId?: string | null;
  source?: VisitSource;
  note?: string | null;
  enteredAtIso?: string;
}

/** Record an arrival. An anonymous check-in is allowed and still counts. */
export async function checkIn(sb: Queryable, tenantId: string, v: CheckIn = {}): Promise<void> {
  const { error } = await sb.from('gym_visits').insert({
    tenant_id: tenantId,
    member_id: v.memberId ?? null,
    pass_id: v.passId ?? null,
    class_id: v.classId ?? null,
    entered_at: v.enteredAtIso ?? new Date().toISOString(),
    source: v.source ?? 'desk',
    note: v.note ?? null,
  });
  if (error) throw error;
}

/**
 * Record a departure against an open visit.
 *
 * The count is checked, not `error` alone — see src/lib/wroteRows.ts. This
 * update has TWO ways to match zero rows and neither of them is an error:
 * `gym_visits_staff_u` is `tenant_id = my_tenant() AND my_role() in (trainer,
 * owner)`, so anyone else's click is filtered away silently; and the
 * `exited_at is null` guard below means a visit somebody already closed at the
 * other desk matches nothing either. Without the count the desk saw the row
 * reload unchanged, clicked Check out again, and read the gym as slow rather
 * than as refusing.
 */
export async function checkOut(sb: Queryable, visitId: string, exitedAtIso?: string): Promise<void> {
  const r = await sb
    .from('gym_visits')
    .update({ exited_at: exitedAtIso ?? new Date().toISOString() }, { count: 'exact' })
    .eq('id', visitId)
    // Only close a visit that is actually open, so a re-scan at the door cannot
    // overwrite a departure already recorded.
    .is('exited_at', null);
  assertWrote('That check-out', r);
}

/**
 * Close visits left open past `hours` — the ones where somebody left without
 * scanning out.
 *
 * These are deliberately closed with a null exit rather than a guessed time:
 * the note records that it was swept, and `averageDwellMinutes` continues to
 * ignore them. Stamping a plausible exit would quietly corrupt every dwell
 * figure built afterwards.
 */
export async function sweepStaleVisits(
  sb: Queryable,
  tenantId: string,
  hours = 12,
): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await sb
    .from('gym_visits')
    .update({ note: 'auto-closed: no exit recorded' })
    .eq('tenant_id', tenantId)
    .is('exited_at', null)
    .lt('entered_at', cutoff)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}
