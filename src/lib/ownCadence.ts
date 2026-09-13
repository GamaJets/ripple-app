// Client · the member's own training cadence, said to the member.
//
// ── The asymmetry this closes ──────────────────────────────────────────────
//
// src/lib/cadence.ts has told the COACH, since it was written, that a named
// client is four days past their own usual gap. The member — the person whose
// gap it is — got eighty-four coloured squares and was left to notice. A
// heatmap is a picture of the record, not a reading of it: a sighted member can
// see that a column is emptier than the ones before it and cannot tell you what
// their usual interval was, which is the only number that makes "emptier" mean
// anything. `app/(client)/consistency.tsx` never stated it, and neither did
// restday.tsx.
//
// ── Why this calls assessCadence rather than computing a median ────────────
//
// Because the whole value of the thing is that it is THE SAME NUMBER. A second
// median, written here over the same days, would agree with the coach's until
// the first time somebody changed `MIN_ACTIVE_DAYS`, `MAX_USUAL_GAP_DAYS` or
// the median-not-mean rule in one file and not the other — and the failure then
// is a coach saying "you've slipped to every six days" to a member whose own
// app says five. There is one derivation, in src/lib/cadence.ts, and this
// module is the member's WORDS for it and nothing else. Every threshold, every
// refusal and every `noPattern` reason comes from there untouched.
//
// The window is `DEFAULT_WINDOWS.historyDays` for the same reason: it is what
// `buildNudgeBoard` passes in src/ui/nudges.ts, so the two readings are taken
// over the same span as well as by the same function.
//
// ── What this must not do ─────────────────────────────────────────────────
//
// Diagnose. `WHAT_IT_CANNOT_SEE` in src/lib/nudge.ts is the argument in full
// and it applies harder here, because the reader is the subject. "You are five
// days past your usual gap" is a statement about the RECORD; the same shape is
// produced by a holiday, an injury, a house move, a chest infection and a week
// of night shifts, and the member knows which one it was. So nothing below
// tells anybody to train, congratulates them for training, or attaches a
// judgement to a number. The sentences say what the app was told and stop.
//
// Nag. `worthRaising` in cadence.ts surfaces only 'overdue' to a coach, because
// 'due' is everybody every week. The member's screen is different in one
// respect and one only: they OPENED it, so the figure is answering a question
// they asked rather than interrupting them. That earns the gap and the days
// since — it does not earn a tone. 'due' and 'inside' read identically here
// apart from the arithmetic, which is the point.
//
// ── Null is not zero, and this is where it bites ──────────────────────────
//
// An unread log is an empty array. Run through `assessCadence` it produces
// `no-events`, whose coach-facing sentence is "Nothing on record in the window
// read" — which, printed to a member who trained yesterday because their wifi
// dropped, is the app telling them their training did not happen. So the status
// is gated HERE, inside the tested module, rather than left to a `known &&` in
// JSX that the next edit to that screen can drop. 'error' and 'loading' never
// reach `assessCadence` at all and get their own two sentences, which are
// different from each other because one of them ends on its own.
import { assessCadence, type Cadence } from './cadence';
import { DEFAULT_WINDOWS, type ActivityEvent } from './clientDrift';
import type { LoadStatus } from '../ui/loadStatus';

/** The one field this needs off a logged workout: when it was performed, ISO.
 *  Deliberately structural rather than importing `WorkoutEntry` from a provider
 *  — the rules must stay runnable under plain node. */
export interface LoggedAt {
  t: string;
}

/**
 * Logged workouts as the activity events `assessCadence` reads.
 *
 * `kind: 'workout'` for every one of them, because that is what they are. It
 * changes no arithmetic — `activeDayLog` collapses a day's events to one day
 * whatever their kinds — and it keeps the member's input honest about its
 * source rather than borrowing a kind it cannot prove.
 *
 * A row with an unparseable `t` is left in rather than filtered: `parsed()`
 * inside `activeDayLog` already drops what it cannot read, and a second filter
 * here would be a second place for the two to disagree about what a date is.
 */
export function loggedEvents(log: readonly LoggedAt[]): ActivityEvent[] {
  return log.map((l) => ({ at: l.t, kind: 'workout' as const }));
}

/** Which of the three things this screen can be looking at. */
export type CadenceReading =
  /** The log was not read, or is still being read. Says NOTHING about how often
   *  the member trains — see the header. */
  | 'unread'
  /** The log was read and does not settle on a usual gap yet. */
  | 'unsettled'
  /** There is a usual gap and it is stated. */
  | 'paced';

export interface OwnCadence {
  reading: CadenceReading;
  /**
   * The coach's own verdict object, untouched, or null when the read did not
   * land. Null is not a cadence of zero and not a member who never trains — it
   * is the absence of a basis for saying anything.
   */
  cadence: Cadence | null;
  /** "about every 3 days", or null when there is no settled gap. For a figure
   *  slot beside a label; the sentence below repeats it in context. */
  gapLabel: string | null;
  /** "5 days", or null when nothing is on record to count from. Days since the
   *  newest LOGGED day, which is not the same as days since they last trained
   *  — see `OWN_CADENCE_SOURCE`. */
  sinceLabel: string | null;
  /** The whole thing as one sentence a member reads without interpreting. */
  line: string;
}

/**
 * What this figure is counted from, said out loud wherever it is shown.
 *
 * NOT decoration. The coach's copy in src/ui/nudges.ts is fed by
 * `c.activity.events`, which carries check-ins, door visits and delivered
 * sessions as well as logged workouts; this screen has the workout log and
 * nothing else. So a member who trains four times a week at the gym and logs
 * none of it is correctly told their LOG has been quiet for eleven days, and
 * will read that as the app claiming they have not trained unless the sentence
 * beside it says which record it is talking about.
 *
 * The heatmap directly above it has always had the same limit and never said
 * so either.
 */
export const OWN_CADENCE_SOURCE =
  'Counted from the sessions you have logged in the app. Training you did not log is not in it, and a gap here is a gap in the log rather than a fact about your week.';

/** Days, pluralised, with the one-decimal gap left as it comes off
 *  `assessCadence` — `usualGapDays` is `Math.round(n * 10) / 10`, so a client
 *  who alternates two and three days has a usual gap of 2.5 and rounding it to
 *  "3" here would print a different number from the one the coach reads. */
const days = (n: number): string => `${n} day${n === 1 ? '' : 's'}`;

/**
 * The member's reading of their own cadence.
 *
 * `status` is the workout log's, and the two statuses that are refused are
 * refused for different reasons: 'loading' is a read that has not finished and
 * will, 'error' is one that did not happen. 'partial' IS admitted, and the
 * argument is the one app/(client)/consistency.tsx already makes about its own
 * grid: src/ui/workoutLog.tsx orders `performed_at` descending before the cap,
 * so a truncated read holds the NEWEST rows. Every gap computed from a
 * newest-end prefix is a real gap between two real logged days — the only thing
 * a prefix can do is end the record early, which costs active days and can only
 * push this toward a refusal. Under-claiming is safe here; over-claiming is the
 * failure this file exists to avoid.
 */
export function readOwnCadence(
  log: readonly LoggedAt[],
  status: LoadStatus,
  now: number = Date.now(),
  windowDays: number = DEFAULT_WINDOWS.historyDays,
): OwnCadence {
  if (status === 'loading' || status === 'error') {
    return {
      reading: 'unread',
      cadence: null,
      gapLabel: null,
      sinceLabel: null,
      line: status === 'loading'
        ? 'Reading your training log…'
        // Never "you have not trained". The log is unknown, not empty, and this
        // is the sentence src/ui/loadStatus.ts was written about.
        : 'Your training log didn’t load, so there is no usual gap to show. That is a read that failed — not a quiet few weeks.',
    };
  }

  const c = assessCadence(loggedEvents(log), now, windowDays);
  const since = c.sinceLastDays == null ? null : days(c.sinceLastDays);

  // Both halves checked, not just the state. `usualGapDays` and `sinceLastDays`
  // are null together with 'unknown' by construction today, and a sentence that
  // would print "about every null days" if that ever stopped being true is not
  // a sentence to leave load-bearing on a screen somebody reads about
  // themselves.
  if (c.state === 'unknown' || c.usualGapDays == null || since == null) {
    return {
      reading: 'unsettled',
      cadence: c,
      gapLabel: null,
      sinceLabel: since,
      line: unsettledLine(c, windowDays),
    };
  }

  const gap = `about every ${days(c.usualGapDays)}`;
  return {
    reading: 'paced',
    cadence: c,
    gapLabel: gap,
    sinceLabel: since,
    line: pacedLine(c, gap, since),
  };
}

/**
 * How far back this was counted, in the units a person thinks in.
 *
 * Derived from `windowDays` rather than written into the copy as "eight weeks".
 * The window is an argument with a default, and a hardcoded phrase beside a
 * configurable number is the shape of every caption in this app that has ever
 * come to contradict the figure above it.
 */
function windowPhrase(windowDays: number): string {
  if (windowDays % 7 === 0) {
    const w = windowDays / 7;
    return `the last ${w} week${w === 1 ? '' : 's'}`;
  }
  return `the last ${days(windowDays)}`;
}

/**
 * Why there is no usual gap, in the second person.
 *
 * One sentence per `noPattern` reason, and they are different sentences rather
 * than one polite shrug because they mean different things to the person
 * reading: one of them fills in by itself in a fortnight, one of them is the
 * app admitting it read nothing, and one of them is "your training is spaced
 * too widely for this to be a useful instrument", which is not a fault.
 */
function unsettledLine(c: Cadence, windowDays: number): string {
  const window = windowPhrase(windowDays);
  switch (c.noPattern) {
    case 'no-events':
      return `Nothing logged in ${window}, so there is no usual gap to measure against yet.`;
    case 'too-few':
      return `Only ${days(c.activeDays)} logged in ${window} — too few to say what your usual gap between sessions is.`;
    case 'too-short':
      return 'Your logged sessions don’t cover enough time yet to settle on a usual gap. It fills in as you log.';
    case 'too-spread':
      // Said without a hint of reproach on purpose. A member who trains every
      // four weeks is training every four weeks; the instrument is what does
      // not apply, and saying otherwise here would be the nagging the header
      // refuses.
      return 'Your sessions are spaced too far apart for a usual gap to be a useful thing to pace against.';
    default:
      return 'There is no usual gap to measure against yet.';
  }
}

/**
 * The gap, the silence and the arithmetic between them.
 *
 * Three sentences for the three states, and the difference between 'due' and
 * 'overdue' is stated as a NUMBER rather than as a verdict: "three days past"
 * is checkable and "you're slipping" is not. No exclamation, no streak talk, no
 * suggestion about what to do next — see the header.
 */
function pacedLine(c: Cadence, gap: string, since: string): string {
  if (c.state === 'inside') {
    return `You log a session ${gap}. The last one was ${since} ago, so you are inside your own usual gap.`;
  }
  // 'due' and 'overdue' both land here when `overdueDays` is somehow absent.
  // The fallback states the two facts and draws no arithmetic between them,
  // which is the honest thing to print when the third number is missing.
  if (c.state === 'due' || c.overdueDays == null) {
    return `You log a session ${gap}. The last one was ${since} ago — just past it, which is the ordinary width of a week.`;
  }
  return `You log a session ${gap}. The last one was ${since} ago, which is ${days(c.overdueDays)} past your own usual gap.`;
}
