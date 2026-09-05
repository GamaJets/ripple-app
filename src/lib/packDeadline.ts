// Sessions somebody has already paid for, and whether there is time left to
// take them.
//
// ── The gap this fills ────────────────────────────────────────────────────
//
// src/lib/packExpiry.ts states the FACT and states it well: "4 sessions on this
// pack, and it runs out on 12 Sep — 9 days left." It is printed on Memberships
// & Packs and on the coach's payments screen, and it is the right sentence for
// both.
//
// What it does not answer is the question the member actually has when they
// read it, which is not "when does it end" but "am I going to lose any of
// this". Answering that means two more facts the screen is already holding and
// nothing was putting together:
//
//   · how many of those sessions are ALREADY in their diary before that day —
//     because if all four are booked there is nothing to worry about and the
//     deadline is noise;
//   · whether the days that are left can physically hold the ones that are not
//     — because "3 to book in 2 days" is not a nudge, it is a conversation to
//     have with a coach today, and the member has no way to reach that
//     conclusion except by doing the arithmetic themselves at the moment they
//     are least likely to.
//
// A pack that lapses with sessions on it is money that evaporates. packExpiry's
// own header calls it "a conversation, not a zero" and says the honest handling
// is to say how many and on what day "to BOTH people". The coach's half exists
// — `strandedNote`. The member's half told them the date and left them to work
// out the rest.
//
// ── The boundary with packExpiry ──────────────────────────────────────────
//
// This module handles exactly one state: a window that is still OPEN, closing
// soon, with sessions still on the pack. Everything else — no window, a window
// comfortably far off, one that has lapsed, one the nightly pass has closed —
// is `silent` here and belongs to `expiryLine`, which already says all four
// better than a second opinion would. Two modules narrating one pack is how
// they end up disagreeing about it.
//
// ── Why the booking count may be null, and must be allowed to be ──────────
//
// A member can hold two packs with two different windows. An upcoming session
// is not attributed to one of them until it actually draws — `LedgerRow.
// entitlementId` is null for everything that has not moved — so with two packs
// in play there is no honest way to say which one a Thursday booking is going
// to spend. The caller passes null there, and this says the deadline without
// claiming anything about coverage. A guess would be worse than a silence:
// "all of them are booked" is the one sentence here that could talk somebody
// out of acting.
//
// ── The count is of bookings that have NOT been paid for yet ──────────────
//
// `bookedByThen` is subtracted from `left`, and `left` is
// `sessions_total - sessions_used`. A one-off the member booked themselves has
// ALREADY come off `sessions_used`: `book_session` stamps
// `sessions.booking_drew_credit_at` and the app calls `redeem_pack_session`,
// which increments the column on the spot. So a diary counted whole subtracts
// the same credit twice — a ten-pack with eight self-booked hours reads
// `left: 2`, `booked: 8`, `toBook: -6`, 'covered', and two paid-for sessions
// nothing is booked against expire unrefunded while the screen says nothing is
// going to be lost. `drawsBy` at the foot of this file is the count that
// belongs here; `bookedBy` is only the day arithmetic under it.
import { daysLeftOn, expiryDayLabel, packWindow } from './packExpiry';

export interface DeadlineInput {
  /** Sessions still on the pack. Null when the balance could not be read — and
   *  it must never be defaulted to 0, which would silence this entirely for the
   *  member who has most at stake. */
  left: number | null;
  /** The pack's last day, bare `YYYY-MM-DD`, or null when it does not expire. */
  expiresOn: string | null;
  /** Today, local, bare `YYYY-MM-DD`. From `useToday()`, never `new Date()`. */
  today: string;
  /**
   * Upcoming bookings starting on or before that last day.
   *
   * Null when the diary could not be read whole, and null when more than one
   * pack could be paying for them — see the header. Null is a real answer here
   * and produces a real sentence; it is not a missing argument.
   */
  bookedByThen: number | null;
}

export type DeadlineKind =
  /** Nothing to say. No window, a window far off, a spent pack, or one that has
   *  already closed — `expiryLine` owns all of those. */
  | 'silent'
  /** The window is closing and something needed could not be read. */
  | 'unknown'
  /** Every remaining session is already in the diary before the last day. */
  | 'covered'
  /** Some are not booked, and there is room to book them. */
  | 'toBook'
  /** More sessions left than days to take them in. */
  | 'tight';

export interface PackDeadline {
  kind: DeadlineKind;
  /** The sentence, or null when there is nothing to say. */
  text: string | null;
  /** Whether this deserves a warn-coloured mark. False for 'covered' — a member
   *  who has already booked everything is being congratulated, not warned. */
  urgent: boolean;
  /** Sessions still to be booked before the window closes. Null when unknown. */
  toBook: number | null;
  /** Days remaining, counting today. Null outside an open window. */
  daysLeft: number | null;
}

const SILENT: PackDeadline = { kind: 'silent', text: null, urgent: false, toBook: null, daysLeft: null };

/** "one a day", "one every 3 days" — how often they would have to train. Null
 *  when the arithmetic does not produce a phrase worth reading. */
function cadence(toBook: number, daysLeft: number): string | null {
  if (toBook <= 0 || daysLeft <= 0) return null;
  const every = Math.floor(daysLeft / toBook);
  if (every <= 0) return null;
  if (every === 1) return 'about one a day';
  if (every >= 7) return null; // comfortably spaced; saying so is noise
  return `about one every ${every} days`;
}

/**
 * Whether a pack with a closing window is going to be used up in time.
 *
 * Every sentence names the day, because "9 days left" without a date is a
 * figure somebody has to convert before they can put it in a diary.
 */
export function packDeadline(input: DeadlineInput): PackDeadline {
  const { left, expiresOn, today, bookedByThen } = input;

  // One opinion about the window, and it is packExpiry's. `packWindow` is what
  // decides that a lapsed pack is lapsed and that a pack six months out is not
  // news, and re-deriving either here is how two screens start disagreeing
  // about the same pack.
  const window = packWindow({ expiresOn, expiredAt: null, sessionsExpired: 0 }, today);
  if (window !== 'soon') return SILENT;

  const daysLeft = daysLeftOn({ expiresOn, expiredAt: null, sessionsExpired: 0 }, today);
  const day = expiryDayLabel(expiresOn);
  if (daysLeft == null || !day) return SILENT;

  const when = daysLeft === 1 ? 'today is the last day' : `${daysLeft} days left`;

  // A balance nobody could read. NOT silence: the window is closing either way,
  // and a member who cannot see their balance is exactly the one who needs to
  // be told there is a deadline against it.
  if (left == null) {
    return {
      kind: 'unknown',
      text: `This pack runs out on ${day} — ${when} — and we could not read how many sessions are still on it. Anything left on it that day is not refunded, so it is worth checking with your coach.`,
      urgent: true, toBook: null, daysLeft,
    };
  }
  // A spent pack running out is not news. `expiryLine` is silent here too.
  if (!Number.isFinite(left) || left <= 0) return SILENT;

  const sessions = (n: number) => `${n} session${n === 1 ? '' : 's'}`;

  // The diary could not be read, or more than one pack could be paying for it.
  // The deadline is still stated; the coverage is not guessed.
  if (bookedByThen == null || !Number.isFinite(bookedByThen)) {
    return {
      kind: 'unknown',
      text: `${sessions(left)} left on this pack and it runs out on ${day} — ${when}. We could not tell which of your bookings are going to use them, so check your diary covers what is on it.`,
      urgent: true, toBook: null, daysLeft,
    };
  }

  const booked = Math.max(0, Math.floor(bookedByThen));
  const toBook = left - booked;

  if (toBook <= 0) {
    return {
      kind: 'covered',
      text: `${sessions(left)} left on this pack, and you already have enough booked before ${day} to use ${left === 1 ? 'it' : 'them'}. Nothing here is going to be lost.`,
      // Not urgent, and not warn-coloured. This is the answer somebody wanted.
      urgent: false, toBook: 0, daysLeft,
    };
  }

  // More sessions than days. Not a nudge — at one session a day this cannot be
  // done, so the useful next step is the coach rather than the calendar.
  if (toBook > daysLeft) {
    return {
      kind: 'tight',
      text: `${sessions(toBook)} on this pack are not booked and there ${daysLeft === 1 ? 'is 1 day' : `are only ${daysLeft} days`} left before ${day}. That is more sessions than days, so some of what you have paid for will go unused unless your coach extends it — ask them.`,
      urgent: true, toBook, daysLeft,
    };
  }

  const rate = cadence(toBook, daysLeft);
  return {
    kind: 'toBook',
    text: `${sessions(toBook)} on this pack ${toBook === 1 ? 'is' : 'are'} not booked yet, and it runs out on ${day} — ${when}.`
      + (rate ? ` That is ${rate}.` : '')
      + ' Anything still on it that day is not refunded.',
    urgent: true, toBook, daysLeft,
  };
}

/**
 * The instant the day AFTER a pack's last day begins, locally.
 *
 * `expiresOn` is a bare `YYYY-MM-DD`, so the comparison is made on the DAY, in
 * the reader's own zone: a session at 7pm on the last day is inside the window,
 * and `new Date('2026-09-12') > startsAt` would have put it outside for every
 * member west of Greenwich — the UTC midnight trap src/lib/localDate.ts exists
 * for. Half-open at the end, like every other window in this codebase.
 *
 * Null when the day will not read, which is how both counters below refuse to
 * let "no window" become "nothing booked".
 */
function windowEnd(lastDay: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(lastDay ?? '').trim());
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3] + 1, 0, 0, 0, 0).getTime();
}

/**
 * How many upcoming bookings start on or before a pack's last day.
 *
 * The raw count, which is NOT the same question as "how many of the credits
 * still on this pack are going to be spent" — see `drawsBy`, which is what the
 * two client screens ask. This one is the day arithmetic underneath it, kept
 * separate so the window rule has one home and one set of tests.
 *
 * Returns null when `lastDay` will not read, so a caller cannot accidentally
 * treat "no window" as "nothing booked".
 */
export function bookedBy(
  upcoming: { startsAt: string }[],
  lastDay: string | null,
): number | null {
  const end = windowEnd(lastDay);
  if (end == null) return null;
  let n = 0;
  for (const r of upcoming) {
    const t = Date.parse(r.startsAt);
    // A row whose date will not parse is not counted as covering anything. It
    // is one fewer booking claimed, which is the safe direction: the failure
    // mode of over-counting is telling somebody they are covered when they are
    // not, and that is the sentence this whole module exists to get right.
    if (!Number.isFinite(t)) continue;
    if (t < end) n += 1;
  }
  return n;
}

/** One upcoming booking, from the point of view of the pack that may pay for it. */
export interface UpcomingDraw {
  /** When it starts. A timestamp, judged against the last day in local time. */
  startsAt: string;
  /**
   * Whether this booking is STILL going to take a credit off the pack.
   *
   * False for one that has already taken it. That is not a hypothetical: a
   * one-off the member booked themselves draws at BOOKING — `book_session`
   * stamps `sessions.booking_drew_credit_at` and the app calls
   * `redeem_pack_session`, which does `sessions_used = sessions_used + 1` —
   * so the credit is off the pack the moment the slot is taken, and
   * `client_purchases.sessions_used` has already had it. Everything else
   * (a standing appointment, a slot the coach booked) draws at delivery and is
   * true here.
   *
   * Null when it cannot be told — an unread route, a booking whose credit row
   * did not come back. Null poisons the whole count on purpose; see below.
   */
  willDraw: boolean | null;
}

/**
 * How many of the credits still on a pack are already spoken for by the diary.
 *
 * This is the number `packDeadline` wants for `bookedByThen`, and `bookedBy` is
 * not it. `left` is `sessions_total - sessions_used`, and `sessions_used` has
 * ALREADY had the self-booked one-offs taken off it. Counting those bookings
 * again here subtracts the same credit twice: a ten-pack with eight self-booked
 * hours reads `left: 2`, `booked: 8`, `toBook: -6`, and the member is told
 * "nothing here is going to be lost" about two credits that nothing is booked
 * against and that will expire unrefunded. Only the bookings that have NOT yet
 * drawn belong in this count.
 *
 * Null when the day will not read, and null when any booking INSIDE the window
 * cannot be judged — a count that cannot be trusted must not silently become a
 * number, because the number it would become is the one that produces the
 * 'covered' sentence. A booking after the last day is skipped before its state
 * is consulted: it could not cover anything either way, so an unknown one out
 * there does not get to silence a window it was never in.
 */
export function drawsBy(
  upcoming: readonly UpcomingDraw[],
  lastDay: string | null,
): number | null {
  const end = windowEnd(lastDay);
  if (end == null) return null;
  let n = 0;
  for (const r of upcoming) {
    const t = Date.parse(r.startsAt);
    // Same safe direction as `bookedBy`: a date that will not read claims
    // nothing rather than claiming coverage.
    if (!Number.isFinite(t)) continue;
    if (t >= end) continue;
    if (r.willDraw == null) return null;
    if (r.willDraw) n += 1;
  }
  return n;
}
