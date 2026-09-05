// Which of a member's logged exercises grade against which strength standard.
//
// Extracted verbatim from app/(client)/standards.tsx, where this table and its
// matcher were fixed in ab33191 and verified by sweeping the live catalogue by
// hand — 608 rows, name by name, with no test to hold any of it. A table whose
// correctness rests on a sweep somebody did once is a table that regresses the
// next time a variant is added, so it moves here where strengthLifts.test.ts
// can name the false matches that started this and keep them named.
//
// Nothing about WHICH exercises match changed in the move. The screen imports
// `STRENGTH_LIFTS` and `countsFor` and grades exactly what it graded before.

/**
 * One standard: the lift's name, the names that grade against it, the names
 * that must not, and the bodyweight multiples for the five levels.
 *
 * `re` and `not` are read together and always in that order — `re` says what
 * this lift is called, `not` says which of those callers is a different
 * exercise wearing the name. Neither carries the `g` flag, because a `g` regex
 * keeps `lastIndex` between `.test` calls and these are tested against every
 * record on a member's log.
 */
export type StrengthLift = { name: string; re: RegExp; not: RegExp; mult: number[] };

/**
 * The five lifts, and the rule that decides what grades as each.
 *
 * This used to be `match: ['bench']` and a `String.includes` against the live
 * catalogue — 608 exercises — and a catalogue that size has a great many
 * substrings in it. `'bench'` caught **Bench Dips** and **Bench Pull**;
 * `'overhead'` caught **Overhead Squat** and the whole **Overhead Carry**
 * family; `'row'` caught **Crow Pose**, on the `row` inside `c-row`.
 *
 * None of that was cosmetic, because of what the numbers behind it do. A
 * bodyweight set is priced at the member's FULL bodyweight (`setLoadKg` in
 * src/lib/bodyweightSets.ts) and `est1RM` is Epley (src/lib/streaks.ts), so an
 * 80 kg member's twelve Bench Dips price at 80 kg and estimate a 112 kg max —
 * a ratio of 1.4, which the screen printed as "Bench Press · Intermediate ·
 * 112 kg · Next: Advanced @ 120 kg" to somebody who has never lain on a bench.
 * And because the screen's `best` is a MAX over the matches, a false match can
 * only ever push the grade UP: it can never be corrected by a real lift lower
 * down.
 *
 * So the rule is word boundaries plus an explicit refusal, and the refusal
 * asks one question of every candidate: **could the number on this log line
 * sit at or above the member's true barbell lift?** Where the answer is yes —
 * or where the load is the member's own body rather than a bar — it does not
 * grade. The cost of refusing is a row that reads "Log this lift to see your
 * level", which is true. The cost of accepting is a level, a ratio and a next
 * target, all wrong, in the member's own words about their own strength.
 *
 * What that means lift by lift:
 *
 * · **Bodyweight anything** — `Bodyweight Squat`, `Bodyweight Overhead Press`,
 *   `Inverted Row`, `Ring Row`, `TRX Row/Squat`, `Pistol Squat`, `Jump Squat`,
 *   `Stability Ball Wall Squat`. Priced at the whole member, so they grade a
 *   set of air squats as a loaded max. `Bodyweight Overhead Press` was the
 *   worst of them: the press scale tops out at 1.1×, so an 80 kg member's own
 *   body cleared Elite on the first rep.
 * · **Selectorized machines** — `Machine Shoulder Press`, `Hack Squat`. The
 *   plate stack is a leverage ratio chosen by a manufacturer, not the mass the
 *   member moved, and it reads high. A **Smith** machine is the exception and
 *   is normalised back in by `normalise` below: that is a real bar with real
 *   plates on it.
 * · **Cables, sleds and landmines** — `Seated Row`, `Kneeling Cable Row`,
 *   `Sled Row`, `T-Bar Row`. Same objection, and the T-bar is the sharpest
 *   case: the lever puts roughly two thirds of the loaded plate at the hands,
 *   so a logged 100 kg would have graded as a 100 kg barbell row.
 * · **A different exercise wearing the name** — `Upright Row` and `Rear Delt
 *   Row` are shoulder accessories, `Overhead Squat` is a shoulder-limited lift
 *   at half a back squat, `Romanian`/`Stiff Leg` deadlifts are hinge
 *   accessories nobody tests a single at. Each of these under-states rather
 *   than inflates, which is the safe direction — but a member who only ever
 *   RDLs has not tested a deadlift, and the screen must not hand them a level
 *   and a target for a lift they have not done.
 * · **One leg at a time** — every `Split Squat`, `Bulgarian Split Squat`,
 *   `Pistol Squat`, `Single Leg`/`Kickstand` deadlift. Half the body against a
 *   two-leg standard, and the unloaded ones inflate on top of it.
 * · **Bands** — `Banded Squat`, `Banded Romanian Deadlift`. A band's
 *   resistance is not kilograms of mass and any figure typed there is not
 *   comparable to a bar.
 *
 * What DOES grade is the named lift and the variants whose load is directly
 * comparable and, in all but a couple of cases, strictly below it: front and
 * pause and box squats, every grip and angle of bench press, sumo and deficit
 * and trap-bar pulls, seated and kettlebell presses, bent-over and
 * chest-supported rows. Two of those read slightly high — a trap-bar deadlift
 * and a Smith squat are each worth a few per cent more than the free-barbell
 * lift — and they are kept anyway: the bands here are 25 to 50 percentage
 * points of bodyweight wide, a few per cent does not cross one, and refusing
 * them would tell a trap-bar-only or Smith-only lifter they have never
 * deadlifted or squatted.
 *
 * The full per-lift match list against the live catalogue was checked name by
 * name when this was written; the patterns match 66 of the 608 exercises and
 * match NOTHING the old substrings did not — this can only ever narrow.
 */
export const STRENGTH_LIFTS: StrengthLift[] = [
  { name: 'Squat', re: /\bsquats?\b/, not: /\b(bodyweight|jump|pistol|split|hack|overhead|wall|trx|cossack|banded|machine)\b/, mult: [0.75, 1.25, 1.5, 2.0, 2.5] },
  { name: 'Bench Press', re: /\bbench\s+press\b/, not: /\b(bodyweight|machine)\b/, mult: [0.5, 0.75, 1.0, 1.5, 2.0] },
  { name: 'Deadlift', re: /\bdeadlifts?\b/, not: /\b(bodyweight|romanian|rdl|stiff[- ]?leg|straight[- ]?leg|single[- ]?leg|kickstand|banded|machine)\b/, mult: [1.0, 1.5, 2.0, 2.5, 3.0] },
  { name: 'Overhead Press', re: /\b(overhead|shoulder|military)\s+press(es)?\b|\bohp\b/, not: /\b(bodyweight|machine)\b/, mult: [0.35, 0.55, 0.7, 0.9, 1.1] },
  { name: 'Row', re: /\brows?\b/, not: /\b(bodyweight|upright|rear\s+delt|inverted|rings?|trx|sled|cable|t-?bar|machine)\b|\bseated\s+row\b/, mult: [0.5, 0.75, 1.0, 1.25, 1.5] },
];

/**
 * The exercise name as the patterns above read it.
 *
 * Lowercased, and with "Smith machine" collapsed to "Smith" — which is the one
 * piece of cleverness here and it is load-bearing. Every `not` above refuses
 * `machine`, because a selectorized stack is not the mass the member lifted; a
 * Smith machine is a barbell on rails and its plates are exactly what they say
 * they are. Without this line `Smith Machine Squat` and `Smith Machine
 * Shoulder Press` would be thrown out with `Hack Squat` and `Machine Shoulder
 * Press`, and a member who trains in a Smith rack would be told they have
 * never squatted.
 */
export const normalise = (exercise: string): string =>
  exercise.toLowerCase().replace(/\bsmith\s+machine\b/g, 'smith');

/** Whether an exercise NAME grades against `lift`. Name only — see `countsFor`. */
export const isLift = (lift: Pick<StrengthLift, 're' | 'not'>, exercise: string): boolean => {
  const n = normalise(exercise);
  return lift.re.test(n) && !lift.not.test(n);
};

/**
 * Whether a personal record grades against `lift` — the whole test, name and
 * load together.
 *
 * `!bodyweight` is the belt to the patterns' braces, and it is here because a
 * name is not the only way a body gets onto this board. None of the five lifts
 * above is a bodyweight movement — they are a bar, five times over — so a
 * record whose load came from a weigh-in cannot be one of them, whatever it is
 * called. A trainer writing their own exercise name, or a member who ticks
 * Bodyweight on a bench press by accident, would otherwise put their own
 * weight through Epley and read it back as a max. The catalogue is 608 names
 * long and the box for typing a new one has no length limit at all, so this is
 * the half of the guard that covers everything the table cannot enumerate.
 */
export const countsFor = (
  lift: Pick<StrengthLift, 're' | 'not'>,
  record: { exercise: string; bodyweight?: boolean | null },
): boolean => !record.bodyweight && isLift(lift, record.exercise);
