// ── Booking & cancellation rules ─────────────────────────────────────────────
// The cancellation-fee logic, the coach's policy, the waitlist order and the
// slot re-offer, as pure functions.
import type { TrainingSession, CancellationResult } from './types';
import { money } from './gymRecord';

export const CANCEL_WINDOW_HOURS = 24;

export function hoursUntil(startsAt: string, now: number = Date.now()): number {
  return (Date.parse(startsAt) - now) / 3_600_000;
}

/** True when cancelling now incurs the late fee (inside the window, still future). */
export function isLateCancellation(startsAt: string, now: number = Date.now()): boolean {
  const h = hoursUntil(startsAt, now);
  return h > 0 && h < CANCEL_WINDOW_HOURS;
}

/**
 * Compute the effect of a client cancelling `session`.
 * Returns whether to charge, the fee, and who to notify.
 * `trainerClientIds` is every client of the trainer (the canceller is excluded
 * from the re-offer list automatically).
 */
export function cancelSession(
  session: TrainingSession,
  sessionFee: number,
  trainerClientIds: string[],
  now: number = Date.now()
): CancellationResult {
  const late = isLateCancellation(session.startsAt, now);
  const others = trainerClientIds.filter((id) => id !== session.clientId);
  return {
    charged: late,
    feeAmount: late ? sessionFee : 0,
    notifyClientIds: others,
    notifyTrainer: true,
  };
}

/** First waitlisted client (FIFO) to auto-assign an opened slot, or null. */
export function nextFromWaitlist(waitlist: string[]): string | null {
  return waitlist.length ? waitlist[0] : null;
}

/* ── The coach's cancellation policy ──────────────────────────────────────────
 *
 * It used to be one number: `trainers.session_fee`, quoted as the late fee with
 * no notice period behind it, no way for a coach to say they do not charge one,
 * and no amount at all for the coach who had not set a rate — which is how "a
 * $0 late fee may apply" came to be printed to somebody deciding whether
 * cancelling would cost them money.
 *
 * Four separate facts, and none of them may be inferred from another:
 * whether there is a policy, how much notice it wants, what it costs, and what
 * money that is in. `supabase/parts/126-the-late-fee-and-the-waitlist.sql`
 * stores them on `trainers` and refuses at the database to let `applies` stand
 * without an amount behind it.
 */
export interface CancellationPolicy {
  /** Whether this coach charges for a late cancellation at all. */
  applies: boolean;
  /** Hours of notice required to cancel free of charge. */
  noticeHours: number;
  /** The fee in MAJOR units of `currency`. Null when the coach has not said. */
  fee: number | null;
  /** ISO 4217. Null means the gym has not said, and no symbol may be printed. */
  currency: string | null;
}

/**
 * The notice period to hold a cancellation to when the policy could not be read.
 *
 * 24 is not a guess: it is what both client screens have warned about since
 * before any of this was configurable, so a coach who has set nothing, and a
 * member whose policy read failed, get the deal the app has always described.
 */
export const DEFAULT_NOTICE_HOURS = CANCEL_WINDOW_HOURS;

/** The notice period in force, including for a policy that could not be read. */
export function noticeHoursOf(policy: CancellationPolicy | null | undefined): number {
  const h = policy?.noticeHours;
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : DEFAULT_NOTICE_HOURS;
}

/**
 * Whether cancelling at `now` is inside the notice window.
 *
 * Deliberately NOT `isLateCancellation`, and the difference is the whole reason
 * both exist. This is `starts_at - now < notice`, with no lower bound, so a
 * session that has ALREADY STARTED is inside the window — which is what a coach
 * standing in an empty gym would say, and what both client screens have always
 * done. `isLateCancellation` requires the session to still be in the future, so
 * under it somebody cancelling a session already in progress comes back "not
 * late", pays nothing and is handed their pack credit back.
 *
 * `supabase/parts/126-*.sql` computes the same expression in SQL, because the
 * fee that gets RECORDED must be decided by the same rule as the fee the member
 * was warned about.
 */
export function insideNoticeWindow(
  startsAt: string,
  noticeHours: number = DEFAULT_NOTICE_HOURS,
  now: number = Date.now(),
): boolean {
  const start = Date.parse(startsAt);
  // An unparseable date is not evidence of anything. Refusing to call it late
  // is the side that does not charge somebody on the strength of a bad string.
  if (!Number.isFinite(start)) return false;
  return start - now < noticeHours * 3_600_000;
}

/**
 * What a cancellation costs, as a thing that can be stated in a sentence.
 *
 * Five outcomes rather than a number, because four of them are not numbers and
 * printing a 0 for any of them is the bug this replaces:
 *
 *   in-time     outside the notice window. Nothing is owed.
 *   no-policy   the coach does not charge for late cancellations.
 *   unknown     the policy could not be read. NOT the same as "no fee".
 *   unpriced    the coach charges, but has not said how much.
 *   fee         an amount, and the money it is in.
 */
export type FeeVerdict =
  | { kind: 'in-time' }
  | { kind: 'no-policy' }
  | { kind: 'unknown' }
  | { kind: 'unpriced' }
  | { kind: 'fee'; amount: number; currency: string | null };

export function lateCancelFee(
  policy: CancellationPolicy | null | undefined,
  inside: boolean,
): FeeVerdict {
  if (!inside) return { kind: 'in-time' };
  if (!policy) return { kind: 'unknown' };
  if (!policy.applies) return { kind: 'no-policy' };
  const fee = policy.fee;
  if (fee == null || !Number.isFinite(fee) || fee <= 0) return { kind: 'unpriced' };
  return { kind: 'fee', amount: fee, currency: policy.currency ?? null };
}

/**
 * A fee as money, or a bare number when the gym has not said what it charges in.
 *
 * Never AED-by-default. `money()` defaults its currency because the gym
 * operating record is denominated in dirhams and always has been; a coach's
 * late fee is not that record, and a London member reading "AED 25" is looking
 * at a different number, not a formatting slip. Where the currency is unknown
 * the figure is printed alone — it is the coach's own, and they know what it is
 * in — and the caller's sentence says so.
 */
export function feeAmountLine(amount: number, currency: string | null | undefined): string {
  if (!currency) return String(amount);
  return money(Math.round(amount * 100), currency) ?? String(amount);
}

/** How the notice period reads in a sentence: "24 hours", "1 hour", "48 hours". */
export function noticeLabel(hours: number): string {
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * What the member is told BEFORE they confirm, and it has to be true of what
 * happens after. Repple records the fee and does not take it; every branch that
 * mentions money says so, because a member who thinks the app has charged them
 * will not pay their coach.
 */
export function cancelWarningLine(v: FeeVerdict, noticeHours: number): string {
  const w = noticeLabel(noticeHours);
  switch (v.kind) {
    case 'in-time':
      return `This is more than ${w} away, so your coach's late-cancellation policy doesn't apply.`;
    case 'no-policy':
      return `This is inside ${w}, but your coach doesn't charge for a late cancellation.`;
    case 'unknown':
      return `This is inside ${w}. We couldn't read your coach's cancellation policy, so we can't say whether a fee applies — check with them.`;
    case 'unpriced':
      return `This is inside ${w}, so your coach's late-cancellation policy applies. They haven't set an amount here, so ask them what it is — Repple doesn't charge it.`;
    case 'fee':
      return `This is inside ${w}, so your coach's late-cancellation fee of ${feeAmountLine(v.amount, v.currency)} applies. Repple doesn't take this payment — it's recorded for you and your coach to settle.`;
  }
}

/**
 * What the member is told AFTERWARDS about a fee that was actually written down.
 * `charged` is the SERVER's answer, not this device's: the row either exists or
 * it does not, and a sentence about a charge is only worth printing when one is
 * really on the record.
 */
export function feeRecordedLine(
  charged: boolean,
  amount: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (!charged) return null;
  const sum = amount != null && Number.isFinite(amount) ? feeAmountLine(amount, currency) : null;
  return sum
    ? `A late-cancellation fee of ${sum} has been recorded on your account. Repple doesn't take this payment — settle it with your coach.`
    : 'A late-cancellation fee has been recorded on your account. Repple doesn’t take this payment — settle it with your coach.';
}

/* ── The waitlist, as an order ────────────────────────────────────────────── */

/**
 * One place in the queue for a taken slot.
 *
 * `seq` is the tiebreak behind `joinedAt`, and it exists because `joined_at`
 * defaults to now() — the TRANSACTION timestamp — so two people joining in the
 * same microsecond would tie and the order of a queue would come down to
 * whatever the planner felt like.
 */
export interface WaitlistEntry {
  clientId: string;
  joinedAt: string;
  seq: number;
}

/** The queue in the order it will actually be served. */
export function waitlistOrder(entries: WaitlistEntry[]): WaitlistEntry[] {
  return [...entries].sort((a, b) => {
    const at = Date.parse(a.joinedAt), bt = Date.parse(b.joinedAt);
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    return a.seq - b.seq;
  });
}

/**
 * Who gets a freed slot. The same rule `_promote_session_waitlist` runs in SQL,
 * stated here so it is testable without a database and so the two cannot drift
 * apart unnoticed.
 *
 * `exclude` is the person who just cancelled: they were holding the slot, so
 * they may not be handed it back off their own waitlist.
 */
export function nextWaitlistClaim(
  entries: WaitlistEntry[],
  exclude: string | null = null,
): string | null {
  const first = waitlistOrder(entries).find((e) => e.clientId !== exclude);
  return first ? first.clientId : null;
}

/** A client's 1-based place in the queue. 0 means they are not on it. */
export function waitlistPosition(entries: WaitlistEntry[], clientId: string): number {
  const i = waitlistOrder(entries).findIndex((e) => e.clientId === clientId);
  return i < 0 ? 0 : i + 1;
}

/** 1st, 2nd, 3rd, 4th … 11th, 21st. The teens are the ones that catch people. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * The member's own place, in words.
 *
 * "You're next" is the only claim here that is worth anything, and it is only
 * made for position 1. Everything else says the position and does NOT promise
 * the slot, because a queue of four in front of you is not a booking.
 */
export function waitlistLine(position: number, waiting: number): string {
  if (position <= 0) {
    return waiting > 0
      ? `${waiting} ${waiting === 1 ? 'person is' : 'people are'} waiting for this slot.`
      : 'Nobody is waiting for this slot yet.';
  }
  if (position === 1) {
    return waiting > 1
      ? `You're next in line — if it frees up it's yours, ahead of ${waiting - 1} other${waiting - 1 === 1 ? '' : 's'}.`
      : `You're next in line — if it frees up it's yours.`;
  }
  return `You're ${ordinal(position)} in line of ${waiting}. The slot goes to whoever is in front of you.`;
}

/** Whether a proposed slot overlaps any existing session for the trainer. */
export function overlaps(
  startsAt: string,
  durationMin: number,
  existing: TrainingSession[]
): boolean {
  const s = Date.parse(startsAt);
  const e = s + durationMin * 60_000;
  return existing.some((x) => {
    const xs = Date.parse(x.startsAt);
    const xe = xs + x.durationMin * 60_000;
    return s < xe && xs < e;
  });
}
