// A hold over TIME — the line a plank makes across a season.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// `holdRecords` in ./timedSets.ts answers "what is the longest you have ever
// held this", and app/(client)/records.tsx prints it. That is a board: one row
// per movement, one figure, the day it happened. It is not a trend, and a
// member whose dead hang has gone 20 s → 35 s → 48 s → 70 s over four months
// reads it as a single "70 s" with no sense that it moved at all.
//
// Every other quantity this app records has a line. Tonnage has ten weeks of
// bars on Trends, an estimated max has a twelve-point spark, weight and body
// fat have their own charts. A hold had a leaderboard entry and nothing else,
// which is the one thing isometric training gives you — it gets longer — shown
// as a static number.
//
// ── And the line it must NEVER be drawn on ────────────────────────────────
//
// The Strength Trend on app/(client)/trends.tsx charts `bestOf(entry)`, which
// was:
//
//     const load = setLoadKg(e, i, s, history, e.t);
//     return load != null && s[0] ? Math.max(m, est1RM(load, s[0])) : m;
//
// `setLoadKg` knows about bodyweight and knows nothing about holds, so on a
// timed set `s[0]` is SECONDS and that expression is `est1RM(load, 45)` — the
// Epley formula run over a stopwatch. For a plank held by an 88 kg member that
// is est1RM(88, 45) ≈ 220 kg, plotted on the same axis as their bench press,
// labelled "Estimated 1-rep max", and large enough to flatten every real lift
// on the chart into the bottom pixel.
//
// ./timedSets.ts refuses this in as many words ("feeding it seconds returns a
// number that looks like a strength figure and is arithmetic on a stopwatch"),
// ./bodyweightSets.ts skips timed sets out of tonnage, and `liftedSets` in
// ./progression.ts drops holds outright. Three modules got it right and the one
// chart that draws the axis did not. A hold and a lift are not the same
// quantity: they do not share an axis, they do not share a "best", and the fix
// is not to scale one into the other — it is a second chart, in seconds.
//
// ── One point per DAY, not per row ────────────────────────────────────────
//
// The same fold the est-1RM series already uses, for the same reason. One
// session is saved as it goes, so a member who logs three planks, walks away
// and comes back for two more has two rows on one afternoon; a double tap on
// Save has four. Charting rows draws three points stacked on a single Tuesday —
// ./exerciseHistory.ts calls that "a picture of a plateau drawn out of a double
// tap". The day's LONGEST hold is that day's point, which is the same rule
// `holdRecords` applies across the whole log.
//
// The day comes from `dayKeyOf`, the codebase's own local-day helper, never
// from `slice(0, 10)` on the instant: a 21:00 plank in a UTC+2 gym has an ISO
// string that starts with yesterday's date, and slicing it moves the session
// across the date line.
import type { WorkoutEntry } from './mockData';
import { isTimedSet } from './timedSets';
import { dayKeyOf } from './entryEdit';

/** One day's longest hold of one movement. */
export interface HoldPoint {
  /** The instant of that day's best hold — the LATEST one at that length, so a
   *  chart axis reads as the day rather than as whichever save happened to
   *  win. */
  t: string;
  /** The local calendar day it belongs to, `YYYY-MM-DD`. */
  day: string;
  /** Seconds held. This is the measurement; everything else here describes it. */
  secs: number;
  /** Kilograms held, or added to the body on a bodyweight hold. 0 for a plain
   *  one. Carried so a caller can say that a line's holds were not all bare —
   *  never so it can be multiplied into the seconds. */
  loadKg: number;
  /** True when the hold was the person's own bodyweight. */
  bodyweight: boolean;
}

/** True when any set of an entry was REPEATED rather than held.
 *
 *  The predicate the strength chart needed and did not have. `hasTimedSet`
 *  answers the other half, but "this entry contains a hold" is not the question
 *  a lift chart is asking — a member who logs a plank and a weighted carry in
 *  one entry has lifted something, and dropping the whole entry would take the
 *  carry off the strength line too. */
export function hasLiftedSet(e: Pick<WorkoutEntry, 'sets' | 'timed'>): boolean {
  const rows = e.sets ?? [];
  for (let i = 0; i < rows.length; i++) if (!isTimedSet(e, i)) return true;
  return false;
}

/** True when any set of an entry was held. */
function hasHeldSet(e: Pick<WorkoutEntry, 'sets' | 'timed'>): boolean {
  const rows = e.sets ?? [];
  for (let i = 0; i < rows.length; i++) if (isTimedSet(e, i)) return true;
  return false;
}

/**
 * The movements with at least one hold on record, in the order they first
 * appear in the log.
 *
 * Order of appearance rather than alphabetical, matching the chip row on
 * Trends: the list is read left to right and the movement a member trains most
 * is the one they want first, not the one beginning with A.
 */
export function heldMovements(log: readonly WorkoutEntry[]): string[] {
  const names: string[] = [];
  for (const e of log) {
    if (!e.sets?.length || !hasHeldSet(e)) continue;
    if (!names.includes(e.exercise)) names.push(e.exercise);
  }
  return names;
}

/**
 * The movements with at least one LIFTED set, in the order they first appear.
 *
 * The other half of the same split, and the reason it is here: the strength
 * chip row on Trends was built from every movement in the log, so a member
 * whose only isometric work is a plank got a "Plank" chip on a chart captioned
 * "Estimated 1-rep max" — and selecting it drew a line of stopwatch arithmetic.
 */
export function liftedMovements(log: readonly WorkoutEntry[]): string[] {
  const names: string[] = [];
  for (const e of log) {
    if (!e.sets?.length || !hasLiftedSet(e)) continue;
    if (!names.includes(e.exercise)) names.push(e.exercise);
  }
  return names;
}

/**
 * One movement's longest hold per day, oldest first.
 *
 * Ranked on seconds, with load breaking a tie exactly as `holdRecords` does, so
 * a day carrying both a bare 60 and a 60 with a plate on top reports the loaded
 * one — the two are not the same achievement and the tie must not be settled by
 * whichever row was saved last.
 *
 * An entry whose timestamp will not parse is DROPPED, not filed under today.
 * Inventing a training day out of a parsing failure is the defect
 * ./ownTraining.ts documents, and on a chart it draws a point at the Unix
 * epoch that stretches the axis across fifty-six years.
 */
export function holdSeries(log: readonly WorkoutEntry[], exercise: string): HoldPoint[] {
  const byDay = new Map<string, HoldPoint>();
  for (const e of log) {
    if (e.exercise !== exercise || !e.sets?.length) continue;
    const day = dayKeyOf(e.t);
    if (!day) continue;
    for (let i = 0; i < e.sets.length; i++) {
      if (!isTimedSet(e, i)) continue;
      const secs = e.sets[i][0];
      if (!Number.isFinite(secs) || secs <= 0) continue;
      const loadKg = Math.max(0, Number.isFinite(e.sets[i][1]) ? e.sets[i][1] : 0);
      const bodyweight = e.bw?.[i] === true;
      const cur = byDay.get(day);
      const better = !cur || secs > cur.secs || (secs === cur.secs && loadKg > cur.loadKg);
      if (better) byDay.set(day, { t: e.t, day, secs, loadKg, bodyweight });
    }
  }
  // Sorted on the DAY KEY, which is a plain `YYYY-MM-DD` and sorts correctly as
  // a string. Not on `Date.parse(t)`: two holds on the same local evening
  // either side of a UTC midnight have instants that disagree with the days
  // they were filed under, and the chart would draw them out of order against
  // its own axis labels.
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * The change in the day's-best hold across a series, in seconds.
 *
 * Null when there is no second day to compare against — one hold is not a
 * direction of travel, and "+70 s since March" printed over a single point is
 * a claim about a journey that has one end.
 *
 * Zero is a real answer and is deliberately NOT null: a member whose hold has
 * sat at 60 seconds for two months has measured that, and the caller says "no
 * change" rather than withholding the line. This is the seconds equivalent of
 * the rule in ./units.ts — a change too small to show is reported as no change,
 * never as a signed zero.
 */
export function holdChangeSecs(series: readonly HoldPoint[]): number | null {
  if (series.length < 2) return null;
  return series[series.length - 1].secs - series[0].secs;
}

/**
 * What to say under a hold line whose points did not all carry the same load,
 * or null when there is nothing to explain.
 *
 * The line is SECONDS, and that is the whole of it. A 60-second plank with a
 * 10 kg plate is a harder 60 seconds than a bare one, and plotting both as "60"
 * shows two different efforts at the same height — which is honest about the
 * duration and silent about the rest. Saying so is the alternative to the two
 * things this codebase refuses: folding the load into the seconds (a weighted
 * hold is not a longer hold) and drawing a second axis nobody asked for.
 *
 * No figure in kilograms or pounds appears here on purpose. A count needs no
 * unit, and a pure module that printed a load would be printing it in the
 * wrong one — see ./units.ts, which owns that conversion at the edge.
 */
export function holdLoadNote(series: readonly HoldPoint[]): string | null {
  const loaded = series.filter((p) => p.loadKg > 0).length;
  if (loaded === 0 || loaded === series.length) return null;
  // "1 of these days carried" — the noun is plural whatever the count is,
  // because it is a part of a set, and the verb agrees with the part. A
  // count-driven singular here produces "1 of these day carried".
  return `The line is time held. ${loaded} of these days carried extra weight, which is a harder hold at the same height on the chart.`;
}
