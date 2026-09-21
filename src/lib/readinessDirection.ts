// Which way the readiness score has moved — and the four ways of not knowing.
//
// ── why a score with no direction is half an answer ────────────────────────
//
// The home screen's hero prints one number under the word "Readiness". A member
// reading 62 cannot tell whether that is a bad morning or the best they have had
// all week, because 62 on its own is not a fact about them; it is a fact about
// today measured against a scale. Every app that shows a recovery figure shows
// it with a direction beside it for that reason, and this one did not, because
// `useReadiness` derived today and nothing else.
//
// So this file answers "and what was it yesterday". The arithmetic is one
// subtraction. Everything hard about it is the four ways of not having a
// yesterday, and the fourth is the one that looks like an answer.
//
// ── the four ───────────────────────────────────────────────────────────────
//
//   'scored'         yesterday's score is on record and is on the SAME SCALE as
//                    today's, so the difference between them is a difference in
//                    readiness. This is the only state that carries a number.
//
//   'no-record'      yesterday has no score. Nothing failed and nothing is
//                    missing from our read — the member simply has no readiness
//                    for that day. It is NOT "no change" and it is NOT zero:
//                    both of those are claims that today equals yesterday, made
//                    about a day we hold nothing for. A brand-new account has
//                    this state every time, and a hero reading "no change from
//                    yesterday" on a member's first morning is a sentence about
//                    a day they had not installed the app for.
//
//   'unread'         we tried to read yesterday and did not get an answer. A
//                    different thing from the line above and it must say so —
//                    the house rule this codebase keeps re-finding is that a
//                    failed read is not an empty list. The score behind it may
//                    have been anything, so the direction is unknown rather
//                    than absent, and this is the only state that earns a
//                    caveat on the number itself.
//
//   'not-comparable' yesterday HAS a score and it was built from a different
//                    set of signals. See below; this is the one that will be
//                    got wrong.
//
// ── case four, and why it refuses to subtract ──────────────────────────────
//
// `readinessScore` does not score out of a fixed 100. It sums the signals that
// were actually in the scale and rescales:
//
//     const outOf = 70 + (tracked ? 30 : 0) + (scored ? 40 : 0);
//
// So a sleep-and-training score is a percentage of 70 and a score with the
// member's water goal and their strap's recovery verdict in it is a percentage
// of 140. Both print as a number between 0 and 100 and they are not the same
// measurement. Concretely: a member sleeping identically on both days, training
// identically on both days, whose WHOOP token came back to life this morning at
// 30% recovered, reads 100 yesterday and 66 today. "Down 34 from yesterday" is
// a statement about their physiology and it is false. Nothing about them moved.
// What moved is what we knew.
//
// The decision is therefore: **do not subtract, and say why**. Not "no change",
// which claims the pair is equal; not a delta with an asterisk, because a figure
// on a hero is read and its footnote is not; and not silence, because a member
// who saw a direction yesterday and none today is owed the reason.
//
// ── and the test is the SET, not the count ─────────────────────────────────
//
// It is tempting to write this as "yesterday was computed from fewer inputs than
// today", which is how the defect is usually described. That test is wrong in
// both directions. Three signals yesterday and three today is an equal count and
// can still be sleep+recovery+load against sleep+hydration+load — 110 against
// 100, two different scales wearing the same tally. And a score built from FEWER
// signals is not the problem in itself: two days that were both sleep-and-load
// are perfectly comparable to each other, out of the same 70, and a member with
// no water goal and no strap — most of them — gets a real direction every day
// because of it. `Readiness.from` is the set and the set is what is compared,
// element for element. `readinessScore` always emits it in one fixed order, so
// a positional comparison is exact.
//
// ── "yesterday" is a calendar day, and the whole difficulty is there ───────
//
// Not `now - 86400000`. A day is 23 hours twice a year in every zone that
// observes daylight saving, and a subtraction lands on the same local date in
// one direction and skips one in the other. Not `toISOString().slice(0, 10)`
// either — that is UTC's calendar and UTC is nobody's; see scripts/check-utc-day.mjs
// for the payroll line it cost. A member who trains at 23:50 and a member who
// trains at 00:10 are ten minutes apart and on different days, and the hero each
// of them opens must agree with the day key their own record was filed under.
//
// So the day keys here come from `recentNights` — the same local-calendar
// arithmetic, anchored at noon so a DST shift cannot move it, that bounds the
// device half of the sleep read and `readinessSleep`'s own window. There is no
// second run of day arithmetic in this file. Keys are compared as STRINGS and
// never parsed back into a Date: `new Date('2026-09-13')` is UTC midnight, which
// is the twelfth for most of the world.
//
// Nothing here reads `Intl.DateTimeFormat().resolvedOptions().timeZone`, so the
// hole in `deviceTimeZone` (src/ui/availability.ts:579 — null for any zone whose
// name has no '/', which includes a handset reporting a bare `UTC`) cannot reach
// this file. Every day decision below is made by the runtime's own local getters
// on a Date, which have no such gap.
//
// Pure, and tested in readinessDirection.test.ts under four zones.
import { isWhole, type LoadStatus } from '../ui/loadStatus';
import { deltaMagnitude, deltaMoved, deltaSign } from './deltaLabel';
import { recentNights } from './sleepMerge';
import type { Readiness, ReadinessSignal } from './readiness';

/** One day's readiness, as much of it as a comparison needs. */
export interface ReadinessDayScore {
  /** The LOCAL calendar day it is the readiness for, as a bare `YYYY-MM-DD`. */
  day: string;
  /** 0..100, exactly as `readinessScore` returned it. */
  score: number;
  /**
   * The signals that were in that day's scale — `Readiness.from`, kept.
   *
   * Required rather than optional, because the whole of case four is that a
   * score without its composition cannot be compared with anything. A stored
   * yesterday that lost this field is a number nobody can safely subtract.
   */
  from: readonly ReadinessSignal[];
}

/**
 * Yesterday, as it came back from wherever it is kept.
 *
 * `status` is a `LoadStatus` and means what it means everywhere else in this
 * codebase. The pairing is the point and it is the four-way absence in one
 * shape:
 *
 *   'ready'  + a score  → we asked, we were answered, here it is.
 *   'ready'  + null     → we asked, we were answered, there is nothing for that
 *                         day. An EMPTY day, and a complete answer.
 *   'error'  + anything → we asked and were not answered. `score` is ignored.
 *   'loading'           → still in flight.
 *   'partial'           → the read came back short (src/lib/rowCap.ts). A score
 *                         drawn from a prefix is a score we cannot vouch for, so
 *                         it is treated as unread rather than as a figure —
 *                         'partial' is never quietly promoted to 'ready' here.
 */
export interface ReadinessYesterday {
  status: LoadStatus;
  /** Null is not zero and is only an empty day under a 'ready' status. */
  score: ReadinessDayScore | null;
}

/** Which of the four this is. Named, because a screen must not have to infer
 *  an absence from a null delta. */
export type ReadinessDirectionState = 'scored' | 'no-record' | 'unread' | 'not-comparable';

export interface ReadinessDirection {
  state: ReadinessDirectionState;
  /**
   * Points, today minus yesterday — and **null in every state but 'scored'**.
   *
   * Never 0 for an absence. Zero here means the two scores were read, compared
   * and found equal, which is a fact; an unknown that renders as 0 is the
   * invented figure scripts/check-invented-zero.mjs exists for.
   */
  delta: number | null;
  /** The local day this was measured against, or null when there was none. */
  against: string | null;
  /** Sentence case, no trailing full stop — the caller punctuates, exactly as
   *  `ReadinessInputLine.detail` does. */
  detail: string;
  /**
   * A sentence for `ReadinessBreakdown.caveats`, or null when nothing about
   * this direction makes the number on screen worth less than it looks.
   *
   * Sentence case, ending in a full stop, because the caveats are printed on
   * their own. Only 'unread' and 'not-comparable' produce one: an absent
   * yesterday is a complete answer rather than a short read, and dressing it as
   * one would train the member to ignore the word on the many days it means
   * nothing — which is the rule `readinessBreakdown` already states for its own
   * `short`.
   */
  caveat: string | null;
}

/** Decimals the delta is judged and printed at. A readiness score is whole. */
const DP = 0;

/**
 * The local day before `now`'s — as a key, and as the instant a caller can
 * re-derive the whole of yesterday from.
 *
 * `day` comes from `recentNights`, not from arithmetic of its own: that function
 * is what bounds `readinessSleep`'s window and the device sleep read, and a
 * second answer to "which local day was yesterday" is exactly the drift that two
 * copies of one fact always produce. `recentNights(2, now)` is `[today,
 * yesterday]` and it anchors each day at noon, so a daylight-saving shift cannot
 * move it the way `now - 86400000` can.
 *
 * `at` is the SAME CLOCK TIME on that day, built by decrementing the local date
 * field rather than by subtracting 86,400,000 milliseconds. Two reasons, and
 * both are the difference between a right answer and a plausible one:
 *
 *   · a subtraction is wrong twice a year. The local day is 23 or 25 hours long
 *     across a daylight-saving boundary, so 24 hours back from 00:30 lands on
 *     the day before yesterday in one direction and on today in the other.
 *   · local midnight would be wrong every day. A caller measuring yesterday's
 *     two-day training window back from midnight would measure back from the
 *     START of yesterday and see none of it — the window has to hang off the
 *     same point in the day the live one does, or the two are not the same
 *     question asked a day apart.
 *
 * A clock time that does not exist on the earlier day — the hour a spring
 * forward skips — is normalised by the runtime to the hour after it, which keeps
 * the DATE and moves only the time of day. That is checked rather than assumed:
 * the instant is fed back through `recentNights` and must name the same day key,
 * and anything else returns null rather than a day the two halves disagree about.
 *
 * Null when `now` is not a readable instant. Ours, not the member's, and it must
 * never be allowed to read as an empty day.
 */
export function yesterdayOf(now: Date): { day: string; at: Date } | null {
  const ms = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(ms)) return null;
  const day = recentNights(2, now)[1];
  if (!day) return null;
  const at = new Date(
    now.getFullYear(), now.getMonth(), now.getDate() - 1,
    now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds(),
  );
  if (!Number.isFinite(at.getTime())) return null;
  return recentNights(1, at)[0] === day ? { day, at } : null;
}

/**
 * Whether two scores are percentages of the same denominator.
 *
 * Element for element over `Readiness.from`, which `readinessScore` emits in one
 * fixed order (sleep, recovery, hydration, load), so position is exact and no
 * sort is needed. See the header on why this is the SET and not the count.
 */
function sameScale(a: readonly ReadinessSignal[], b: readonly ReadinessSignal[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, n) => s === b[n]);
}

/** "up 9", "down 9", "no change" — through deltaLabel's sign decision rather
 *  than a hand-rolled one, because zero is neither direction and this codebase
 *  has written that wrong about twenty-five times. */
function movement(delta: number): string {
  const magnitude = deltaMagnitude(delta, DP);
  // `deltaMoved` is false for a difference that ROUNDS to nothing as well as for
  // a true zero, which is the distinction deltaLabel.ts was written for: the
  // figure the reader sees is the figure the sentence must agree with.
  if (magnitude == null || !deltaMoved(delta, DP)) return 'no change from yesterday';
  return `${deltaSign(delta, DP) === '+' ? 'up' : 'down'} ${magnitude} from yesterday`;
}

/**
 * Which way today's readiness has moved, or which of the four reasons there is
 * no saying.
 *
 * Returns **null when there is no score today**: a direction is a thing said
 * about a number, and on a day with no number `ReadinessBreakdown.absence`
 * already says the whole of what there is to say. A second sentence about a
 * missing yesterday, under a hero showing a dash, would be an answer to a
 * question nobody could have asked.
 *
 * `now` defaults to the clock for the same reason `readinessSleep`'s does — for
 * tests and for any future caller. Pass it explicitly from a memo, so the day
 * this compares against and the day the score was built for are one clock read
 * and not two; scripts/check-frozen-hook.mjs is the gate on that.
 */
export function readinessDirection(
  today: Readiness | null,
  yesterday: ReadinessYesterday,
  now: Date = new Date(),
): ReadinessDirection | null {
  // No score, or a score that is not a readable number: nothing to give a
  // direction to, and `ReadinessBreakdown.absence` already holds that ground.
  if (today == null || typeof today.score !== 'number' || !Number.isFinite(today.score)) return null;

  const y = yesterdayOf(now);
  if (!y) {
    // Ours. We could not work out which day to compare against, so we do not
    // know what is in it — unread, on the same reasoning `readinessSleep` maps
    // its 'unknown' window onto an unread sleep row rather than an empty one.
    return {
      state: 'unread', delta: null, against: null,
      detail: 'we could not work out which day yesterday was, so we cannot say which way you have moved',
      caveat: 'We could not work out which day to compare this against, so we cannot say whether it has gone up or down.',
    };
  }

  if (yesterday.status === 'loading') {
    // In flight is not failed. No caveat: a read that has not finished has not
    // gone wrong, which is how `caveatsFor` already treats a loading hydration.
    return { state: 'unread', delta: null, against: y.day, detail: 'still reading yesterday’s readiness', caveat: null };
  }
  if (!isWhole(yesterday.status)) {
    return {
      state: 'unread', delta: null, against: y.day,
      detail: 'we could not read yesterday’s readiness, so we cannot say which way you have moved',
      caveat: 'Yesterday’s readiness could not be read, so we cannot say whether this number has gone up or down.',
    };
  }

  const prev = yesterday.score;
  if (prev == null || typeof prev.score !== 'number' || !Number.isFinite(prev.score)) {
    return {
      state: 'no-record', delta: null, against: y.day,
      detail: 'no readiness on record for yesterday, so there is no direction to show, which does not mean nothing changed',
      caveat: null,
    };
  }

  if (prev.day !== y.day) {
    // Strings against strings. `YYYY-MM-DD` sorts the way the calendar does, and
    // parsing either side back into a Date would take UTC midnight and move the
    // comparison a day for most of the world.
    if (prev.day < y.day) {
      // Recorded-but-older is not unrecorded, and it is not yesterday either —
      // the same distinction `readinessSleep` draws between 'stale' and 'none'.
      return {
        state: 'no-record', delta: null, against: y.day,
        detail: 'no readiness on record for yesterday; the most recent day you have is older than that',
        caveat: null,
      };
    }
    // Dated today or later. Nothing about the member is wrong here; we were
    // handed the wrong day, which is ours.
    return {
      state: 'unread', delta: null, against: y.day,
      detail: 'the readiness we were handed is not yesterday’s, so we cannot say which way you have moved',
      caveat: 'Yesterday’s readiness could not be read, so we cannot say whether this number has gone up or down.',
    };
  }

  if (!sameScale(today.from, prev.from)) {
    return {
      state: 'not-comparable', delta: null, against: y.day,
      detail: 'yesterday’s score was built from different signals, so the two numbers are not on the same scale',
      caveat: 'Yesterday’s score was built from different signals to today’s, so the two cannot be compared.',
    };
  }

  const delta = today.score - prev.score;
  return { state: 'scored', delta, against: y.day, detail: movement(delta), caveat: null };
}
