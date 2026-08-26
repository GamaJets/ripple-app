// Coach · what this month is actually worth.
//
// One definition of "delivered", shared by the two trainer screens that report
// money, because they had two definitions and the two disagreed.
//
// ── What was wrong, on both screens, differently ───────────────────────────
//
// The Clients screen multiplied `roster.length * sessionFee * 4` and labelled
// it "Est. revenue", with the note "N clients × 4 sessions × $rate". That is a
// subscription nobody sells and nobody pays: every client is assumed to train
// four times a month whether or not they have trained at all, so a coach with
// five clients who trained none of them was shown $1,500/mo. The figure moved
// only when the roster did — adding a client who never books raised it.
//
// The Analytics screen had already been fixed off that headcount arithmetic and
// onto real sessions, but read them as `status === 'booked'` with the clock
// passed. `status` is the SLOT's state — available, booked or blocked — and a
// session stays `booked` whether it was completed, no-showed or cancelled. So
// no-shows and cancellations were billed at the full rate.
//
// That second inference is the one named at the top of gymSessions.ts as the
// bug that module exists to end. Its remedy is the rule here: read `outcome`,
// and where nobody has said what happened, say THAT rather than guess. A month
// reported as "8 delivered, 3 still unmarked" is useful. The same month
// reported as 11 is a dispute, and reported as 20 because there are five
// clients is a fiction.
import type { TrainingSession } from './types';

/** A session's slot has ended when its start plus its duration is in the past.
 *  Start time alone would count a session still under way. */
function hasEnded(s: TrainingSession, now: number): boolean {
  const end = Date.parse(s.startsAt) + s.durationMin * 60_000;
  return Number.isFinite(end) && end <= now;
}

/** First moment of `now`'s LOCAL calendar month — an evening session belongs to
 *  that evening's month, matching the local-day convention in streaks.ts and
 *  clientDrift.ts. */
export function monthStart(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
}

export interface MonthRevenue {
  /** Booked, ended, and marked `completed`. The only sessions that earn. */
  delivered: number;
  /** Booked, ended, and nobody has said what happened. Not counted as
   *  delivered and not counted against the coach — reported, so it can be
   *  fixed. This is the number that makes the delivered figure trustworthy. */
  unmarked: number;
  /** Booked, ended, and explicitly not delivered: no-show, cancelled or
   *  late-cancelled. Kept apart from `unmarked` because one is a known outcome
   *  and the other is a missing one. */
  notDelivered: number;
  /** `delivered × fee`. Null when no rate is set — not 0, which would read as
   *  "you earned nothing" rather than "you have not told us your rate". */
  revenue: number | null;
}

/**
 * This calendar month's delivered sessions, and what they are worth.
 *
 * `now` and `fee` are arguments rather than ambient so the result is
 * reproducible in a test and identical on every screen that asks.
 */
export function monthToDateRevenue(
  sessions: TrainingSession[],
  fee: number | null,
  now: number = Date.now(),
): MonthRevenue {
  const from = monthStart(now);
  let delivered = 0, unmarked = 0, notDelivered = 0;
  for (const s of sessions) {
    if (s.status !== 'booked') continue;          // an open or blocked slot earns nothing
    const at = Date.parse(s.startsAt);
    if (!Number.isFinite(at) || at < from) continue;
    if (!hasEnded(s, now)) continue;              // not yet owed, not yet unmarked
    if (s.outcome === 'completed') delivered++;
    else if (s.outcome == null) unmarked++;
    else notDelivered++;
  }
  return {
    delivered,
    unmarked,
    notDelivered,
    revenue: fee == null || fee <= 0 ? null : delivered * fee,
  };
}

/**
 * The sentence that has to sit beside the figure.
 *
 * Returned rather than written into each screen so the two cannot drift apart
 * in wording the way they drifted apart in arithmetic. Empty string when there
 * is nothing to add, so a caller can join it unconditionally.
 */
export function unmarkedNote(m: MonthRevenue): string {
  if (m.unmarked <= 0) return '';
  const one = m.unmarked === 1;
  return `${m.unmarked} more ${one ? 'session has' : 'sessions have'} finished without an outcome and ${one ? 'is' : 'are'} not counted — mark ${one ? 'it' : 'them'} and this catches up.`;
}

/** The client ids among this month's delivered sessions. Used to say what a
 *  set of clients was actually worth, rather than what a headcount implies. */
export function deliveredByClients(
  sessions: TrainingSession[],
  clientIds: Set<string>,
  fee: number | null,
  now: number = Date.now(),
): number | null {
  if (fee == null || fee <= 0) return null;
  const from = monthStart(now);
  let n = 0;
  for (const s of sessions) {
    if (s.status !== 'booked' || s.outcome !== 'completed') continue;
    if (!s.clientId || !clientIds.has(s.clientId)) continue;
    const at = Date.parse(s.startsAt);
    if (!Number.isFinite(at) || at < from || !hasEnded(s, now)) continue;
    n++;
  }
  return n * fee;
}
