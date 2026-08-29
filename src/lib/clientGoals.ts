// Somebody else's goals, read off the wire.
//
// `goalTargets.ts` already holds every rule about what a goal MEANS — where
// progress starts, when a finish date may be claimed, why a sentence never
// gets a percentage. Nothing here re-derives any of that. This module is the
// step before it: turning `goal_targets`, `scans` and `check_ins` rows into the
// shapes those functions take, for a reader who is not the person the rows
// belong to.
//
// It exists as its own file, pure and tested, for two reasons.
//
// ── A row the app does not understand must not be drawn as one it does ─────
//
// `kind` is a text column with a check constraint, and the console and the
// client's own screen both cast it straight to GoalKind. That is fine until the
// day a newer build writes a fifth kind: the cast succeeds, `GOAL_METRIC[kind]`
// is undefined, and the screen either crashes or prints "undefined" beside a
// client's name. `readGoal` returns null for anything it cannot render, and
// `readGoals` counts what it dropped — because a goal quietly discarded is a
// client who looks like they have set nothing, which is the exact lie this
// codebase keeps having to fix.
//
// ── An empty list means three different things ─────────────────────────────
//
// A read that failed, a client who has set no goals, and a client whose goals
// are all reached are three different facts about a person, and a coach acts
// differently on each: chase the connection, have the conversation, set the
// next target. The console settled on "— unreadable", "— none set" and
// "— all reached" for them. `goalBoard` below is that same distinction as a
// type, so a screen cannot collapse two of them by accident.
import {
  sortGoals, GOAL_METRIC,
  type GoalKind, type GoalTarget, type MeasuredKind, type Point,
} from './goalTargets';
import { weightIn, weightDeltaIn, type WeightUnit } from './units';

/** A `goal_targets` row as PostgREST hands it over. */
export interface GoalRow {
  id: string;
  kind: string;
  target_value: number | string | null;
  title: string | null;
  target_date: string | null;
  achieved_at: string | null;
  created_at: string;
}

/** A `scans` row: the source of body fat and muscle, and of most weights. */
export interface ScanRow {
  taken_at: string;
  weight_kg: number | string | null;
  body_fat_pct: number | string | null;
  skeletal_muscle_kg: number | string | null;
}

/** A `check_ins` row. Only its weight is a body reading; the rest of the row
 *  is how the client felt, which no goal is measured against. */
export interface WeighInRow {
  at: string;
  weight_kg: number | string | null;
}

const KINDS: readonly string[] = ['weight', 'bodyfat', 'muscle', 'custom'];

/**
 * A numeric column as a number, or null.
 *
 * Postgres `numeric` reaches supabase-js as either a number or a string
 * depending on the driver path, and `Number(null)` is 0 — a zero-kilogram
 * target, or a client who weighs nothing. Everything here goes through this
 * rather than through a bare cast.
 */
const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * One row as a goal, or null when it is not a shape this app can render.
 *
 * Null covers three cases, all of which the table's own check constraint is
 * meant to prevent and none of which should reach a coach's screen as a
 * half-drawn goal: a kind this build has never heard of, a measured goal with
 * no number, and a custom goal with no words.
 */
export function readGoal(r: GoalRow): GoalTarget | null {
  if (!KINDS.includes(r.kind)) return null;
  const kind = r.kind as GoalKind;
  const targetValue = num(r.target_value);
  const title = (r.title ?? '').trim() || null;
  if (kind === 'custom' ? title == null : targetValue == null) return null;
  return {
    id: r.id,
    kind,
    targetValue: kind === 'custom' ? null : targetValue,
    title: kind === 'custom' ? title : null,
    targetDateISO: r.target_date,
    achievedAtISO: r.achieved_at,
    createdAtISO: r.created_at,
  };
}

/** Every readable goal in the answer, and how many rows were not. The count is
 *  returned rather than logged so a screen can say "one goal here could not be
 *  read" instead of showing a list that is quietly short. */
export function readGoals(rows: readonly GoalRow[]): { goals: GoalTarget[]; skipped: number } {
  const goals: GoalTarget[] = [];
  let skipped = 0;
  for (const r of rows) {
    const g = readGoal(r);
    if (g) goals.push(g); else skipped++;
  }
  return { goals: sortGoals(goals), skipped };
}

/** The three series a measured goal can be held against. */
export interface ClientSeries { weight: Point[]; bodyfat: Point[]; muscle: Point[] }

/**
 * The readings behind a client's goals, in the shape `goalTargets` expects.
 *
 * Weight comes from both sources because `GOAL_METRIC.weight.source` promises
 * "weigh-ins and scans" and the client's own screen shows both; body fat and
 * muscle come from scans alone, because nothing else records them. A scan with
 * no skeletal-muscle figure contributes to weight and body fat and is simply
 * absent from the muscle series — a missing reading is not a zero-kilogram one,
 * and a zero there would drag a muscle target's baseline to the floor and
 * report a client as 300% of the way to it.
 *
 * The timestamps are passed through exactly as the rows carry them: `taken_at`
 * is a bare date and `at` is an instant. That is deliberately identical to what
 * the client's own goal screen feeds these functions, because the one thing
 * worse than a percentage being a day out is a coach and a client looking at
 * the same goal and reading two different numbers off it.
 */
export function seriesFrom(
  scans: readonly ScanRow[],
  weighIns: readonly WeighInRow[],
): ClientSeries {
  const weight: Point[] = [];
  const bodyfat: Point[] = [];
  const muscle: Point[] = [];
  for (const s of scans) {
    if (!s.taken_at) continue;
    const w = num(s.weight_kg);
    const f = num(s.body_fat_pct);
    const m = num(s.skeletal_muscle_kg);
    if (w != null) weight.push({ t: s.taken_at, v: w });
    if (f != null) bodyfat.push({ t: s.taken_at, v: f });
    if (m != null) muscle.push({ t: s.taken_at, v: m });
  }
  for (const c of weighIns) {
    if (!c.at) continue;
    const w = num(c.weight_kg);
    if (w != null) weight.push({ t: c.at, v: w });
  }
  return { weight, bodyfat, muscle };
}

/** The series a goal of this kind is measured against. */
export function seriesFor(s: ClientSeries, kind: MeasuredKind): Point[] {
  return kind === 'weight' ? s.weight : kind === 'bodyfat' ? s.bodyfat : s.muscle;
}

/**
 * What there is to say about one client's goals.
 *
 * The three states the console named are three members here rather than three
 * ways of holding an empty array, so that "we could not read this" cannot be
 * rendered by the same branch as "they have not set any". `goals: null` is the
 * caller's way of saying the read did not come back.
 */
export type GoalBoard =
  | { state: 'unreadable' }
  | { state: 'none' }
  | { state: 'reached'; achieved: GoalTarget[] }
  | { state: 'working'; open: GoalTarget[]; achieved: GoalTarget[] };

export function goalBoard(goals: readonly GoalTarget[] | null): GoalBoard {
  if (goals == null) return { state: 'unreadable' };
  if (!goals.length) return { state: 'none' };
  const sorted = sortGoals(goals);
  const open = sorted.filter((g) => !g.achievedAtISO);
  const achieved = sorted.filter((g) => !!g.achievedAtISO);
  // Every goal ticked off is a real answer and a good one, and it is the state
  // most likely to be mistaken for an empty list by whatever renders it.
  if (!open.length) return { state: 'reached', achieved };
  return { state: 'working', open, achieved };
}

// ── reading a goal's numbers out in the reader's own unit ──────────────────
//
// Targets and every series behind them are stored in kilograms (TF-37), and
// whoever is looking reads in kg or lb by their own setting. That is a second
// reader now: the client sets the goal, and their coach opens it on a different
// phone with a different preference.
//
// These three live here rather than beside the screen that prints them because
// `weightDeltaIn` in ./units carries the scar of the alternative — seven
// screens had each written the same conversion locally and one of them getting
// it wrong later was only a matter of time. app/(client)/goal.tsx still holds
// its own copies; these are the ones anything new should use.

/** True for the goal kinds whose stored number is kilograms. Body fat is not
 *  one: a proportion of the body is the same number on any scale. */
const weightKind = (k: MeasuredKind) => k !== 'bodyfat';

/** The unit a goal of this kind is read in. */
export function goalUnit(kind: MeasuredKind, unit: WeightUnit): string {
  return weightKind(kind) ? unit : GOAL_METRIC[kind].unit;
}

/** A stored goal figure — a target, a current reading — in the read unit. */
export function goalValue(v: number, kind: MeasuredKind, unit: WeightUnit): number {
  return weightKind(kind) ? (weightIn(v, unit) ?? v) : v;
}

/**
 * A goal DIFFERENCE — how much is left, how fast it is moving — in the read
 * unit. Converted as a span rather than as two rounded ends, for the reason
 * `weightDeltaIn` exists.
 */
export function goalDelta(v: number, kind: MeasuredKind, unit: WeightUnit): number {
  return weightKind(kind) ? (weightDeltaIn(v, unit) ?? v) : v;
}
