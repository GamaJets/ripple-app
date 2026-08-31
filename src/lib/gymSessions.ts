// PT sessions as the gym sees them: what was booked, what was actually
// delivered, and what that costs in payroll.
//
// Framework-agnostic on purpose — it takes the Supabase client as an argument,
// so the web console and the phone app can both use it and neither owns it.
// See src/lib/gymRecord.ts for the same shape.
//
// ── The problem this module exists to fix ──────────────────────────────────
//
// "Delivered" has been inferred as "was booked and the clock has since passed"
// (see the query in gymTrainers.fetchGymTrainers). That counts no-shows,
// un-cancelled slots, and sessions the trainer never turned up to. It then
// feeds payroll, so a gym pays for sessions that did not happen.
//
// The fix is not to guess better. It is to admit that an unmarked session has
// an unknown outcome, keep it out of both the delivered count and the payroll
// figure, and tell the gym how many are waiting to be marked. A payroll run
// that says "£6,180 across 84 sessions, with 12 still unmarked" is useful. One
// that says £7,060 because it counted the twelve is a dispute.

import { assertWhole, capLimit } from './rowCap';
import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any };

/** What happened to a booked session. Null means nobody has said yet. */
export type SessionOutcome = 'completed' | 'no_show' | 'cancelled' | 'late_cancelled';

export interface PtSession {
  id: string;
  trainerId: string;
  trainerName: string | null;
  clientId: string | null;
  clientName: string | null;
  startsAt: string;
  durationMin: number;
  /** Slot state: available, booked or blocked. Not the delivery result. */
  status: string;
  /** Null until somebody records what happened. Not the same as cancelled. */
  outcome: SessionOutcome | null;
  outcomeAt: string | null;
  /** The rate snapshotted at delivery, so a later fee change cannot rewrite it. */
  rateCents: number | null;
  /** The payroll run that paid for this session. Null means still outstanding —
   *  which is what keeps a late-marked session out of an already-settled period
   *  and stops it being paid twice. */
  settlementId: string | null;
}

/**
 * Whether a no-show is payable.
 *
 * A genuine policy difference between gyms, not a technical detail: some pay
 * the trainer who turned up and waited, some do not. It has to be stated
 * rather than assumed, so it is a required argument everywhere it matters.
 *
 * A late cancellation is treated the same way as a no-show — from the
 * trainer's side the hour was held either way.
 */
export interface PayPolicy {
  payNoShows: boolean;
  payLateCancellations: boolean;
}

/** The conservative default: pay only for sessions that actually took place. */
export const PAY_DELIVERED_ONLY: PayPolicy = { payNoShows: false, payLateCancellations: false };

/* ── pure rules (no database, so they are testable and shared) ─────────────── */

/** A session is delivered only when somebody recorded that it completed. */
export function isDelivered(s: Pick<PtSession, 'outcome'>): boolean {
  return s.outcome === 'completed';
}

/**
 * Whether the outcome is still unknown: the session was booked, its end time
 * has passed, and nobody has said what happened.
 *
 * A slot that is merely `available` or `blocked` is not awaiting anything —
 * nobody was booked into it.
 */
export function isAwaitingOutcome(s: PtSession, now: number = Date.now()): boolean {
  if (s.status !== 'booked' || s.outcome !== null) return false;
  const end = Date.parse(s.startsAt) + s.durationMin * 60_000;
  return Number.isFinite(end) && end <= now;
}

/** Whether this session should be paid, under the gym's stated policy. */
export function isPayable(s: Pick<PtSession, 'outcome'>, policy: PayPolicy): boolean {
  switch (s.outcome) {
    case 'completed': return true;
    case 'no_show': return policy.payNoShows;
    case 'late_cancelled': return policy.payLateCancellations;
    // A plain cancellation, and an unmarked session, are never payable. The
    // unmarked one is reported separately rather than quietly costing nothing.
    default: return false;
  }
}

export interface PayrollLine {
  trainerId: string;
  trainerName: string | null;
  delivered: number;
  noShows: number;
  cancelled: number;
  /** Booked, finished, and nobody has said what happened. */
  unmarked: number;
  /** Null when not one payable session carried a rate. */
  cents: number | null;
  /** How many payable sessions actually had a rate to price. */
  priced: number;
  payable: number;
}

/**
 * Payroll per trainer for a set of sessions.
 *
 * `fallbackRateCents` prices sessions that have no snapshotted rate — a gym's
 * standard session fee. Pass null when no fee is set, and the money comes back
 * null rather than zero.
 */
export function payrollByTrainer(
  sessions: PtSession[],
  policy: PayPolicy,
  fallbackRateCents: number | null = null,
  now: number = Date.now(),
): PayrollLine[] {
  const lines = new Map<string, PayrollLine>();

  const line = (s: PtSession): PayrollLine => {
    let l = lines.get(s.trainerId);
    if (!l) {
      l = {
        trainerId: s.trainerId, trainerName: s.trainerName,
        delivered: 0, noShows: 0, cancelled: 0, unmarked: 0,
        cents: null, priced: 0, payable: 0,
      };
      lines.set(s.trainerId, l);
    }
    return l;
  };

  for (const s of sessions) {
    const l = line(s);
    if (s.outcome === 'completed') l.delivered += 1;
    else if (s.outcome === 'no_show') l.noShows += 1;
    else if (s.outcome === 'cancelled' || s.outcome === 'late_cancelled') l.cancelled += 1;
    else if (isAwaitingOutcome(s, now)) l.unmarked += 1;

    if (!isPayable(s, policy)) continue;
    l.payable += 1;
    const rate = s.rateCents ?? fallbackRateCents;
    if (rate == null) continue; // priced later, or never — not zero
    l.cents = (l.cents ?? 0) + rate;
    l.priced += 1;
  }

  return [...lines.values()].sort(
    (a, b) => b.delivered - a.delivered || (a.trainerName ?? '').localeCompare(b.trainerName ?? ''),
  );
}

export interface PayrollTotal {
  /** Null when nothing payable could be priced. */
  cents: number | null;
  delivered: number;
  payable: number;
  priced: number;
  unmarked: number;
  /**
   * Whether the figure can be settled. False while sessions are unmarked or
   * payable sessions have no rate — the caller should show the caveat rather
   * than presenting the number as final.
   */
  settleable: boolean;
}

/** The gym-wide payroll position, and whether it is safe to settle on it. */
export function payrollTotal(lines: PayrollLine[]): PayrollTotal {
  let cents: number | null = null;
  let delivered = 0, payable = 0, priced = 0, unmarked = 0;

  for (const l of lines) {
    delivered += l.delivered;
    payable += l.payable;
    priced += l.priced;
    unmarked += l.unmarked;
    if (l.cents != null) cents = (cents ?? 0) + l.cents;
  }

  return {
    cents,
    delivered, payable, priced, unmarked,
    // Everything payable must be priced, and nothing may still be unmarked.
    settleable: unmarked === 0 && payable > 0 && priced === payable,
  };
}

/**
 * Why the payroll figure cannot be settled yet, in words a gym owner can act
 * on. Null when it can.
 */
export function settlementBlocker(t: PayrollTotal): string | null {
  if (t.unmarked > 0) {
    return `${t.unmarked} session${t.unmarked === 1 ? '' : 's'} still need an outcome recorded.`;
  }
  if (t.payable === 0) return 'No payable sessions in this period.';
  if (t.priced < t.payable) {
    const missing = t.payable - t.priced;
    return `${missing} payable session${missing === 1 ? '' : 's'} have no rate — set a session fee.`;
  }
  return null;
}

/* ── settlement ────────────────────────────────────────────────────────────── */

export interface Settlement {
  id: string;
  trainerId: string;
  periodFrom: string;
  periodTo: string;
  amountCents: number;
  /** As the row states it, or null because it states none.
   *
   *  This was `string` with `?? 'AED'` behind it, so a settlement with no
   *  currency was read back as dirhams and printed as fact on /sessions and
   *  /payroll — while /accounting and /coach/earnings, which read the same
   *  table with their own queries, mapped the null through and withheld the
   *  figure. One row, shown two ways, and only the other two were honest. */
  currency: string | null;
  sessionsCount: number;
  method: 'transfer' | 'cash' | 'payroll' | 'other';
  note: string | null;
  settledAt: string;
}

/**
 * Which of a trainer's sessions a settlement would actually pay for.
 *
 * Deliberately NOT "everything in the date range". A session already carrying a
 * settlement_id has been paid and must never be paid again; a session marked
 * after its period was settled has no settlement_id and simply joins the next
 * run. Paying by session rather than by period is what makes both of those come
 * out right without anybody having to notice.
 *
 * Unmarked sessions are excluded because nobody has said whether they happened.
 * They are the reason payrollTotal refuses to answer, and settling around them
 * would quietly pay a period that is not finished.
 *
 * ── fallbackRateCents, and why it has to be here ──────────────────────────
 *
 * This used to require `s.rateCents != null`, which meant it silently dropped
 * every session priced by the gym's standard fee — while `payrollByTrainer`,
 * two hundred lines up, was pricing exactly those sessions at exactly that fee
 * and showing the owner the total. The two functions disagreed about what
 * "priced" means, and the money went through the stricter one.
 *
 * `payrollTotal` had already taken a side: it counts a fallback-priced session
 * in `priced`, so `settleable` goes true and `settlementBlocker` returns null.
 * The gym-wide guard said the figure was safe to settle and the per-trainer
 * settlement then paid a different number.
 *
 * What that looked like on a gym with a session fee and no snapshotted rates:
 * the screen said AED 1,500 owed and the button said "nothing outstanding".
 * Worse, on a MIXED month — some sessions carrying a rate, some on the fee —
 * there was no blocker at all: the screen said 1,500, settling handed over 900,
 * and the sessions were stamped with a settlement id so they never came round
 * again. A trainer short AED 600 and a record saying they had been paid.
 *
 * Pass the same fallback the payroll figure was computed with. It defaults to
 * null, which is the old behaviour, so a caller that has no fee set is unchanged.
 */
export function settleableSessions(
  sessions: PtSession[],
  policy: PayPolicy,
  now: number = Date.now(),
  fallbackRateCents: number | null = null,
): PtSession[] {
  return sessions.filter((s) =>
    s.settlementId == null &&
    s.outcome !== null &&
    !isAwaitingOutcome(s, now) &&
    isPayable(s, policy) &&
    (s.rateCents ?? fallbackRateCents) != null);
}

/**
 * What settling those sessions would hand over.
 *
 * Takes the same fallback for the same reason: priced by the gym's fee here, or
 * this hands back less than the rows it was given are worth. The `?? 0` is now
 * genuinely unreachable for anything settleableSessions returned — it survives
 * only so a hand-assembled list cannot produce NaN.
 */
export function settlementAmount(
  sessions: PtSession[],
  fallbackRateCents: number | null = null,
): number {
  return sessions.reduce((a, s) => a + (s.rateCents ?? fallbackRateCents ?? 0), 0);
}

/**
 * Why a settlement cannot be recorded right now, or null when it can.
 *
 * Separate from settlementBlocker, which answers a different question: that one
 * asks whether the *figure on screen* is safe to act on, this one asks whether
 * there is anything to pay. A gym can be perfectly in order and still have
 * nothing owed.
 */
export function settleBlocker(payable: PtSession[], unmarked: number): string | null {
  if (unmarked > 0) {
    return `${unmarked} session${unmarked === 1 ? '' : 's'} still need an outcome — settling now would pay for an unfinished period.`;
  }
  if (payable.length === 0) return 'Nothing outstanding for this trainer.';
  return null;
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * The distinct profile ids a set of session rows names — trainers and clients
 * alike, since both are keyed on profiles.id.
 *
 * Pure, so the half of the name lookup that can quietly go wrong — dropping an
 * id, and showing a dash where a name belongs — is testable without a database.
 */
export function sessionProfileIds(
  rows: Array<{ trainer_id?: string | null; client_id?: string | null }>,
): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.trainer_id) ids.add(r.trainer_id);
    if (r.client_id) ids.add(r.client_id);
  }
  return Array.from(ids);
}

/**
 * Profile rows to a name lookup keyed by id.
 *
 * A blank or whitespace-only full_name is left out rather than mapped to '',
 * so the screen falls back to its dash instead of printing an empty cell that
 * reads as a broken table.
 */
export function namesById(
  profiles: Array<{ id: string; full_name?: string | null }>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of profiles ?? []) {
    const name = (p?.full_name ?? '').trim();
    if (p?.id && name) m.set(p.id, name);
  }
  return m;
}

/**
 * Names for the people these rows name, in one query.
 *
 * Not a PostgREST embed, and that is the whole point: `trainers` and `clients`
 * carry no name of their own, so `trainers(full_name)` asked for a column that
 * does not exist and PostgREST rejected the entire read with 42703 —
 * "column trainers_1.full_name does not exist". Every caller of fetchSessions
 * threw, which is why the sessions screen showed "Could not read the session
 * record." instead of the payroll board. (`clients(full_name)` had a second
 * fault waiting behind the first: sessions reaches clients through two foreign
 * keys — client_id and session_waitlist — so that embed is ambiguous even once
 * the column exists.) The shape below is the one in
 * gymTrainers.fetchGymTrainers: collect the ids, resolve them against profiles,
 * which an owner may read for their own tenant (profiles_owner_r).
 *
 * A failure here is not fatal. Names are labels on a board whose subject is
 * money: leaving them null renders a dash, which is honest, where throwing
 * would black out a payroll figure that is perfectly readable without them.
 * Anyone whose profile this caller may not read — RLS filters rather than
 * errors — lands in the same place.
 */
async function fetchSessionNames(sb: Queryable, rows: any[]): Promise<Map<string, string>> {
  const ids = sessionProfileIds(rows);
  if (!ids.length) return new Map();
  const { data, error } = await sb.from('profiles').select('id, full_name').in('id', ids);
  if (error) return new Map();
  return namesById((data ?? []) as Array<{ id: string; full_name?: string | null }>);
}

export async function fetchSessions(
  sb: Queryable,
  tenantId: string,
  sinceIso: string,
  untilIso?: string,
): Promise<PtSession[]> {
  let q = sb
    .from('sessions')
    .select('id, trainer_id, client_id, starts_at, duration_min, status, outcome, outcome_at, rate_cents, settlement_id')
    .eq('tenant_id', tenantId)
    .gte('starts_at', sinceIso)
    .order('starts_at', { ascending: false });
  if (untilIso) q = q.lte('starts_at', untilIso);
  q = q.limit(capLimit());
  const { data, error } = await q;
  if (error) throw error;

  // This list is summed into what the gym owes its trainers. A thousand rows is
  // a busy month, not an impossible one, and a set cut off at the limit would
  // have priced the month at whatever fitted — with no error to say so.
  const rows = assertWhole(data, 'sessions in this period') as any[];
  const names = await fetchSessionNames(sb, rows);
  return rows.map((r) => rowToSession(r, names));
}

function rowToSession(r: any, names: Map<string, string>): PtSession {
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

/** Sessions that finished without anyone saying what happened. */
export async function fetchAwaitingOutcome(
  sb: Queryable,
  tenantId: string,
  sinceIso: string,
): Promise<PtSession[]> {
  const all = await fetchSessions(sb, tenantId, sinceIso, new Date().toISOString());
  return all.filter((s) => isAwaitingOutcome(s));
}

/* ── writes ────────────────────────────────────────────────────────────────── */

/**
 * Record what happened. The rate is snapshotted at the same moment so that a
 * later change to the gym's fee cannot rewrite what this session cost.
 *
 * The count is checked, not `error` alone — see src/lib/wroteRows.ts. This is
 * the write on `sessions` where a silent no-op costs the most, because the
 * outcome is what payroll is computed from: an unmarked session is not paid,
 * so an owner who marked twelve sessions delivered and had three of them match
 * zero rows underpays a trainer and has a screen agreeing with them. Zero rows
 * is reachable without any error at all — `sessions_gym_owner_u` requires
 * `tenant_id is not null and is_owner_of(tenant_id)` and `sessions_trainer`
 * requires `trainer_id = auth.uid()`, so a session belonging to neither, or one
 * cancelled from the phone while the board was open, simply matches nothing.
 */
export async function markOutcome(
  sb: Queryable,
  sessionId: string,
  outcome: SessionOutcome,
  rateCents?: number | null,
): Promise<void> {
  const patch: Record<string, unknown> = { outcome };
  if (rateCents !== undefined) patch.rate_cents = rateCents;
  const r = await sb.from('sessions').update(patch, { count: 'exact' }).eq('id', sessionId);
  assertWrote('That outcome', r);
}

/**
 * Record that a trainer was paid, and stamp the sessions it covered.
 *
 * Two writes, in this order on purpose: the settlement row first, then the
 * sessions pointing at it. If the second write fails the settlement exists with
 * no sessions attached — visible, wrong, and fixable. The other order would
 * leave sessions marked paid against a run that does not exist, which is money
 * that silently vanishes from what the gym owes.
 *
 * `sessionIds` should come from settleableSessions(), which is what guarantees
 * nothing already settled is included.
 */
export async function recordSettlement(
  sb: Queryable,
  tenantId: string,
  run: {
    trainerId: string;
    periodFrom: string;
    periodTo: string;
    amountCents: number;
    sessionIds: string[];
    method?: 'transfer' | 'cash' | 'payroll' | 'other';
    note?: string | null;
    /**
     * REQUIRED, and required is the fix.
     *
     * This was `currency?: string` written through as `run.currency ?? 'AED'`,
     * into a permanent payment record that /accounting and /close read back as
     * fact. Every settlement a non-UAE gym ever made was stored as dirhams, and
     * nothing at any layer showed it: the column is `not null default 'AED'`,
     * so the wrong value renders cleanly and looks considered. Both callers
     * already pass the gym's own currency and block the settlement without one
     * — studio-web/app/payroll/page.tsx and studio-web/app/sessions/page.tsx —
     * so making it required costs nothing today and is what stops the third
     * caller reintroducing it.
     */
    currency: string;
  },
): Promise<string> {
  const { data, error } = await sb.from('payroll_settlements').insert({
    tenant_id: tenantId,
    trainer_id: run.trainerId,
    period_from: run.periodFrom,
    period_to: run.periodTo,
    amount_cents: run.amountCents,
    sessions_count: run.sessionIds.length,
    method: run.method ?? 'transfer',
    note: run.note ?? null,
    currency: run.currency,
  }).select('id').single();
  if (error) throw error;

  const id = (data as any)?.id as string;
  if (run.sessionIds.length) {
    // The rows changed are counted — see src/lib/wroteRows.ts — and this is the
    // write in the whole console where a silent no-op costs the most money.
    //
    // The two halves of this function were held to different standards: the
    // insert above asks for the row back and checks it, and this asked only
    // `if (e2)`. A PostgREST UPDATE matching zero rows returns 204 with a null
    // error, and `sessions_gym_owner_u` (`tenant_id is not null and
    // is_owner_of(tenant_id)`) filters rather than refuses. The settlement row
    // therefore existed with NOT ONE session stamped: the run appeared under
    // "Already paid" while every session in it stayed in "Owed now", payable
    // again, by an owner who had just been told the trainer was settled.
    const r2 = await sb.from('sessions')
      .update({ settlement_id: id }, { count: 'exact' })
      .in('id', run.sessionIds);
    assertWrote('The sessions this settlement covers', r2);
    if ((r2 as { count?: number | null }).count !== run.sessionIds.length) {
      // A PARTIAL stamp is its own outcome and worse than none, because the
      // unstamped remainder is silently payable a second time. The settlement
      // row is deliberately left standing — it is a payment that was made — so
      // this says exactly what is on the record and what is not.
      throw new Error(
        `The settlement was recorded, but only ${(r2 as { count?: number | null }).count ?? 0} of `
        + `${run.sessionIds.length} sessions were stamped against it. The rest are still shown as unpaid `
        + 'and could be settled twice. Reload before settling this trainer again.',
      );
    }
  }
  return id;
}

export async function fetchSettlements(
  sb: Queryable, tenantId: string, limit = 50,
): Promise<Settlement[]> {
  const { data, error } = await sb
    .from('payroll_settlements')
    .select('id, trainer_id, period_from, period_to, amount_cents, currency, sessions_count, method, note, settled_at')
    .eq('tenant_id', tenantId)
    .order('settled_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    trainerId: r.trainer_id,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    amountCents: r.amount_cents ?? 0,
    // Null through, never coerced. `money()` withholds an amount whose currency
    // nobody chose, which is the whole point of it taking the currency as a
    // required argument; coercing here defeated that before it was ever called.
    currency: r.currency ?? null,
    sessionsCount: r.sessions_count ?? 0,
    method: r.method ?? 'transfer',
    note: r.note ?? null,
    settledAt: r.settled_at,
  }));
}

/** Undo a wrongly recorded outcome, returning the session to "not yet known".
 *
 *  Counted for the same reason `markOutcome` is, and with the sharper edge:
 *  this is the control somebody reaches for having just realised the record is
 *  wrong. Telling them it is undone when nothing changed leaves the wrong
 *  outcome standing with somebody now confident it does not. */
export async function clearOutcome(sb: Queryable, sessionId: string): Promise<void> {
  const r = await sb.from('sessions').update({ outcome: null }, { count: 'exact' }).eq('id', sessionId);
  assertWrote('Clearing that outcome', r);
}
