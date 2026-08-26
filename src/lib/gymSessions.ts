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
  currency: string;
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
 */
export function settleableSessions(
  sessions: PtSession[],
  policy: PayPolicy,
  now: number = Date.now(),
): PtSession[] {
  return sessions.filter((s) =>
    s.settlementId == null &&
    s.outcome !== null &&
    !isAwaitingOutcome(s, now) &&
    isPayable(s, policy) &&
    s.rateCents != null);
}

/** What settling those sessions would hand over. */
export function settlementAmount(sessions: PtSession[]): number {
  return sessions.reduce((a, s) => a + (s.rateCents ?? 0), 0);
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

export async function fetchSessions(
  sb: Queryable,
  tenantId: string,
  sinceIso: string,
  untilIso?: string,
): Promise<PtSession[]> {
  // No embedded selects here, and both reasons matter.
  //
  // This used to ask for `trainers(full_name), clients(full_name)` and it
  // failed on EVERY call with HTTP 300 / PGRST201. PostgREST could not decide
  // which relationship to embed: `sessions` reaches `clients` both by
  // sessions_client_id_fkey (many-to-one) and through session_waitlist
  // (many-to-many), so the request was ambiguous and was rejected before the
  // columns were even looked at.
  //
  // The columns were wrong too. Neither `trainers` nor `clients` has a
  // full_name — trainers is (id, tenant_id, bio, tagline, offers, specialties,
  // session_fee, listed) and names live on `profiles`. Verified against the
  // live catalogue, not the migrations.
  //
  // The static build never caught it because effects do not run during
  // prerender; it only failed for a signed-in person looking at payroll.
  let q = sb
    .from('sessions')
    .select('id, trainer_id, client_id, starts_at, duration_min, status, outcome, outcome_at, rate_cents, settlement_id')
    .eq('tenant_id', tenantId)
    .gte('starts_at', sinceIso)
    .order('starts_at', { ascending: false });
  if (untilIso) q = q.lte('starts_at', untilIso);
  const { data, error } = await q;
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return [];

  const names = await sessionNames(sb, [
    ...rows.map((r: any) => r.trainer_id),
    ...rows.map((r: any) => r.client_id),
  ]);
  return rows.map((r: any) => rowToSession(r, names));
}

/**
 * Resolve people's names from `profiles`, which is where they actually live.
 *
 * Checks `.error` and throws. The equivalent helper in gymRecord.ts does
 * `const { data } = await ...` and swallows the failure, which turns a broken
 * read into a screen where every person is unnamed and nothing says why. A
 * payroll page that cannot name a trainer should say it is broken, not quietly
 * pay "—".
 */
async function sessionNames(sb: Queryable, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const { data, error } = await sb.from('profiles').select('id, full_name').in('id', unique);
  if (error) throw error;
  return new Map((data ?? [])
    .map((p: any) => [p.id, (p.full_name || '').trim()])
    .filter(([, n]: any) => n));
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
 */
export async function markOutcome(
  sb: Queryable,
  sessionId: string,
  outcome: SessionOutcome,
  rateCents?: number | null,
): Promise<void> {
  const patch: Record<string, unknown> = { outcome };
  if (rateCents !== undefined) patch.rate_cents = rateCents;
  const { error } = await sb.from('sessions').update(patch).eq('id', sessionId);
  if (error) throw error;
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
    currency?: string;
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
    currency: run.currency ?? 'AED',
  }).select('id').single();
  if (error) throw error;

  const id = (data as any)?.id as string;
  if (run.sessionIds.length) {
    const { error: e2 } = await sb.from('sessions')
      .update({ settlement_id: id })
      .in('id', run.sessionIds);
    if (e2) throw e2;
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
    currency: r.currency ?? 'AED',
    sessionsCount: r.sessions_count ?? 0,
    method: r.method ?? 'transfer',
    note: r.note ?? null,
    settledAt: r.settled_at,
  }));
}

/** Undo a wrongly recorded outcome, returning the session to "not yet known". */
export async function clearOutcome(sb: Queryable, sessionId: string): Promise<void> {
  const { error } = await sb.from('sessions').update({ outcome: null }).eq('id', sessionId);
  if (error) throw error;
}
