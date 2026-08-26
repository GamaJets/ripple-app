// ── The long view ────────────────────────────────────────────────────────────
//
// Every progress screen in the app is a slice or a snapshot. Trends graphs ten
// weeks. Consistency draws twelve. Week shows this week, Report shows a period,
// Records shows the current best and nothing about how it got there. Add them
// all up and the longest window a member can see is ten weeks — so somebody who
// has trained for a year cannot see that year, and the one question that keeps
// a person training ("how far have I actually come?") has no screen.
//
// This module is the arithmetic for that screen. It is deliberately pure and
// framework-free — no React, no Supabase, not even a date library — so the same
// reasoning runs in the app and under plain `node` in the test suite. The read
// stays in the screen, because the read is where the failure modes live.
//
// ── Three rules this file exists to keep ───────────────────────────────────
//
// 1. A MONTH WITH NO TRAINING IS NOT A MONTH WITH ZERO VOLUME.
//    The obvious implementation buckets the log by month and writes 0 into
//    every empty bucket. That is a fabricated measurement: it says "in March
//    you lifted zero kilograms", which the app does not know. It knows only
//    that March has no logged sessions in it. Somebody may have trained all
//    March in a gym on holiday with no phone. So an untrained month carries
//    `trained: false` and NULL in every figure, and the screen draws it as a
//    hole rather than as a bar of height nothing. The difference is not
//    pedantic: a zero plots on a chart and drags a mean down; a null does not.
//
// 2. GAPS STAY VISIBLE.
//    A member who stopped for two months and came back has a story, and the
//    return is the best part of it. A smoothed line through that gap deletes
//    it — which is exactly why the monthly chart is BARS and not a line: a
//    polyline between February and May draws ink across March and April and
//    invents a trajectory through months nobody trained. `gaps()` finds the
//    breaks so the screen can name them instead of hiding them.
//
// 3. A SHORT HISTORY IS NOT A FAILED LONG ONE.
//    The lazy long view is a fixed twelve-month frame. For somebody three weeks
//    in that is eleven blank months and one thin bar — a picture of failure
//    drawn for a person who has done nothing wrong. So the window is not fixed:
//    it starts at the member's FIRST logged session and runs to this month, and
//    `yearRows()` marks the months before that as `null` — outside your
//    history, not empty within it. Three weeks in, the page is small and
//    truthful and says how many days you are in. See `stageOf` / `historyNote`.
//
// Volume is Σ reps × weight, matching `weekStats` in streaks.ts, so the figures
// here reconcile with the ones the rest of the app already shows.
import type { WorkoutEntry } from './mockData';
import { est1RM } from './streaks';

const DAY = 86_400_000;

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How far back the view will reach: three year-rows. Beyond that the screen
 *  says how many earlier months exist rather than drawing a wall of cells. */
export const MAX_MONTHS = 36;

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * LOCAL calendar month (not UTC), for the same reason `streaks.dayKey` uses the
 * local day: a session logged on the evening of 31 January belongs to January
 * for the person who trained, even though its ISO timestamp is already February
 * in UTC. Returns null for an unparseable timestamp — a corrupt row must not
 * take the whole history down with it.
 */
export function monthKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** LOCAL calendar day, mirroring streaks.ts. Null on an unparseable timestamp. */
function dayKeyOf(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function ymOf(key: string): { year: number; month: number } {
  const [y, m] = key.split('-');
  return { year: Number(y), month: Number(m) - 1 };
}

const keyOf = (year: number, month: number) => `${year}-${pad2(month + 1)}`;

/** The month after `key`. Used to walk a span; wraps the year for December. */
export function nextMonth(key: string): string {
  const { year, month } = ymOf(key);
  return month >= 11 ? keyOf(year + 1, 0) : keyOf(year, month + 1);
}

/** 'Mar 2026'. An unrecognised key is returned as-is rather than guessed at. */
export function monthLabel(key: string): string {
  const { year, month } = ymOf(key);
  const name = MONTH_LABELS[month];
  return name && Number.isFinite(year) ? `${name} ${year}` : key;
}

/** Whole calendar months from `a` to `b` inclusive of both ends. */
export function monthsBetween(a: string, b: string): number {
  const x = ymOf(a), y = ymOf(b);
  return (y.year - x.year) * 12 + (y.month - x.month) + 1;
}

/* ── one month ─────────────────────────────────────────────────────────────
 *
 * Every figure is nullable, and each null means something specific:
 *
 *   trained === false   nothing was logged in this month at all. Every figure
 *                       is null. This is rule 1 above.
 *   volumeKg === null   on a TRAINED month this means the month had sessions
 *                       but no weighted sets — a month of pure cardio or
 *                       bodyweight work. Tonnage has no inputs, so it is not
 *                       zero, it is unknown, and it prints as an em dash.
 *   kcal === null       nothing in the month carried a calorie figure. Summing
 *                       an absent field to 0 would report "0 kcal burned" for
 *                       a member with no watch.
 *   best1RM === null    no set with both reps and weight, so no estimate.
 */
export interface MonthCell {
  /** 'YYYY-MM'. */
  key: string;
  year: number;
  /** 0–11. */
  month: number;
  /** 'Mar' — the short label a grid column carries. */
  label: string;
  /** At least one session was logged in this month. */
  trained: boolean;
  /** Distinct sessions. One session writes every exercise with the same
   *  `performed_at` (see WorkoutEntry.id), so distinct timestamps count them. */
  sessions: number | null;
  /** Distinct local calendar days trained. */
  days: number | null;
  volumeKg: number | null;
  kcal: number | null;
  /** Best single-set estimated 1RM anywhere in the month, across all lifts. */
  best1RM: number | null;
  /** The lift that carried the most volume this month. */
  topLift: string | null;
}

function blankCell(key: string): MonthCell {
  const { year, month } = ymOf(key);
  return {
    key, year, month, label: MONTH_LABELS[month] ?? key,
    trained: false, sessions: null, days: null, volumeKg: null, kcal: null,
    best1RM: null, topLift: null,
  };
}

function cellFrom(key: string, entries: WorkoutEntry[]): MonthCell {
  const cell = blankCell(key);
  if (!entries.length) return cell;

  const sessions = new Set<string>();
  const days = new Set<string>();
  const volByLift = new Map<string, number>();
  let volume = 0, anyVolume = false;
  let kcal = 0, anyKcal = false;
  let best = 0, anyBest = false;

  for (const e of entries) {
    sessions.add(e.t);
    const dk = dayKeyOf(e.t);
    if (dk) days.add(dk);
    if (typeof e.kcal === 'number' && Number.isFinite(e.kcal)) { kcal += e.kcal; anyKcal = true; }
    for (const set of e.sets ?? []) {
      const reps = set?.[0] ?? 0, weight = set?.[1] ?? 0;
      if (!(reps > 0) || !(weight > 0)) continue;
      const v = reps * weight;
      volume += v; anyVolume = true;
      volByLift.set(e.exercise, (volByLift.get(e.exercise) ?? 0) + v);
      const one = est1RM(weight, reps);
      if (!anyBest || one > best) { best = one; anyBest = true; }
    }
  }

  let topLift: string | null = null, topVol = -1;
  for (const [lift, v] of volByLift) if (v > topVol) { topVol = v; topLift = lift; }

  return {
    ...cell,
    trained: true,
    sessions: sessions.size,
    days: days.size,
    volumeKg: anyVolume ? Math.round(volume) : null,
    kcal: anyKcal ? Math.round(kcal) : null,
    best1RM: anyBest ? best : null,
    topLift,
  };
}

/**
 * The member's history, month by month, oldest first.
 *
 * The window starts at their first logged session — never earlier. Padding the
 * front to a round twelve months is the mistake this whole module is written to
 * avoid: it shows a beginner eleven months of nothing and calls it their year.
 *
 * Months inside the window with no training are still present, flagged
 * `trained: false` with null figures, because a break in the middle is part of
 * the history and has to stay visible (rule 2).
 *
 * Capped to the most recent `maxMonths`; compare `historySpan().months` against
 * the returned length to tell the member that earlier months exist.
 */
export function monthlyHistory(log: WorkoutEntry[], now: number = Date.now(), maxMonths: number = MAX_MONTHS): MonthCell[] {
  const byMonth = new Map<string, WorkoutEntry[]>();
  let first: string | null = null, last: string | null = null;
  for (const e of log) {
    const k = monthKey(e.t);
    if (!k) continue;
    const bucket = byMonth.get(k);
    if (bucket) bucket.push(e); else byMonth.set(k, [e]);
    if (first == null || k < first) first = k;
    if (last == null || k > last) last = k;
  }
  if (first == null || last == null) return [];

  // Run to this month even when the last session is older — the months since
  // somebody stopped are the most important thing on the page for them.
  const nowKey = monthKey(new Date(now).toISOString()) ?? last;
  const end = nowKey > last ? nowKey : last;

  const cells: MonthCell[] = [];
  for (let k = first; ; k = nextMonth(k)) {
    cells.push(cellFrom(k, byMonth.get(k) ?? []));
    if (k === end) break;
    // Defensive stop: a clock skewed decades into the future must not spin here.
    if (cells.length > 1200) break;
  }
  return cells.length > maxMonths ? cells.slice(cells.length - maxMonths) : cells;
}

/* ── the shape of a year ───────────────────────────────────────────────── */

export interface YearRow {
  year: number;
  /**
   * Twelve slots, January → December.
   *
   *   null            outside your history — before your first session, or in
   *                   the future. NOT a month you failed to train; the screen
   *                   must render it as absent, not as empty.
   *   trained: false  inside your history, nothing logged. A real gap.
   *   trained: true   a month with training in it.
   */
  cells: (MonthCell | null)[];
}

/** Lay the months out as calendar years so a year reads at a glance. */
export function yearRows(cells: MonthCell[]): YearRow[] {
  if (!cells.length) return [];
  const rows = new Map<number, YearRow>();
  for (const c of cells) {
    let row = rows.get(c.year);
    if (!row) { row = { year: c.year, cells: Array(12).fill(null) }; rows.set(c.year, row); }
    row.cells[c.month] = c;
  }
  return [...rows.values()].sort((a, b) => a.year - b.year);
}

/** The largest monthly tonnage in the series, for scaling a chart. Null when
 *  no month has a tonnage at all — a chart with no scale must not be drawn. */
export function peakVolume(cells: MonthCell[]): number | null {
  let max: number | null = null;
  for (const c of cells) if (c.volumeKg != null && (max == null || c.volumeKg > max)) max = c.volumeKg;
  return max;
}

/** 0..1 for shading a cell, or null when there is nothing to shade. Never 0
 *  for an untrained month — that would paint it the same as a light month. */
export function intensity(cell: MonthCell, peak: number | null): number | null {
  if (!cell.trained || cell.volumeKg == null || peak == null || peak <= 0) return null;
  return Math.max(0, Math.min(1, cell.volumeKg / peak));
}

/** The month with the most tonnage. Null when nothing has been lifted. */
export function bestMonth(cells: MonthCell[]): MonthCell | null {
  let best: MonthCell | null = null;
  for (const c of cells) if (c.volumeKg != null && (best == null || c.volumeKg > (best.volumeKg ?? -1))) best = c;
  return best;
}

/** Months in the window that have training in them. */
export function trainedMonths(cells: MonthCell[]): MonthCell[] {
  return cells.filter((c) => c.trained);
}

/* ── breaks ────────────────────────────────────────────────────────────── */

/** A run of untrained months with training on both sides of it. */
export interface Gap {
  /** Last month trained before the break. */
  afterKey: string;
  /** First month trained after it. */
  returnKey: string;
  /** How many months in a row had nothing logged. */
  months: number;
}

/**
 * The breaks, in order. Only counts a run that has training on BOTH sides: an
 * open-ended silence at the end is not a gap the member came back from, it is
 * where they are now, and calling it a "2-month break" when it might be three
 * would be putting a false ending on it.
 */
export function gaps(cells: MonthCell[]): Gap[] {
  const out: Gap[] = [];
  let lastTrained: string | null = null;
  let run = 0;
  for (const c of cells) {
    if (c.trained) {
      if (lastTrained != null && run > 0) out.push({ afterKey: lastTrained, returnKey: c.key, months: run });
      lastTrained = c.key;
      run = 0;
    } else if (lastTrained != null) {
      run++;
    }
  }
  return out;
}

/** The longest break, or null if there has not been one. */
export function longestGap(cells: MonthCell[]): Gap | null {
  let worst: Gap | null = null;
  for (const g of gaps(cells)) if (!worst || g.months > worst.months) worst = g;
  return worst;
}

/** Whole months since the last logged session, or null when nothing is logged.
 *  This is the open-ended silence `gaps()` deliberately refuses to close. */
export function monthsSinceLast(cells: MonthCell[]): number | null {
  const trained = trainedMonths(cells);
  if (!trained.length) return null;
  return cells.length - 1 - cells.indexOf(trained[trained.length - 1]);
}

/* ── how long you have been at this ────────────────────────────────────── */

export interface Span {
  /** ISO of the earliest logged session. */
  firstAt: string;
  /** ISO of the latest. */
  lastAt: string;
  /** Calendar days from the first session to today, inclusive of both. */
  days: number;
  /** Calendar months from the first session's month to this one, inclusive. */
  months: number;
}

export function historySpan(log: WorkoutEntry[], now: number = Date.now()): Span | null {
  let firstT = Infinity, lastT = -Infinity;
  let firstAt = '', lastAt = '';
  for (const e of log) {
    const ts = Date.parse(e.t);
    if (!Number.isFinite(ts)) continue;
    if (ts < firstT) { firstT = ts; firstAt = e.t; }
    if (ts > lastT) { lastT = ts; lastAt = e.t; }
  }
  if (!firstAt) return null;

  // Local midnights, so "days in" counts calendar days rather than 24-hour
  // blocks — a session at 11pm yesterday makes today day two, not day one.
  const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const from = startOfDay(firstT);
  const to = startOfDay(Math.max(now, lastT));
  const days = Math.max(1, Math.round((to - from) / DAY) + 1);

  const firstKey = monthKey(firstAt)!;
  const nowKey = monthKey(new Date(Math.max(now, lastT)).toISOString()) ?? firstKey;
  return { firstAt, lastAt, days, months: Math.max(1, monthsBetween(firstKey, nowKey)) };
}

/**
 * How much history there is to look at. This is the honesty valve for a short
 * history: the screen asks the question before it draws anything, so a member
 * three weeks in is never shown a year-shaped frame with eleven holes in it.
 *
 *   empty     nothing logged at all
 *   starting  under four weeks — the page says how many days in, and no grid
 *   building  under six months — the months that exist, and only those
 *   long      six months or more — the year grid earns its place
 */
export type Stage = 'empty' | 'starting' | 'building' | 'long';

export function stageOf(span: Span | null): Stage {
  if (!span) return 'empty';
  if (span.days < 28) return 'starting';
  if (span.days < 180) return 'building';
  return 'long';
}

/**
 * One honest line about the size of the history, for the top of the screen.
 * Never claims a year that is not there and never scolds a beginner for being
 * new. Each branch states only what has actually been counted.
 */
export function historyNote(log: WorkoutEntry[], now: number = Date.now()): string {
  const span = historySpan(log, now);
  const stage = stageOf(span);
  if (!span || stage === 'empty') return 'Your history starts with your first logged session.';
  const cells = monthlyHistory(log, now);
  const months = trainedMonths(cells).length;
  if (stage === 'starting') {
    return `Day ${span.days} — this is the start of your history, and it fills out as the months go by.`;
  }
  return `${months} month${months === 1 ? '' : 's'} with training, back to ${monthLabel(monthKey(span.firstAt)!)}.`;
}

/* ── the totals ────────────────────────────────────────────────────────── */

export interface Lifetime {
  firstAt: string;
  lastAt: string;
  sessions: number;
  days: number;
  /** Null when nothing weighted has been logged — never 0. */
  volumeKg: number | null;
  /** Null when nothing carried a calorie figure — never 0. */
  kcal: number | null;
  /** Distinct exercises with at least one weighted set. */
  lifts: number;
}

/** Everything, since the beginning. Null when there is no history to total. */
export function lifetimeTotals(log: WorkoutEntry[]): Lifetime | null {
  const span = historySpan(log, Date.now());
  if (!span) return null;
  const sessions = new Set<string>(), days = new Set<string>(), lifts = new Set<string>();
  let volume = 0, anyVolume = false, kcal = 0, anyKcal = false;
  for (const e of log) {
    const dk = dayKeyOf(e.t);
    if (!dk) continue;
    sessions.add(e.t);
    days.add(dk);
    if (typeof e.kcal === 'number' && Number.isFinite(e.kcal)) { kcal += e.kcal; anyKcal = true; }
    for (const set of e.sets ?? []) {
      const reps = set?.[0] ?? 0, weight = set?.[1] ?? 0;
      if (!(reps > 0) || !(weight > 0)) continue;
      volume += reps * weight; anyVolume = true;
      lifts.add(e.exercise);
    }
  }
  return {
    firstAt: span.firstAt, lastAt: span.lastAt,
    sessions: sessions.size, days: days.size,
    volumeKg: anyVolume ? Math.round(volume) : null,
    kcal: anyKcal ? Math.round(kcal) : null,
    lifts: lifts.size,
  };
}

/* ── personal bests over time ──────────────────────────────────────────── */

/**
 * The moment a lift got better. `personalRecords` in streaks.ts answers "what
 * is your best?"; this answers "when did each of your bests happen, and what
 * did it beat?" — which is the part that reads as progress rather than as a
 * leaderboard.
 */
export interface Milestone {
  at: string;
  exercise: string;
  est1RM: number;
  weight: number;
  reps: number;
  /** The best before this one, or NULL for the first ever record on a lift.
   *  Not 0: there was no previous best, and "+100 kg on your first day" is a
   *  fabricated improvement. */
  prev: number | null;
}

/**
 * Every improvement on every lift, oldest first. One milestone per session at
 * most per lift — the best set of the session — so a five-set PR day is one
 * moment rather than five.
 */
export function prTimeline(log: WorkoutEntry[]): Milestone[] {
  const sorted = log
    .filter((e) => Number.isFinite(Date.parse(e.t)) && e.sets && e.sets.length)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const best = new Map<string, number>();
  const out: Milestone[] = [];
  for (const e of sorted) {
    let top = 0, topW = 0, topR = 0;
    for (const set of e.sets ?? []) {
      const reps = set?.[0] ?? 0, weight = set?.[1] ?? 0;
      if (!(reps > 0) || !(weight > 0)) continue;
      const one = est1RM(weight, reps);
      if (one > top) { top = one; topW = weight; topR = reps; }
    }
    if (top <= 0) continue;
    const prior = best.get(e.exercise);
    if (prior != null && top <= prior) continue;
    out.push({ at: e.t, exercise: e.exercise, est1RM: top, weight: topW, reps: topR, prev: prior ?? null });
    best.set(e.exercise, top);
  }
  return out;
}

/* ── the arc ───────────────────────────────────────────────────────────── */

/**
 * Then versus now: the first month that carried tonnage against the most recent
 * one. Null unless there are two such months — one month is a data point, not
 * an arc, and "up 100%" off a single month would be a sentence about nothing.
 */
export interface Arc {
  fromKey: string;
  toKey: string;
  fromVolumeKg: number;
  toVolumeKg: number;
  deltaKg: number;
  /** Null when the earlier month carried no tonnage to divide by. */
  pct: number | null;
  /** Calendar months from the first to the last, inclusive. */
  months: number;
}

export function volumeArc(cells: MonthCell[]): Arc | null {
  const withVolume = cells.filter((c) => c.volumeKg != null);
  if (withVolume.length < 2) return null;
  const a = withVolume[0], b = withVolume[withVolume.length - 1];
  const from = a.volumeKg!, to = b.volumeKg!;
  return {
    fromKey: a.key, toKey: b.key,
    fromVolumeKg: from, toVolumeKg: to,
    deltaKg: to - from,
    pct: from > 0 ? Math.round(((to - from) / from) * 100) : null,
    months: monthsBetween(a.key, b.key),
  };
}

/** Tonnes, to one decimal, for a figure that would otherwise run to six digits.
 *  Null in, null out — this must never turn "unknown" into "0.0 t". */
export function tonnes(kg: number | null): number | null {
  return kg == null ? null : Math.round(kg / 100) / 10;
}
