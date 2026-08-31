// A coach's OWN sessions — scoped by who delivered them, not by which gym they
// were delivered in.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// src/lib/gymSessions.ts is written from the gym's side and everything in it
// starts `.eq('tenant_id', tenantId)`, which is right for a gym owner looking
// at their floor and wrong for the person who actually delivered the session.
// Two screens in the coach app were reading it that way:
//
//   · app/(trainer)/sessions.tsx — "Mark Sessions", the queue of past sessions
//     whose outcome nobody has recorded.
//   · the UnmarkedSessions card on app/(trainer)/dashboard.tsx.
//
// Both opened with `if (!tenant?.id) return;`. A coach with no gym therefore
// never got past that line: the card silently rendered nothing, which on that
// dashboard means "nothing is outstanding", and the screen — reachable by deep
// link, and by the card when it did appear — sat on "Loading…" for ever,
// because `queue` stays null and null is the screen's not-read-yet state. There
// was no error anywhere, on either screen, in either case.
//
// The independent trainer is not an edge case; he is the demo. He has no gym,
// so he has no tenant, so he could not mark a single session outcome — and
// marking is what the whole payroll and delivery story is built on.
//
// ── Why trainer_id is the right key, and not merely a workaround ───────────
//
// A session belongs to the coach who delivered it whether or not a gym exists.
// `sessions_trainer` in supabase/parts/09-sessions-access.sql has said so since
// the beginning — `for all using (trainer_id = auth.uid())` — so this scoping
// is what row-level security was already enforcing; the tenant filter was an
// extra narrowing the coach app had no reason to apply to its own rows.
// Verified against the live database: that policy is present, `sessions` grants
// select and update to `authenticated`, and a trainer reading by `trainer_id`
// gets their own rows under it.
//
// It is also correct for a coach who DOES have a gym. `sessions.tenant_id` is
// filled by trigger from `trainers.tenant_id` (part 33), so for a gym trainer
// the two scopings return the same rows — except where they do not, and where
// they do not the trainer_id one is the one a coach would expect: a session
// they delivered before joining the gym, or after leaving it, is still theirs
// to mark.
//
// Nothing here is about payroll. Payroll is the gym's question and stays on the
// gym's module, tenant filter and all.
import { assertWhole, capLimit } from './rowCap';
import { isAwaitingOutcome, namesById, sessionProfileIds, type PtSession } from './gymSessions';

type Queryable = { from: (table: string) => any };

/**
 * How far back the marking queue looks.
 *
 * Far enough to catch a forgotten fortnight and then some, short enough that
 * the read stays cheap and the list stays something a person can clear. It was
 * written as `90 * 86400_000` inline in both screens; it is one constant here
 * so the card and the screen it links to cannot come to disagree about what
 * "outstanding" covers — which would show a coach a badge for six sessions and
 * then a list of four.
 */
export const MARK_WINDOW_DAYS = 90;

/**
 * The window the "delivered" figure on the dashboard is counted over.
 *
 * A month, because that is the period a coach thinks in and the one the
 * section it sits in is headed with. Stated rather than inlined for the same
 * reason as above: the figure and the caption under it must be describing the
 * same span.
 */
export const DELIVERED_WINDOW_DAYS = 30;

/** The ISO instant `days` before `now`. */
export function windowStart(days: number, now: number = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString();
}

/**
 * How many of these sessions were actually delivered in the window.
 *
 * "Delivered" is `outcome === 'completed'` and nothing else — the same rule as
 * `isDelivered` in gymSessions, and for the same reason: a booked session whose
 * clock has passed is not a delivered one, and counting it that way is how a
 * gym ends up paying for sessions nobody turned up to.
 *
 * Bounded at BOTH ends. The upper bound is not fussiness: a coach can mark a
 * session before its slot has passed (they finished early, or the slot was
 * mis-scheduled), and a "sessions delivered in the last 30 days" figure that
 * silently included next Tuesday would be reporting the future as history.
 */
export function deliveredBetween(
  sessions: PtSession[],
  sinceMs: number,
  untilMs: number = Date.now(),
): number {
  let n = 0;
  for (const s of sessions) {
    if (s.outcome !== 'completed') continue;
    const at = Date.parse(s.startsAt);
    if (!Number.isFinite(at) || at < sinceMs || at > untilMs) continue;
    n += 1;
  }
  return n;
}

/** Sessions of these that are still waiting for somebody to say what happened. */
export function awaitingOutcome(sessions: PtSession[], now: number = Date.now()): PtSession[] {
  return sessions.filter((s) => isAwaitingOutcome(s, now));
}

/**
 * One `sessions` row as the app models it.
 *
 * A duplicate of the private mapper in gymSessions on purpose — that one is not
 * exported, and reaching into it would couple a coach-side read to a module
 * whose subject is a gym's payroll. The shape is deliberately identical so the
 * two feed the same pure rules.
 */
export function rowToSession(r: any, names: Map<string, string>): PtSession {
  return {
    id: r.id,
    trainerId: r.trainer_id,
    trainerName: names.get(r.trainer_id) ?? null,
    clientId: r.client_id ?? null,
    clientName: r.client_id ? names.get(r.client_id) ?? null : null,
    startsAt: r.starts_at,
    durationMin: r.duration_min ?? 60,
    status: r.status,
    outcome: r.outcome ?? null,
    outcomeAt: r.outcome_at ?? null,
    rateCents: r.rate_cents ?? null,
    settlementId: r.settlement_id ?? null,
  };
}

/**
 * Names for the people these rows name.
 *
 * A failure is not fatal and is deliberately swallowed: a missing name renders
 * as "Client", which is honest, where throwing would deny a coach the whole
 * marking queue over a label. Same call the gym module makes, same reason.
 */
async function fetchNames(sb: Queryable, rows: any[]): Promise<Map<string, string>> {
  const ids = sessionProfileIds(rows);
  if (!ids.length) return new Map();
  const { data, error } = await sb.from('profiles').select('id, full_name').in('id', ids);
  if (error) return new Map();
  return namesById((data ?? []) as Array<{ id: string; full_name?: string | null }>);
}

/**
 * The signed-in coach's own sessions since `sinceIso`.
 *
 * No tenant filter, by design — see the note at the top of this file. Throws on
 * a refused or unreachable read rather than returning [], because every caller
 * turns the result into a COUNT, and an empty list would be read as "nothing
 * outstanding" by a coach about to close the app.
 */
export async function fetchMySessions(
  sb: Queryable,
  trainerId: string,
  sinceIso: string,
  untilIso?: string,
): Promise<PtSession[]> {
  let q = sb
    .from('sessions')
    .select('id, trainer_id, client_id, starts_at, duration_min, status, outcome, outcome_at, rate_cents, settlement_id')
    .eq('trainer_id', trainerId)
    .gte('starts_at', sinceIso)
    .order('starts_at', { ascending: false });
  if (untilIso) q = q.lte('starts_at', untilIso);
  q = q.limit(capLimit());
  const { data, error } = await q;
  if (error) throw error;

  // PostgREST stops at 1,000 rows and says nothing. A truncated set here would
  // hand the dashboard a smaller queue than the coach actually has, with a tick
  // beside it. `assertWhole` turns that silence into the failure it is, and
  // both screens already have a "could not establish this" state to land in.
  const rows = assertWhole(data, 'your sessions in this period') as any[];
  const names = await fetchNames(sb, rows);
  return rows.map((r) => rowToSession(r, names));
}

/* ── writes ────────────────────────────────────────────────────────────────── */

/**
 * Record what happened to one of the coach's OWN sessions, and confirm it
 * landed.
 *
 * ── why this exists next to gymSessions.markOutcome ───────────────────────
 *
 * That one is `update(...).eq('id', id)` and checks only `error`. PostgREST
 * does not error on an UPDATE that matches nothing: a row-level-security
 * refusal, a session id that no longer exists, a session belonging to another
 * coach — all three come back `error: null`, zero rows touched. The Mark
 * Sessions screen then removes the session from the queue, plays its haptic
 * tick, and offers an Undo for a change that was never made. The outcome is
 * still unrecorded, the session reappears at the next launch, and in between
 * the coach has been told twice that it was handled.
 *
 * This is the repo's recurring bug class, so the COUNT is the answer here and
 * a zero-row update throws. The extra `.eq('trainer_id', …)` is not the
 * security boundary — the policy is — but it makes the zero-row case mean
 * something specific instead of arriving as a mystery.
 */
export async function markMyOutcome(
  sb: Queryable,
  trainerId: string,
  sessionId: string,
  outcome: PtSession['outcome'],
  rateCents?: number | null,
): Promise<void> {
  const patch: Record<string, unknown> = { outcome };
  // `undefined` means "do not touch the rate", which is not the same as null,
  // which clears it. A coach with no rate set must not have a zero written in.
  if (rateCents !== undefined) patch.rate_cents = rateCents;
  const { data, error } = await sb
    .from('sessions').update(patch).eq('id', sessionId).eq('trainer_id', trainerId).select('id');
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('That session was not updated — it may no longer exist, or it is not yours to mark.');
  }
}

/** Undo a wrongly recorded outcome. Same zero-row refusal, same reason: an undo
 *  that silently does nothing leaves a "no show" on the record while telling
 *  the coach they took it back. */
export async function clearMyOutcome(
  sb: Queryable,
  trainerId: string,
  sessionId: string,
): Promise<void> {
  const { data, error } = await sb
    .from('sessions').update({ outcome: null }).eq('id', sessionId).eq('trainer_id', trainerId).select('id');
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('That outcome was not cleared — the session may no longer exist, or it is not yours to change.');
  }
}
