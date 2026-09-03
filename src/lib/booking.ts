// ── Booking & cancellation rules ─────────────────────────────────────────────
// The cancellation-fee logic, the coach's policy, the waitlist order and the
// slot re-offer, as pure functions.
import type { TrainingSession, CancellationResult } from './types';
// `wholeMoney`, not `money` from gymRecord.ts. See the note on `feeAmountLine`:
// a coach's fee is typed in whole units, gymRecord's formatter takes minor
// units, and the `* 100` that bridged them was a hundred-times error waiting
// for the first gym that charges in yen.
import { wholeMoney } from './coachMoney';

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
 *
 * That last clause was not true of a single caller. Both sentences below, and
 * the standing-appointment one in src/lib/recurring.ts, interpolated this
 * straight into prose: "your coach's late-cancellation fee of 25 applies". A
 * bare 25 in a sentence is read in whatever money the reader is thinking in,
 * which is the exact failure `money()` withholds an amount to avoid — the
 * figure looks stated, so nobody goes and sets the currency. `unstatedCurrency`
 * below is the missing half, and every prose site now appends it.
 *
 * ── WHY IT NO LONGER GOES THROUGH gymRecord's money() ─────────────────────
 *
 * `fee` is a whole-unit figure a coach typed: 25 means twenty-five of whatever
 * they charge in. `money()` takes MINOR units, so this used to convert with
 * `Math.round(amount * 100)` and let `money()` divide it straight back. That
 * round trip cancels out in a currency with hundredths and is a hundred-times
 * error in one without: a ¥5,000 late fee became 500,000 minor units, and a
 * formatter that knew about zero-decimal currencies would print "JPY 500,000"
 * for a fee of five thousand yen. Even the formatter that does not know printed
 * "JPY 5,000.00", inventing a subdivision the yen has never had.
 *
 * `wholeMoney` in src/lib/coachMoney.ts is the function for exactly this — a
 * whole-unit amount somebody typed, rendered in the currency they typed it in,
 * with the decimal places that currency actually has. No multiply, no divide,
 * and nothing here has to know which currencies are which.
 */
export function feeAmountLine(amount: number, currency: string | null | undefined): string {
  if (!currency) return String(amount);
  return wholeMoney(amount, currency) ?? String(amount);
}

/**
 * The clause that has to follow a fee whose currency nobody set.
 *
 * Empty for a stated currency, so it can be appended blindly. It is a separate
 * export rather than folded into `feeAmountLine` because that function also
 * fills value SLOTS — the Amount cell on the two calendars — where a dash and a
 * column heading already carry the doubt and a sentence would not fit. A slot
 * may print the figure alone; a sentence may not.
 */
export function unstatedCurrency(currency: string | null | undefined): string {
  return currency ? '' : ' Your coach hasn’t set a currency, so ask them what that amount is in.';
}

/**
 * The same clause, said to the COACH.
 *
 * `unstatedCurrency` above addresses the client and tells them to ask their
 * coach, which is exactly the wrong instruction on the coach's own screen. The
 * three waive and reinstate confirmations in app/(trainer)/calendar.tsx printed
 * the bare figure with no clause at all — so a coach confirmed forgiving "25"
 * with nothing on the screen saying 25 of what, on the one list in the app that
 * says what their clients owe them. It is also the screen a coach with no
 * currency set is most likely to be on, because that is the state in which the
 * figure comes through bare.
 */
export function unstatedCurrencyCoach(currency: string | null | undefined): string {
  return currency ? '' : ' You have not set a currency, so that figure has no unit on it — set one in Settings and it will be priced everywhere.';
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
      return `This is inside ${w}, so your coach's late-cancellation fee of ${feeAmountLine(v.amount, v.currency)} applies. Repple doesn't take this payment — it's recorded for you and your coach to settle.${unstatedCurrency(v.currency)}`;
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
    ? `A late-cancellation fee of ${sum} has been recorded on your account. Repple doesn't take this payment — settle it with your coach.${unstatedCurrency(currency)}`
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

/** Anything that occupies the coach for a stretch of time. A `TrainingSession`
 *  is one; so is a class the coach teaches, and the whole point of naming the
 *  shape is that the guard below cannot tell them apart and must not. */
export interface BusySpan { startsAt: string; durationMin: number }

/** Whether a proposed slot overlaps any existing session for the trainer. */
export function overlaps(
  startsAt: string,
  durationMin: number,
  existing: readonly BusySpan[]
): boolean {
  const s = Date.parse(startsAt);
  const e = s + durationMin * 60_000;
  return existing.some((x) => {
    const xs = Date.parse(x.startsAt);
    const xe = xs + x.durationMin * 60_000;
    return s < xe && xs < e;
  });
}

/* ── How much bookable diary is left ──────────────────────────────────────
 *
 * Open slots are written four weeks at a time by a button a coach has to
 * remember to press. The standing-appointment feature named this pattern as the
 * defect it was built to fix — "what a coach did instead was press Generate …
 * and press Generate again next month" — and fixed it for series only.
 *
 * The failure is silent and total. When the window empties, every client opens
 * the booking screen and sees nothing available, bookings stop, and no screen
 * anywhere says why. A coach back from three weeks away reads an empty diary as
 * a demand problem.
 *
 * There is still nothing scheduled that extends the window — that needs a job,
 * and a job is a deploy. What is here is the part that can ship without one:
 * knowing, and saying, when the window is running out.
 */

/**
 * The state of a coach's bookable window.
 *
 * 'unknown' is a first-class answer and the reason this returns a union rather
 * than a number. An empty session list under `LoadStatus 'error'` is a read
 * that did not happen, and a screen that turned that into "you have no open
 * slots" would send a coach to regenerate a diary that is already full — which
 * `generateSlots` itself refuses to do for exactly this reason.
 *
 * 'idle' is the coach who has no weekly availability set at all. They are not
 * relying on generated slots, so nothing here is news to them and nothing is
 * said.
 */
export type SlotWindowState =
  | 'unknown'
  /** No weekly availability, and nobody on the book yet. Nothing to say. */
  | 'idle'
  /**
   * No weekly availability, and clients ARE on the book. The one state every
   * coach on this platform has actually been in, and the one it used to say
   * nothing about — see the note on `openSlotWindow`.
   */
  | 'never-set'
  | 'empty'
  | 'ending'
  | 'healthy';

export interface SlotWindow {
  state: SlotWindowState;
  /** Open slots from now on. Zero is only meaningful under 'empty'. */
  open: number;
  /** When the furthest-ahead open slot starts, or null when there is none. */
  lastAt: string | null;
  /** Whole days from now until that slot, or null when there is none. Floored,
   *  so "runs out in 2 days" is never optimistic. */
  daysLeft: number | null;
}

/** How few days of bookable diary counts as running out. A week: long enough
 *  that a coach who reads it on Monday has the whole week to act, short enough
 *  that it is not on screen for most of a month and stops being read. */
export const SLOT_WARN_DAYS = 7;

export function openSlotWindow(
  sessions: readonly { startsAt: string; status?: string | null }[],
  opts: { known: boolean; hasWeekly: boolean; clientsOnBook?: number | null; now?: number; warnDays?: number },
): SlotWindow {
  const now = opts.now ?? Date.now();
  const warnDays = opts.warnDays ?? SLOT_WARN_DAYS;
  // Order matters. An unread diary is unknown whatever else is true.
  //
  // ── The state this screen used to be silent in ──────────────────────────
  //
  // Until now `!hasWeekly` returned 'idle' and `slotWindowLine` said nothing
  // about it, on the reasoning that a coach who does not take one-to-ones
  // should not be nagged. That reasoning is sound and the outcome was not: a
  // coach who INTENDS to take bookings and has simply never found the step is
  // in exactly the same state, and was told nothing either. Their clients open
  // the booking screen, see an empty week, and are given no reason — which is
  // indistinguishable, from the client's side, from a coach with no free time.
  //
  // The two are separated by whether anybody is waiting. A coach with nobody on
  // their book may genuinely not do this; a coach with clients on their book and
  // no weekly hours has a booking screen that is dead to every one of them, and
  // that is worth one sentence.
  //
  // An unknown client count is NOT treated as zero. It stays 'idle' — silence —
  // because the alternative is telling a coach their book is unbookable on the
  // strength of a number we could not read.
  if (!opts.known) return { state: 'unknown', open: 0, lastAt: null, daysLeft: null };
  const future = sessions
    .filter((s) => s.status === 'available')
    .map((s) => Date.parse(s.startsAt))
    .filter((ms) => isFinite(ms) && ms >= now)
    .sort((a, b) => a - b);
  const open = future.length;
  const lastMs = open > 0 ? future[future.length - 1] : null;
  const lastAt = lastMs === null ? null : new Date(lastMs).toISOString();
  const daysLeft = lastMs === null ? null : Math.floor((lastMs - now) / 86_400_000);
  if (!opts.hasWeekly) {
    const waiting = opts.clientsOnBook != null && opts.clientsOnBook > 0;
    return { state: waiting ? 'never-set' : 'idle', open, lastAt, daysLeft };
  }
  if (open === 0) return { state: 'empty', open, lastAt, daysLeft };
  return { state: (daysLeft as number) <= warnDays ? 'ending' : 'healthy', open, lastAt, daysLeft };
}

/**
 * What to say about that window, or null when there is nothing worth saying.
 *
 * Null for 'unknown' as well as for the two healthy states, and that is the
 * important one: silence is right where a guess would be wrong. The screen
 * already tells the coach their calendar could not be read; a second sentence
 * about a slot count nobody knows would be inventing one.
 */
export function slotWindowLine(w: SlotWindow, clientsOnBook?: number | null): string | null {
  if (w.state === 'never-set') {
    // Deliberately says what the CLIENT sees, not what the coach has not done.
    // "You have not set your availability" is a reprimand about a form; "your
    // clients cannot book you" is the consequence, and it is the consequence
    // that makes anybody open the sheet.
    const n = clientsOnBook ?? 0;
    const who = n === 1 ? 'Your client cannot book you' : `Your ${n} clients cannot book you`;
    return `${who}. You have no weekly hours set, so there is nothing for them to take — `
      + 'their booking screen is empty and nothing on it says why. '
      + 'Set the times you offer, then open the next four weeks.';
  }
  if (w.state === 'empty') {
    return 'You have weekly availability set and no open slots left, so nobody can book you. Clients see an empty booking screen and nothing tells them why.';
  }
  if (w.state === 'ending') {
    const d = w.daysLeft ?? 0;
    const when = d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
    return `Your last open slot is ${when}. After that clients see nothing available, and nothing on their screen says why.`;
  }
  return null;
}

/* ── Classes and one-to-ones did not know the other existed ───────────────
 *
 * `overlaps` is the double-booking guard the whole booking side rests on, and
 * `addSession` called it against the `sessions` list alone. Classes live in
 * `gym_classes` behind a separate provider the coach's calendar never asked, so
 * `generateSlots` would open a bookable PT hour on top of the class the coach
 * was running, a client would take it, and both parties would turn up.
 *
 * What follows is the selection — which classes are the reader's, and which of
 * those are in the way. It is deliberately conservative in one direction and
 * honest about the other:
 *
 *   A class recorded against this coach BLOCKS. That is the case the defect is
 *   about.
 *
 *   A class recorded against NOBODY cannot block, and cannot be dismissed
 *   either. Part 165 states the reason: "Every class already on the board has
 *   `trainer_id` NULL", because studio-web's Add a class wrote free-text
 *   `instructor` and never the id. Blocking on those would stop a coach opening
 *   any hour in which any colleague teaches anything; ignoring them silently
 *   would be the app claiming a clear hour it has not checked. So they are
 *   returned separately and the screen says so.
 */

/** A class as this guard needs to see it. A structural subset of the app's
 *  `GymClass`, so nothing here imports the whole timetable module. */
export interface ClassSpan {
  id: string;
  title: string;
  startsAt: string;
  durationMin: number;
  trainerId?: string | null;
  status?: string;
}

export interface ClassClash {
  /** Classes this coach is recorded as teaching, in the way. These block. */
  mine: ClassSpan[];
  /** Classes in the way that are recorded against nobody. These do not block,
   *  and the coach is told they could not be ruled out. */
  unattributed: ClassSpan[];
}

/**
 * Which classes stand in the way of a proposed one-to-one.
 *
 * A CANCELLED class is not in the way. The room never opened, nobody is
 * teaching it, and treating it as an obstacle would leave the coach unable to
 * use an hour the gym gave back to them.
 */
export function classClashes(
  startsAt: string,
  durationMin: number,
  classes: readonly ClassSpan[],
  uid: string | null,
): ClassClash {
  const live = classes.filter((c) => c.status !== 'cancelled');
  const hit = live.filter((c) => overlaps(startsAt, durationMin, [c]));
  return {
    mine: uid ? hit.filter((c) => c.trainerId === uid) : [],
    // Not "everything that is not mine". A colleague's class is their business
    // and their room; it is the ones NOBODY is recorded against that this
    // cannot rule in or out.
    unattributed: hit.filter((c) => !c.trainerId),
  };
}

/**
 * What to say when the class timetable could not be consulted, or when it could
 * and something unattributed was in the way. Null when there is nothing to add.
 *
 * Never claims the hour is clear. That is the whole job: `known` false means the
 * check did not happen, and a screen that said nothing would be reporting a
 * clean diary it never read.
 */
export function classCheckCaveat(known: boolean, unattributed: number): string | null {
  if (!known) {
    return 'Your class timetable could not be read, so this was not checked against the classes you teach.';
  }
  if (unattributed > 0) {
    return `${unattributed} class${unattributed === 1 ? '' : 'es'} at that time ${unattributed === 1 ? 'has' : 'have'} no coach recorded against ${unattributed === 1 ? 'it' : 'them'}, so ${unattributed === 1 ? 'it' : 'they'} could not be ruled in or out.`;
  }
  return null;
}
