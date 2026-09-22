// What a client is working toward, and how far along they are.
//
// Pure — no react, no supabase — because the arithmetic here is the part that
// can be wrong quietly. It used to live inline in app/(client)/goal.tsx, where
// nothing could reach it: a projected finish date is a claim about the future
// and it was being made by untested code.
//
// The rules the rest of this module exists to keep:
//
//  · Nothing measured means nothing said. Every function here returns null
//    rather than a zero, a 0% or a date, when the readings to support it do
//    not exist. See progressOf and projectionOf.
//  · Progress starts when the GOAL does. Counting from the client's oldest
//    reading credited them for weight lost last year against a target they set
//    this morning — the ring opened at 60% before they had done anything.
//  · A rate needs a window. Two weigh-ins a day apart differing by 400 g is
//    water, and extrapolating it produced finish dates that moved by months
//    between launches.
//  · A goal with no number is never given one. A custom goal is a sentence;
//    percentages of sentences are how "progress" stops meaning anything.

// A bare `date` column read as the day it says, not as UTC midnight. See the
// note on `isOverdue`.
import { localDate } from './localDate';

export type GoalKind = 'weight' | 'bodyfat' | 'muscle' | 'custom';
/** The kinds with a series behind them. 'custom' is deliberately not one. */
export type MeasuredKind = Exclude<GoalKind, 'custom'>;

export const MEASURED_KINDS: readonly MeasuredKind[] = ['weight', 'bodyfat', 'muscle'];

export const GOAL_METRIC: Record<MeasuredKind, { label: string; unit: string; source: string }> = {
  weight:  { label: 'Target Weight',    unit: 'kg', source: 'weigh-ins and scans' },
  bodyfat: { label: 'Target Body Fat',  unit: '%',  source: 'scans' },
  muscle:  { label: 'Target Muscle',    unit: 'kg', source: 'scans' },
};

export interface GoalTarget {
  id: string;
  kind: GoalKind;
  /** The number being aimed at, in the metric's unit. Always null for 'custom'. */
  targetValue: number | null;
  /** The client's own words. Always null for the measured kinds. */
  title: string | null;
  targetDateISO: string | null;
  achievedAtISO: string | null;
  /** When the goal was set. Progress is measured from here, not from the start
   *  of the client's history. */
  createdAtISO: string;
}

export interface Point { t: string; v: number }

export function isMeasured(g: GoalTarget): g is GoalTarget & { kind: MeasuredKind; targetValue: number } {
  return g.kind !== 'custom' && g.targetValue != null;
}

/** The label to put on a goal wherever it is listed. */
export function goalLabel(g: GoalTarget): string {
  return g.kind === 'custom' ? (g.title ?? '') : GOAL_METRIC[g.kind].label;
}

const ms = (iso: string) => Date.parse(iso);

/**
 * The reading progress is measured FROM: the last one taken at or before the
 * goal was set.
 *
 * A client who sets a target today has a baseline of what they weigh today,
 * even if the app has watched them for a year. When there is no reading before
 * the goal, the earliest one after it stands in — the alternative is refusing
 * to show progress to somebody who set a goal first and weighed in second,
 * which is the order most people do it in.
 */
export function startPoint(series: readonly Point[], createdAtISO: string): Point | null {
  if (!series.length) return null;
  const sorted = [...series].sort((a, b) => ms(a.t) - ms(b.t));
  const at = ms(createdAtISO);
  let before: Point | null = null;
  for (const p of sorted) {
    if (ms(p.t) <= at) before = p; else break;
  }
  return before ?? sorted[0];
}

export interface GoalProgress {
  start: number;
  current: number;
  target: number;
  /** 0–100, clamped. Never negative: moving the wrong way is 0% of the way
   *  there, not −40% of it. */
  pct: number;
  /** Signed, in the metric's unit. Positive means the target is still above
   *  the current reading. */
  remaining: number;
  reached: boolean;
}

/**
 * How far along a measured goal is, or null when it cannot be said: a custom
 * goal, a goal with no target, or a client with no readings.
 */
export function progressOf(goal: GoalTarget, series: readonly Point[]): GoalProgress | null {
  if (!isMeasured(goal)) return null;
  const from = startPoint(series, goal.createdAtISO);
  if (!from) return null;
  const sorted = [...series].sort((a, b) => ms(a.t) - ms(b.t));
  const current = sorted[sorted.length - 1].v;
  const target = goal.targetValue;
  const span = target - from.v;
  // Already at the target when the goal was set. The goal is met, and dividing
  // by the zero span would be the only other answer.
  const pct = span === 0 ? 100 : Math.max(0, Math.min(100, Math.round(((current - from.v) / span) * 100)));
  const remaining = +(target - current).toFixed(2);
  return {
    start: from.v,
    current,
    target,
    pct,
    remaining,
    // Crossing counts, not just landing on it: somebody aiming at 80 kg who
    // reaches 78 has got there.
    reached: span === 0 || (span > 0 ? current >= target : current <= target),
  };
}

/** Below this the two readings are too close together for the difference
 *  between them to be a trend rather than a fluctuation. */
export const MIN_TREND_DAYS = 7;

export type Projection =
  | { kind: 'eta'; weeklyRate: number; etaMs: number }
  | { kind: 'reached' }
  | { kind: 'flat' }
  | { kind: 'wrongway'; weeklyRate: number }
  | { kind: 'tooshort'; days: number }
  | null;

/**
 * Where the client's own trend says they will land — computed only from
 * readings taken since the goal was set, because a rate is meant to describe
 * the effort being made now.
 *
 * null means there is nothing to project from at all. 'tooshort' means there
 * are readings but they do not yet span MIN_TREND_DAYS, which is a different
 * thing to say and worth saying.
 */
export function projectionOf(goal: GoalTarget, series: readonly Point[], nowMs: number): Projection {
  if (!isMeasured(goal)) return null;
  const from = startPoint(series, goal.createdAtISO);
  if (!from) return null;
  const since = [...series].sort((a, b) => ms(a.t) - ms(b.t)).filter((p) => ms(p.t) >= ms(from.t));
  if (since.length < 2) return null;

  const prog = progressOf(goal, series);
  if (prog?.reached) return { kind: 'reached' };

  const first = since[0], last = since[since.length - 1];
  const days = (ms(last.t) - ms(first.t)) / 86400000;
  if (!(days >= MIN_TREND_DAYS)) return { kind: 'tooshort', days: Math.max(0, Math.round(days)) };

  const weeklyRate = (last.v - first.v) / (days / 7);
  const gap = goal.targetValue - last.v;
  // A rate of zero has no finish date; neither does one pointing away from the
  // target. Reporting either as a date would be inventing the future outright.
  if (weeklyRate === 0) return { kind: 'flat' };
  if (Math.sign(gap) !== Math.sign(weeklyRate)) return { kind: 'wrongway', weeklyRate };

  const weeks = Math.abs(gap / weeklyRate);
  return { kind: 'eta', weeklyRate, etaMs: nowMs + weeks * 7 * 86400000 };
}

/**
 * Whether a target date has gone by with the goal still open.
 *
 * ── Two things this got wrong, and they compounded ────────────────────────
 *
 * It was `Date.parse(goal.targetDateISO) < nowMs`.
 *
 * `goal_targets.target_date` is a bare Postgres `date`, and `Date.parse` of a
 * bare date is UTC MIDNIGHT — the instant the day BEGINS, somewhere else. So a
 * goal targeted at the 12th went overdue at the first moment of the 12th in
 * UTC, which is:
 *
 *   · the 12th, all day, for the person whose goal it is. "By 12 Sep" and
 *     "Target date passed (12 Sep)" on the same screen on the same morning.
 *   · from 17:00 on the ELEVENTH in Los Angeles, so a coach there chased a
 *     client about a deadline the client still had a whole day of.
 *   · not until 14:00 on the 12th in Kiritimati, so the same coach reading
 *     from the other side of the line saw the opposite.
 *
 * A target date is a calendar day in the goal-setter's own life, and a day is
 * not late until it is over. `localDate` reads the bare date as LOCAL midnight
 * (src/lib/localDate.ts is the file that exists for this exact trap), and the
 * deadline is the local midnight that ENDS it — the next day's, computed by
 * calendar arithmetic rather than by adding 86,400,000, because two days a
 * year are 23 and 25 hours long.
 *
 * `isOverdue` on a gym invoice, in src/lib/monthEnd.ts, has always said "an
 * invoice due today is not late today" and says it by comparing two bare date
 * strings and never building a Date at all. This is the same rule; it could not
 * be written the same way only because the signature here takes an instant.
 */
export function isOverdue(goal: GoalTarget, nowMs: number): boolean {
  if (goal.achievedAtISO || !goal.targetDateISO) return false;
  const d = localDate(goal.targetDateISO);
  if (!d) return false;
  const dayIsOver = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return nowMs >= dayIsOver;
}

/**
 * How much deadline pressure a client's open goals are under — and how many of
 * them nothing can be said about.
 *
 * ── why a tally and not a filter on the screen ────────────────────────────
 *
 * app/(trainer)/client-goals.tsx lists the open goals and marks each overdue
 * one with a dot beside its own line. That is the whole of what a coach had:
 * to know whether anything had slipped they had to read every card, and on a
 * client with eleven goals the answer was somewhere in the scroll. Every
 * comparable product puts this at the top of the goal board instead, because
 * "two of these are past their date" is the sentence that decides whether the
 * coach opens a message.
 *
 * ── the four buckets, and why the last two are not folded into the others ─
 *
 * A figure here is a claim about somebody's commitments, so the goals this
 * cannot judge are counted and named rather than quietly landing in `ahead`:
 *
 *   · `overdue`    — the target day is over. `isOverdue`'s rule exactly, which
 *                    is the local end of the local day and not one minute
 *                    earlier. See the essay above it.
 *   · `soon`       — the target day is today, or within `soonDays` after it.
 *                    Today is `soon` and never `overdue`: a day is not late
 *                    until it is over, and that is the one boundary this
 *                    module's test file exists for.
 *   · `undated`    — an open goal with no target date at all. Perfectly
 *                    ordinary — "get stronger" has no deadline — and it is not
 *                    on time, because there is no time for it to be on.
 *   · `unreadable` — an open goal carrying a target date that would not parse.
 *                    A row written by a build this one does not understand.
 *                    Separated from `undated` because they are different
 *                    things to do something about: one is a client who set no
 *                    date, the other is a record this app cannot read.
 *
 * `ahead` is deliberately absent. A coach does not act on it, and deriving it
 * as "the rest" is exactly how an unreadable row would be counted as on time.
 *
 * Achieved goals are not counted in any bucket. A goal marked done on the day
 * after its target is not overdue; it is done. `isOverdue` already says so and
 * the same guard is repeated here for the other three.
 */
export interface DeadlineTally {
  /** Open goals whose target day is over. */
  readonly overdue: number;
  /** Open goals due today or within `soonDays` days after today. */
  readonly soon: number;
  /** Open goals with no target date at all. */
  readonly undated: number;
  /** Open goals whose target date would not parse. */
  readonly unreadable: number;
}

/**
 * @param goals    the client's goals — ALL of them, achieved included; this
 *                 filters. Null is not an empty book: callers hand null when
 *                 the read did not land, and the answer is null, never zeros.
 * @param nowMs    the instant to judge against. From `useNow()` on a screen,
 *                 never a bare `Date.now()` in a render body: client-goals is
 *                 registered `href: null` and is never torn down.
 * @param soonDays how far ahead counts as soon. Seven, because a coach's unit
 *                 of planning is the week; an explicit parameter because the
 *                 caller, not this file, knows what it is going to say.
 */
export function deadlineTally(
  goals: readonly GoalTarget[] | null | undefined,
  nowMs: number,
  soonDays = 7,
): DeadlineTally | null {
  if (!Array.isArray(goals)) return null;
  let overdue = 0; let soon = 0; let undated = 0; let unreadable = 0;
  // The last instant that still counts as soon: the local end of the day
  // `soonDays` after today. Built by calendar arithmetic on the LOCAL day, for
  // the reason isOverdue gives — two days a year are not 24 hours long, and
  // adding milliseconds gets both of them wrong.
  const now = new Date(nowMs);
  const soonEnds = new Date(
    now.getFullYear(), now.getMonth(), now.getDate() + soonDays + 1,
  ).getTime();
  for (const g of goals) {
    if (g.achievedAtISO) continue;
    if (!g.targetDateISO) { undated += 1; continue; }
    const d = localDate(g.targetDateISO);
    if (!d) { unreadable += 1; continue; }
    // `isOverdue` rather than a second comparison, so there is one definition
    // of "the day is over" and its test file governs both callers.
    if (isOverdue(g, nowMs)) { overdue += 1; continue; }
    const dayIsOver = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    if (dayIsOver <= soonEnds) soon += 1;
  }
  return { overdue, soon, undated, unreadable };
}

/**
 * The tally as a sentence, for the top of a coach's goal board.
 *
 * Two clauses, and the second one is the whole reason this is not a number.
 *
 * The first clause is the figure: how many open goals have run past their date,
 * and how many are about to. The second names the goals the first clause could
 * not speak for, and how many, because a board reading "none are past their
 * target date" over four goals that never had one is an all-clear drawn from an
 * empty set. That is the house rule and this is where it is kept for this
 * screen.
 *
 * Returns null when there is nothing to say at all, which is only the case for
 * a client with no open goals: the caller is already drawing "none set" or "all
 * reached" for that and does not want a second sentence underneath it.
 *
 * No dash inside a sentence anywhere in here. scripts/check-prose.mjs walks
 * every string this file exports.
 */
export function deadlineNote(tally: DeadlineTally | null | undefined): string | null {
  if (!tally) return null;
  const { overdue, soon, undated, unreadable } = tally;
  if (overdue + soon + undated + unreadable === 0) return null;

  const goalWord = (n: number) => (n === 1 ? 'goal' : 'goals');
  const parts: string[] = [];

  if (overdue > 0) {
    parts.push(`${overdue} ${goalWord(overdue)} ${overdue === 1 ? 'is' : 'are'} past ${overdue === 1 ? 'its' : 'their'} target date.`);
  }
  if (soon > 0) {
    parts.push(`${soon} ${overdue > 0 ? 'more ' : ''}${goalWord(soon)} ${soon === 1 ? 'is' : 'are'} due within a week.`);
  }
  // Said even when both figures above are zero, because "nothing is late" is a
  // claim and it is the one a coach acts on by doing nothing.
  if (overdue === 0 && soon === 0) {
    parts.push('Nothing with a target date is late or due within a week.');
  }

  if (undated > 0) {
    parts.push(`${undated} ${goalWord(undated)} ${undated === 1 ? 'has' : 'have'} no target date, so ${undated === 1 ? 'it is' : 'they are'} in neither figure.`);
  }
  if (unreadable > 0) {
    parts.push(`${unreadable} ${goalWord(unreadable)} ${unreadable === 1 ? 'carries a target date' : 'carry target dates'} this app could not read, so ${unreadable === 1 ? 'it is' : 'they are'} in neither figure either.`);
  }

  return parts.join(' ');
}

/** List order: open goals before achieved ones, then by target date, with
 *  undated goals last rather than sorted as though their date were zero. */
export function sortGoals(goals: readonly GoalTarget[]): GoalTarget[] {
  return [...goals].sort((a, b) => {
    const done = Number(!!a.achievedAtISO) - Number(!!b.achievedAtISO);
    if (done) return done;
    const ad = a.targetDateISO ? ms(a.targetDateISO) : Infinity;
    const bd = b.targetDateISO ? ms(b.targetDateISO) : Infinity;
    if (ad !== bd) return ad - bd;
    return ms(a.createdAtISO) - ms(b.createdAtISO);
  });
}
