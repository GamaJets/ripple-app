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

/* ── reads ─────────────────────────────────────────────────────────────────── */

export async function fetchSessions(
  sb: Queryable,
  tenantId: string,
  sinceIso: string,
  untilIso?: string,
): Promise<PtSession[]> {
  let q = sb
    .from('sessions')
    .select('id, trainer_id, client_id, starts_at, duration_min, status, outcome, outcome_at, rate_cents, ' +
            'trainers(full_name), clients(full_name)')
    .eq('tenant_id', tenantId)
    .gte('starts_at', sinceIso)
    .order('starts_at', { ascending: false });
  if (untilIso) q = q.lte('starts_at', untilIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToSession);
}

function rowToSession(r: any): PtSession {
  const tr = Array.isArray(r.trainers) ? r.trainers[0] : r.trainers;
  const cl = Array.isArray(r.clients) ? r.clients[0] : r.clients;
  return {
    id: r.id,
    trainerId: r.trainer_id,
    trainerName: tr?.full_name ?? null,
    clientId: r.client_id ?? null,
    clientName: cl?.full_name ?? null,
    startsAt: r.starts_at,
    durationMin: r.duration_min ?? 60,
    status: r.status,
    outcome: r.outcome ?? null,
    outcomeAt: r.outcome_at ?? null,
    rateCents: r.rate_cents ?? null,
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

/** Undo a wrongly recorded outcome, returning the session to "not yet known". */
export async function clearOutcome(sb: Queryable, sessionId: string): Promise<void> {
  const { error } = await sb.from('sessions').update({ outcome: null }).eq('id', sessionId);
  if (error) throw error;
}
