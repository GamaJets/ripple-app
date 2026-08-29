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

export type GoalKind = 'weight' | 'bodyfat' | 'muscle' | 'custom';
/** The kinds with a series behind them. 'custom' is deliberately not one. */
export type MeasuredKind = Exclude<GoalKind, 'custom'>;

export const MEASURED_KINDS: readonly MeasuredKind[] = ['weight', 'bodyfat', 'muscle'];

export const GOAL_METRIC: Record<MeasuredKind, { label: string; unit: string; source: string }> = {
  weight:  { label: 'Target weight',    unit: 'kg', source: 'weigh-ins and scans' },
  bodyfat: { label: 'Target body fat',  unit: '%',  source: 'scans' },
  muscle:  { label: 'Target muscle',    unit: 'kg', source: 'scans' },
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

/** Whether a target date has gone by with the goal still open. */
export function isOverdue(goal: GoalTarget, nowMs: number): boolean {
  if (goal.achievedAtISO || !goal.targetDateISO) return false;
  return ms(goal.targetDateISO) < nowMs;
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
