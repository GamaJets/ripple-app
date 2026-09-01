// A set whose load is the person.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// A set is stored as `[reps, kg]`. Leaving the load box empty stored a zero —
// both log paths in app/(client)/workouts.tsx said so in their own alert copy:
// "the kg box can stay empty for a bodyweight set". And then every reader of
// that set threw it away. `personalRecords` opened with `if (!weight || !reps)
// continue;`, tonnage everywhere is `reps * weight`, and `est1RM(0, r)` is 0.
//
// So a pull-up, a dip, a push-up, a chin-up, a pistol squat — the whole of
// calisthenics — set no record, never reached the Records board, and added
// nothing to the tonnage on Trends or History. A member who trains entirely on
// rings and bars logged for months and read their own history back as an empty
// one. The sets were in the database the whole time. Nothing could see them.
//
// ── Why a separate flag and not just "kg === 0" ────────────────────────────
//
// Because zero is ambiguous and this codebase does not let a figure mean two
// things. A stored 0 today is EITHER "I hung off a bar and pulled" or "the load
// box was left empty by accident and nobody said what happened". Worse, the
// live runner's `logSet` deliberately refuses a mistyped load rather than
// coercing it, on the grounds that "a mistyped load silently becoming 0 records
// a bodyweight set in the middle of a session" — which is precisely the
// confusion, written down, in the code that ships.
//
// `bw` is an explicit per-set boolean, aligned to `sets` exactly as `feel`
// already is. `bw[i] === true` is testimony: the person said this set was their
// own bodyweight. And once that is said out loud, `sets[i][1]` on such a set
// stops meaning "the load" and starts meaning "what was ADDED to it" — 0 for a
// plain pull-up, 20 for a pull-up with a 20 kg belt. That is the second half of
// the report: there was no way to record the belt either.
//
// ── What tonnage means here, which is the hard part ────────────────────────
//
// Tonnage is Σ reps × load. For a bodyweight set the load is the person's own
// weight plus whatever was added, and the person's weight is:
//
//   · not constant — it is the thing half this app exists to move, and a
//     member who was 96 kg in January and is 88 kg in September did NOT lift
//     88 kg on every January pull-up;
//   · often absent entirely — `useClientData().weightKg` is null until there
//     is a scan or a typed figure, and the provider is emphatic about it:
//     "The old fallback object handed out 70 kg and 20% body fat, and every
//     downstream calculation treated them as measurements."
//
// This codebase never invents a figure it was not given, so neither does this.
// A bodyweight set is priced at the member's weight AS RECORDED ON OR BEFORE
// the day of the set, from their own weight history. Where there is no such
// record, the set has NO KNOWN LOAD — and that is reported as a count of sets
// left out, never as zero and never as a stand-in body.
//
// The alternative — carrying today's weight backwards over the whole log — is
// the one thing that looks best and is worst: every historical tonnage would
// silently change on the morning a member steps on a scale, and last spring's
// chart would redraw itself around a body that did not exist then.
//
// That is why `tonnage()` returns a pair rather than a number. A screen showing
// "12,400 kg" over a fortnight that also contained eleven unpriced pull-up sets
// is understating the work, and the honest thing is to say which sets are not
// in the figure rather than to pick a body and pretend.
import type { WorkoutEntry } from './mockData';
// A hold is the other set whose first number is not reps. Consulted here rather
// than duplicated, because tonnage is the one figure both flags have to change
// and two files deciding separately what a set is worth is how a plank came to
// be counted as forty-five repetitions in the first place.
import { isTimedSet } from './timedSets';

/** A weight reading and when it was taken. Matches `weightSeries` on
 *  `useClientData()` so a screen can pass it straight through. */
export interface WeightPoint { t: string; v: number }

/** The member's own weight over time. Ordering is not assumed — `bodyweightAtKg`
 *  sorts what it is given, because the provider appends a manual entry after the
 *  scans and a caller that concatenates two sources has no reason to know that. */
export type BodyweightHistory = readonly WeightPoint[];

/** The calendar day an ISO instant falls on, LOCALLY. Matches `dayKey` in
 *  ./streaks.ts: an evening set and an evening weigh-in have to land on the
 *  same day for one to price the other, and comparing raw ISO strings puts a
 *  21:00 workout in a UTC+2 gym on tomorrow. */
const dayOf = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** True when the person said this set was their own bodyweight. */
export function isBodyweightSet(e: Pick<WorkoutEntry, 'bw'>, i: number): boolean {
  return e.bw?.[i] === true;
}

/**
 * What the member weighed on the day of a set, from their own history.
 *
 * At or before, never after. A reading taken next month is not evidence about
 * today, and reaching forward for one is how a chart of the past starts moving
 * whenever somebody steps on a scale. Null when the history has nothing at or
 * before that day — including when the history is empty, which is the ordinary
 * case for a member who has never been scanned and never typed a figure.
 *
 * The NEAREST such reading wins, not the first: a member with January and
 * August weigh-ins gets January's for a February set and August's for a
 * September one.
 */
export function bodyweightAtKg(history: BodyweightHistory, iso: string): number | null {
  const day = dayOf(iso);
  if (!day) return null;
  let best: { day: string; kg: number } | null = null;
  for (const p of history) {
    if (!p || typeof p.v !== 'number' || !Number.isFinite(p.v) || p.v <= 0) continue;
    const d = dayOf(p.t);
    if (!d || d > day) continue;
    if (!best || d >= best.day) best = { day: d, kg: p.v };
  }
  return best ? best.kg : null;
}

/**
 * The kilograms a single set moved, or null when that cannot be known.
 *
 * Three answers, and they are genuinely three:
 *
 *   a number  the load is known — the bar's plates, or the body plus the belt
 *   null      a bodyweight set with no weight recorded on or before that day
 *   null      an ordinary set with no load, which is a set nobody described
 *
 * The two nulls are the same answer to the caller — do not count this — and
 * separating them would only tempt somebody to count one of them as zero.
 */
export function setLoadKg(
  e: Pick<WorkoutEntry, 'bw'>,
  i: number,
  set: readonly [number, number],
  history: BodyweightHistory,
  at: string,
): number | null {
  const added = Number.isFinite(set[1]) ? set[1] : 0;
  if (!isBodyweightSet(e, i)) return added > 0 ? added : null;
  const body = bodyweightAtKg(history, at);
  if (body == null) return null;
  return body + Math.max(0, added);
}

/**
 * A tonnage, and how much of the work is not in it.
 *
 * `unknownSets` is not a diagnostic. It is part of the figure: a screen that
 * prints `kg` without it is stating a total over a set it knows to be
 * incomplete, which is the failure src/ui/loadStatus.ts exists to stop, arriving
 * by a different door.
 */
export interface Tonnage {
  /** Σ reps × load over every set whose load is known. */
  kg: number;
  /** Sets that moved a load nobody has recorded — bodyweight sets logged by a
   *  member whose weight is not on the account on or before that day. */
  unknownSets: number;
}

export const NO_TONNAGE: Tonnage = { kg: 0, unknownSets: 0 };

/** Tonnage for one entry. */
export function entryTonnage(e: WorkoutEntry, history: BodyweightHistory): Tonnage {
  if (!e.sets?.length) return NO_TONNAGE;
  let kg = 0, unknown = 0;
  for (let i = 0; i < e.sets.length; i++) {
    // A hold is not reps, so reps × load is not a mass moved. Skipped
    // entirely rather than counted as zero or as `secs × kg`: 45 seconds
    // under a 10 kg plate is not 450 kg, and it is not nothing either — it is
    // in the hold board (src/lib/timedSets.ts) where it can be stated in its
    // own units. It is deliberately NOT counted in `unknownSets`, which means
    // "work this total could have priced and could not"; a hold is work this
    // total is not about.
    if (isTimedSet(e, i)) continue;
    const reps = e.sets[i][0] || 0;
    const load = setLoadKg(e, i, e.sets[i], history, e.t);
    if (load == null) { if (isBodyweightSet(e, i) && reps > 0) unknown++; continue; }
    kg += reps * load;
  }
  return { kg, unknownSets: unknown };
}

/** Tonnage across many entries. */
export function tonnage(log: readonly WorkoutEntry[], history: BodyweightHistory): Tonnage {
  let kg = 0, unknown = 0;
  for (const e of log) { const t = entryTonnage(e, history); kg += t.kg; unknown += t.unknownSets; }
  return { kg, unknownSets: unknown };
}

/**
 * What to say under a tonnage that is missing sets, or null when it is whole.
 *
 * One sentence, one place. Three screens print a tonnage and all three needed
 * the same caveat in the same words — and the wording matters, because it has
 * to tell the member both that the figure is short AND what they can do about
 * it, without implying anything is wrong with their log.
 */
export function tonnageNote(t: Tonnage): string | null {
  if (t.unknownSets <= 0) return null;
  const s = t.unknownSets === 1 ? 'set is' : 'sets are';
  return `${t.unknownSets} bodyweight ${s} not in this total, because your own weight is not recorded for the day you did them. Add your weight and they count.`;
}

/**
 * The most reps done at bodyweight for a movement, per movement.
 *
 * A second board, deliberately not merged into `personalRecords`. An estimated
 * 1RM needs a load, and for a bodyweight set with no weigh-in behind it there
 * is no load to estimate from — so the choice is between inventing a body,
 * which this file exists to refuse, and leaving a calisthenics member's entire
 * training out of Records, which is the bug.
 *
 * Neither. Reps at bodyweight is a real record, it is the one every gymnast and
 * every person doing their first pull-up actually tracks, and it needs nothing
 * the log does not already hold. Added load is carried alongside so "12 reps"
 * and "12 reps +20 kg" are not shown as the same achievement.
 */
export interface RepRecord {
  exercise: string;
  reps: number;
  /** Kilograms hung, belted or held on top of the body. 0 for a plain set. */
  addedKg: number;
  at: string;
}

/**
 * Best bodyweight set per movement, most reps first.
 *
 * Ranked on reps, with added load breaking a tie — so a 10-rep set with a belt
 * beats a plain 10 and neither is confused with the other. Ranking on the two
 * multiplied together would let a heavy belt buy a rep count that was never
 * performed, and rep records are read as "I did this many".
 */
export function repRecords(log: readonly WorkoutEntry[]): RepRecord[] {
  const best = new Map<string, RepRecord>();
  for (const e of log) {
    if (!e.sets?.length) continue;
    for (let i = 0; i < e.sets.length; i++) {
      if (!isBodyweightSet(e, i)) continue;
      // A bodyweight HOLD belongs on the hold board, not here. Without this a
      // 45-second plank outranks every pull-up anybody has ever done, because
      // 45 is a bigger number than 12 and this board reads the first number as
      // repetitions.
      if (isTimedSet(e, i)) continue;
      const reps = e.sets[i][0] || 0;
      if (reps <= 0) continue;
      const addedKg = Math.max(0, Number.isFinite(e.sets[i][1]) ? e.sets[i][1] : 0);
      const cur = best.get(e.exercise);
      const better = !cur || reps > cur.reps || (reps === cur.reps && addedKg > cur.addedKg);
      if (better) best.set(e.exercise, { exercise: e.exercise, reps, addedKg, at: e.t });
    }
  }
  return [...best.values()].sort((a, b) => b.reps - a.reps || b.addedKg - a.addedKg);
}

/**
 * How a bodyweight set reads on a row: "12 reps at bodyweight", or with a belt.
 *
 * Sentence case, and it is prose rather than a title — it sits under a movement
 * name as an explanation of the set, not as a heading over it.
 */
export function bodyweightSetLabel(reps: number, addedKg: number, addedLabel: string | null): string {
  return addedKg > 0 && addedLabel ? `${reps} reps at bodyweight +${addedLabel}` : `${reps} reps at bodyweight`;
}
