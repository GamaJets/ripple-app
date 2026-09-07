// A stretch routine: which stretches, in what order, held for how long, and on
// which side.
//
// ── Why this is a MODE and not a sixth WorkoutKind ─────────────────────────
//
// Reported as "in the train tab under type of work out we have recovery,
// stretch is not an option". It is a real gap in the picker and it is NOT a
// gap in the taxonomy, and those are two different repairs.
//
// `WORKOUT_KIND` in src/lib/workoutKind.ts has five members and is derived from
// the logged exercise NAME — there is no `kind` column on `workouts`, so a
// kind is a property of a name rather than something written down. Adding
// 'stretch' to that list therefore means moving "Stretching" out of
// MOBILITY_ACTIVITIES, and that re-reads history: a session logged three weeks
// ago as "Stretching" is a mobility dot on the calendar today and would become
// a stretch dot tomorrow, with nothing having happened to it. The brief for
// this work asked that a previously-logged mobility session keep reading
// correctly, and that alone rules the new kind out.
//
// It is also the wrong shape. A kind has to have a complement worth naming:
// if stretching leaves Mobility, what is left is Yoga (poses held for length),
// Pilates (controlled range), Dynamic Warm-Up (dynamic stretching) and Foam
// Rolling. Only Foam Rolling is clearly not stretching. A category whose
// complement is one activity is not a category, it is a mislabel.
//
// The precedent for the fix is already written down, in workoutKind.ts's note
// on KIND_LABEL: 'strength' reads as "Strength" on a calendar dot and as
// "Program" in Train's picker, "deliberately rather than an oversight" —
// because the picker names WHAT YOU ARE ABOUT TO DO and a kind names WHAT A
// PAST SESSION WAS. Stretch is the same separation used a second time. It is a
// mode in the picker; the session it writes is a Mobility session named
// "Stretching", which is exactly what Train's Mobility chip has always
// produced. Nothing is counted twice, because there is no second bucket: the
// calendar, the weekly report and the coach's adherence all see one mobility
// session, before this change and after it.
//
// ── Why the timings live here and not on the screen ────────────────────────
//
// Everything below can be wrong in a way nobody sees on a screenshot. A
// unilateral stretch that expands to one stage instead of two is half a
// routine, done on one leg, and it looks completely normal. A total that counts
// the holds and forgets that the same stretch is done twice under-states every
// routine on the list. A "5 min" label on an eight-minute routine is a small
// lie somebody plans their evening around. None of that is assertable while it
// lives inside a React component holding a wall clock, so it lives here.
//
// Pure and dependency-free, like src/lib/restTimer.ts next door, which owns the
// other countdown in this app and whose `shouldTick` the runner reuses rather
// than growing a second copy of.

/** Which side of the body a stage is for. 'both' is a stretch that is not
 *  sided at all — a forward fold is one stretch, not two. */
export type StretchSide = 'both' | 'left' | 'right';

/**
 * One stretch in a routine.
 *
 * `id` is the CATALOGUE key, which is `exerciseSlug(name)` and is NOT RepDB's
 * own id — see the header of src/lib/repdbImport.ts, where the difference cost
 * this repo a production incident. RepDB calls Child's Pose 'childs-pose'; our
 * row is 'child-s-pose', because every screen in the app resolves a movement by
 * the slug of its name. Getting this wrong here would not fail: the routine
 * would render with a name and no picture, which reads as media we are missing
 * rather than as a key we typed wrong.
 */
export interface StretchStep {
  /** `exerciseSlug(name)` — the id of the row in `exercises`. */
  id: string;
  /** The catalogue's own spelling, so the routine and the exercise screen name
   *  the same movement identically. */
  name: string;
  /** Seconds to hold the position — or, for a flow, seconds to keep moving. */
  holdSec: number;
  /**
   * 2 when the stretch is done on each side and 1 when it is not.
   *
   * `exercises.is_unilateral`, which our catalogue DOES now store — the column
   * arrived with the RepDB v1.41 drop, `boolean not null default false`, and it
   * is granted SELECT to `authenticated`. The note that used to sit here said
   * the opposite and was true when it was written.
   *
   * The six routines below still carry the number rather than reading it,
   * because they are written down: a fixed routine is a copy decision, and its
   * steps, its holds and its sides were chosen together and are edited
   * together. What has changed is that this is no longer a fact with only one
   * home. src/lib/stretchBuilder.ts derives the same field from the column for
   * every routine it BUILDS, and stretchRoutine.test.ts checks the six against
   * the same list of unilateral ids the builder's test keeps — so the day the
   * pack and this file disagree, a test says so rather than a member stretching
   * one leg and calling it done.
   */
  sides: 1 | 2;
  /**
   * True for a stretch that MOVES rather than one that is held.
   *
   * This is the single most important field on the screen and it is not about
   * media. `exercises.force` — RepDB's `force_type`, on our table since
   * supabase/parts/71-exercise-catalogue.sql — is 'dynamic' on fifteen of the
   * 79 stretching rows and 'static' on the rest, and the dynamic ones are
   * exactly the ones that ship an animation, because a flow is the only one of
   * the two that HAS anything to animate. A still and a hold duration is not a
   * degraded demonstration of a static stretch, it is the correct and complete
   * one. The builder next door reads that column; the six routines below carry
   * the answer, for the reason `sides` above gives.
   *
   * So nothing downstream may treat the other 64 as missing media. The runner
   * reads this to choose its words — "Hold" against "Keep moving" — and never
   * to apologise for a picture that is not there.
   */
  flow: boolean;
}

/** A routine the client can follow start to finish. */
export interface StretchRoutine {
  /** Stable, and used as a route parameter. Never renamed once shipped: it is
   *  what a deep link and a resumed screen carry. */
  id: string;
  /** Title Case — it is drawn as a `<ListRow title>`. Asserted in the test
   *  rather than by scripts/check-caps.mjs, which reads literal attributes and
   *  cannot see a title that arrives from an array. */
  title: string;
  /** Sentence case: this is prose under the title, not a label. */
  note: string;
  steps: StretchStep[];
}

/* ── the bounds, and why they are these numbers ──────────────────────────── */

/**
 * The shortest hold a routine may ask for, in seconds.
 *
 * Fifteen. Under that is not a stretch, it is a touch — the tissue has not
 * begun to lengthen and the countdown is over before the person has settled
 * into the position. It is also the floor that makes a typo visible: a hold
 * written as 3 instead of 30 would otherwise flash past and read as the timer
 * being broken.
 */
export const MIN_HOLD_SEC = 15;

/**
 * The longest, in seconds.
 *
 * Two minutes. Not a claim that a longer hold is bad — a restorative pose is
 * held far longer — but a limit on the same typing accident restTimer.ts
 * guards: the field is seconds, and 300 meaning five minutes is one keystroke
 * from 3000. A routine of six stretches at two minutes a side is already
 * twenty-four minutes, which is the outer edge of something somebody will
 * actually finish.
 */
export const MAX_HOLD_SEC = 120;

/**
 * How long moving between two stages takes, in seconds.
 *
 * Ten, and it exists so the time we print is the time it takes. The holds in
 * "Lower Body Unwind" add up to 310 seconds, which is 5 minutes; the routine
 * takes closer to 7, because getting off the floor and into the next position
 * is not free and there are eight of those changes. Printing 5 would be a
 * figure nobody's evening matches.
 *
 * It is an estimate and only ever feeds an estimate. What gets WRITTEN to the
 * log is the measured clock — see `loggableMinutes`.
 */
export const TRANSITION_SEC = 10;

/* ── the routines ────────────────────────────────────────────────────────── */

// Built from the `category: 'stretching'` rows in the RepDB Standard pack — 79
// of them as of v1.41 — and deliberately from the 58 that need no equipment.
// Eleven of the 79 want a resistance band and ten want a flat bench; a starter
// set that opened with "you will need a band" is a routine most people cannot
// start, and the point
// of these six is that somebody can begin one on the floor beside their bed.
// The banded and bench variants are all in the catalogue and reachable from the
// exercise library — they are simply not what a first routine should assume.
//
// The Pilates flows (Roll Down, Saw, Spine Stretch Forward, Spine Twist) are
// left out for a different reason: Pilates is its own entry in
// MOBILITY_ACTIVITIES, and folding its repertoire into a stretch routine
// muddles two things a member picked between one screen earlier.
const step = (id: string, name: string, holdSec: number, sides: 1 | 2, flow = false): StretchStep =>
  ({ id, name, holdSec, sides, flow });

export const STRETCH_ROUTINES: readonly StretchRoutine[] = [
  {
    id: 'lower-body',
    title: 'Lower Body Unwind',
    note: 'Hamstrings, quads, calves and glutes, standing then on the floor. The one to reach for after a leg session.',
    steps: [
      step('standing-forward-fold', 'Standing Forward Fold', 30, 1),
      step('standing-quad-stretch', 'Standing Quad Stretch', 30, 2),
      step('standing-calf-stretch', 'Standing Calf Stretch', 30, 2),
      step('seated-forward-fold', 'Seated Forward Fold', 40, 1),
      step('butterfly-stretch', 'Butterfly Stretch', 40, 1),
      step('pigeon-stretch', 'Pigeon Stretch', 40, 2),
    ],
  },
  {
    id: 'hips',
    title: 'Hips & Glutes',
    note: 'For hips that have been sitting down all day. Opens the front of the hip first, then the glute behind it.',
    steps: [
      step('low-lunge', 'Low Lunge', 40, 2),
      step('half-kneeling-hip-flexor-rock', 'Half-Kneeling Hip Flexor Rock', 40, 2, true),
      step('pigeon-stretch', 'Pigeon Stretch', 40, 2),
      step('butterfly-stretch', 'Butterfly Stretch', 40, 1),
      step('happy-baby-pose', 'Happy Baby Pose', 40, 1),
      step('supine-spinal-twist', 'Supine Spinal Twist', 40, 2),
    ],
  },
  {
    id: 'back',
    title: 'Back & Spine',
    note: 'Moves the spine through flexion, rotation and extension. Start on all fours and finish lying down.',
    steps: [
      step('cat-cow', 'Cat-Cow', 40, 1, true),
      step('child-s-pose', "Child's Pose", 40, 1),
      step('thread-the-needle-flow', 'Thread the Needle Flow', 40, 2, true),
      step('sphinx-pose', 'Sphinx Pose', 30, 1),
      step('seated-spinal-twist', 'Seated Spinal Twist', 30, 2),
      step('knee-to-chest-stretch', 'Knee-to-Chest Stretch', 30, 2),
    ],
  },
  {
    id: 'upper-body',
    title: 'Neck, Shoulders & Chest',
    note: 'The desk routine. Nothing here needs the floor, so it works in an office or between sets.',
    steps: [
      step('neck-side-stretch', 'Neck Side Stretch', 20, 2),
      step('cross-body-shoulder-stretch', 'Cross-Body Shoulder Stretch', 30, 2),
      step('overhead-triceps-stretch', 'Overhead Triceps Stretch', 30, 2),
      step('doorway-chest-stretch', 'Doorway Chest Stretch', 30, 1),
      step('puppy-pose', 'Puppy Pose', 40, 1),
      step('standing-side-bend-flow', 'Standing Side Bend Flow', 40, 1, true),
    ],
  },
  {
    id: 'full-body',
    title: 'Full Body Flow',
    note: 'Six moving sequences rather than held positions — every one of these is demonstrated as an animation.',
    steps: [
      step('cat-cow', 'Cat-Cow', 40, 1, true),
      step('standing-forward-fold-to-half-lift', 'Standing Forward Fold to Half Lift', 40, 1, true),
      step('downward-dog-to-low-lunge', 'Downward Dog to Low Lunge', 40, 2, true),
      step('low-lunge-to-half-split', 'Low Lunge to Half Split', 40, 2, true),
      step('downward-dog-pedal', 'Downward Dog Pedal', 40, 1, true),
      step('thread-the-needle-flow', 'Thread the Needle Flow', 40, 2, true),
    ],
  },
  {
    id: 'cool-down',
    title: 'Post-Session Cool-Down',
    note: 'The shortest one here, covering everything you are likely to have just worked. Short enough to actually do at the end.',
    steps: [
      step('standing-forward-fold', 'Standing Forward Fold', 30, 1),
      step('kneeling-hip-flexor-stretch', 'Kneeling Hip Flexor Stretch', 30, 2),
      step('child-s-pose', "Child's Pose", 40, 1),
      step('cross-body-shoulder-stretch', 'Cross-Body Shoulder Stretch', 30, 2),
      step('supine-spinal-twist', 'Supine Spinal Twist', 30, 2),
    ],
  },
];

/** The routine with that id, or null. Null is a real answer: the id arrives as
 *  a route parameter and can be anything, including a link to a routine that
 *  was renamed. The screen says so rather than rendering an empty runner. */
export function routineById(id: string | null | undefined): StretchRoutine | null {
  const key = String(id ?? '').trim();
  if (!key) return null;
  return STRETCH_ROUTINES.find((r) => r.id === key) ?? null;
}

/* ── stages: what the runner actually walks through ──────────────────────── */

/**
 * One position, on one side, for one length of time.
 *
 * A ROUTINE is written in stretches and a RUNNER walks stages, and they are not
 * the same list: six stretches of which four are unilateral is ten stages. The
 * expansion happens once, here, because doing it in the screen means doing it
 * again in the progress line and the estimate, and three copies of "is this one
 * sided" is three chances to leave somebody stretching one leg.
 */
export interface StretchStage {
  step: StretchStep;
  /** 0-based index of the STRETCH within the routine, for "3 of 6". */
  stepIndex: number;
  side: StretchSide;
  /** Seconds this stage runs for. The step's hold — a sided stretch is held as
   *  long on each side, not for half the time twice. */
  seconds: number;
}

/**
 * Every stage of a routine, in the order they are done.
 *
 * Left before right, always the same way round. Which side is first does not
 * matter physically and the CONSISTENCY does: somebody who has done a routine
 * four times knows what is coming, and alternating it would make the app the
 * only thing in the room that is not predictable.
 */
export function routineStages(routine: StretchRoutine | null | undefined): StretchStage[] {
  if (!routine) return [];
  const out: StretchStage[] = [];
  routine.steps.forEach((s, stepIndex) => {
    const seconds = s.holdSec;
    if (s.sides === 2) {
      out.push({ step: s, stepIndex, side: 'left', seconds });
      out.push({ step: s, stepIndex, side: 'right', seconds });
    } else {
      out.push({ step: s, stepIndex, side: 'both', seconds });
    }
  });
  return out;
}

/** "Left side" / "Right side", or null when the stretch is not sided. Null
 *  rather than an empty string, so a caller renders nothing at all instead of
 *  an empty line that still takes up space under the position's name. */
export function sideLabel(side: StretchSide): string | null {
  if (side === 'left') return 'Left side';
  if (side === 'right') return 'Right side';
  return null;
}

/**
 * The word for what the person is being asked to do.
 *
 * "Hold" for a static stretch and "Keep moving" for a flow, and this is the
 * whole reason `flow` exists on the step. A screen that said "Hold" over
 * Cat-Cow would be instructing somebody to freeze halfway through a movement
 * whose entire point is that it does not stop.
 */
export function stageVerb(step: StretchStep): string {
  return step.flow ? 'Keep moving' : 'Hold';
}

/* ── how long it takes ───────────────────────────────────────────────────── */

/** Seconds of actual stretching in a routine — the holds, both sides counted. */
export function routineHoldSec(routine: StretchRoutine | null | undefined): number {
  return routineStages(routine).reduce((n, s) => n + s.seconds, 0);
}

/**
 * Seconds the routine takes end to end, holds plus the moves between them.
 *
 * `stages - 1` transitions, not `stages`: there is no move into the first
 * position — the person is already standing there when they press start — and
 * none out of the last. Counting both would add twenty seconds to every
 * routine on the list for time nobody spends.
 */
export function routineTotalSec(routine: StretchRoutine | null | undefined): number {
  const stages = routineStages(routine);
  if (!stages.length) return 0;
  return routineHoldSec(routine) + (stages.length - 1) * TRANSITION_SEC;
}

/**
 * The routine's length as a whole number of minutes, rounded up.
 *
 * Up, not nearest. This is the figure somebody decides whether they have time
 * for, and a routine that says 6 and takes 6 and a half has cost them the last
 * stretch. Rounding up can only ever finish early, which nobody minds.
 */
export function routineMinutes(routine: StretchRoutine | null | undefined): number {
  // No `secs > 0 ?` guard. It was here and it was dead: `routineTotalSec` never
  // returns a negative, and Math.ceil(0 / 60) is already 0, so the branch could
  // not change any answer this function can be asked for. Deleted rather than
  // left as reassurance — a survivor in scripts/mutate.mjs is either a missing
  // test or a line nothing depends on, and this was the second.
  return Math.ceil(routineTotalSec(routine) / 60);
}

/**
 * The line under a routine's title: how many stretches and roughly how long.
 *
 * "About" is doing real work and is not padding. The number is an estimate
 * built from a fixed ten seconds per change of position, and somebody who takes
 * their time will run over it. Saying "7 min" flat would make that a broken
 * promise instead of a rough guide.
 */
export function routineSummary(routine: StretchRoutine | null | undefined): string {
  if (!routine || !routine.steps.length) return '';
  const n = routine.steps.length;
  return `${n} ${n === 1 ? 'stretch' : 'stretches'} · about ${routineMinutes(routine)} min`;
}

/**
 * The minutes a finished routine is written to the log as.
 *
 * The MEASURED clock, never `routineTotalSec`. The estimate is what the list
 * promises; the log records what happened, and those differ every time — a
 * stage skipped, a phone put down mid-routine, thirty seconds finding the wall.
 * Writing the plan instead of the clock would put sessions in somebody's
 * history they did not do, which is the same class of defect as `cardioKcal`
 * falling back to 70 kg.
 *
 * Rounded to the nearest minute because the `workouts` row stores whole
 * minutes, and 0 for anything under thirty seconds. Zero is not a failure and
 * the caller must not save it: `commitSession` refuses a zero-minute session,
 * and a routine abandoned on the first stretch is not a session.
 *
 * The `<= 0` is doing one job that is easy to miss: `Math.round(-5 / 60)` is
 * NEGATIVE ZERO, which is not `0` to `Object.is` and would come out of a JSON
 * round trip as `-0`. The guard is what keeps the return a plain 0.
 *
 * scripts/mutate.mjs leaves two survivors on this line and they are the only
 * two in the file — `<= 0` widened to `< 0`, and to `<= 1`. Both are EQUIVALENT
 * MUTANTS rather than missing tests, and the reason is arithmetic: an elapsed
 * of 0 and an elapsed of 1 both come out of `Math.round(n / 60)` as 0 anyway,
 * so no input exists that would tell the three versions apart. Written down
 * here so the next person to run the mutation report does not spend an
 * afternoon trying to write the test that cannot exist.
 */
export function loggableMinutes(elapsedSec: number): number {
  if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) return 0;
  return Math.round(elapsedSec / 60);
}

/* ── progress, and what "done" means ─────────────────────────────────────── */

/**
 * Whether `index` is the last stage of `stages`.
 *
 * Its own function because the runner asks it twice — once to label the button
 * "Finish" instead of "Next", and once to decide what happens when the
 * countdown reaches zero — and those two answers going out of step is a routine
 * that ends one stretch early, or one that will not end at all.
 */
export function isLastStage(stages: readonly StretchStage[], index: number): boolean {
  // The length guard is NOT redundant, and the case it covers is the one that
  // matters: an empty routine has `length - 1` of -1, so a caller sitting at
  // index -1 before it has started would be told it is standing on the last
  // stage of a routine with no stages, and the runner would go straight to its
  // finish screen.
  return stages.length > 0 && index === stages.length - 1;
}

/**
 * The next stage's index, or null when there is no next one.
 *
 * Null is the signal to finish. Returning `stages.length` instead — the obvious
 * alternative — puts the runner on a stage that does not exist for one render,
 * which is a crash on `stages[i].step.name`.
 */
export function nextStageIndex(stages: readonly StretchStage[], index: number): number | null {
  if (index < 0) return stages.length ? 0 : null;
  return index + 1 < stages.length ? index + 1 : null;
}

/** "Stretch 3 of 6" — counted in STRETCHES, not stages. A member reading
 *  "stage 5 of 10" halfway through a six-stretch routine has been told a number
 *  about our data structure rather than about their evening. */
export function stageProgress(stages: readonly StretchStage[], index: number, routine: StretchRoutine | null | undefined): string {
  const stage = stages[index];
  if (!stage || !routine) return '';
  return `Stretch ${stage.stepIndex + 1} of ${routine.steps.length}`;
}

/* ── the invariants, asserted rather than hoped for ──────────────────────── */

/**
 * Everything wrong with the routines above, as sentences. Empty when they hold.
 *
 * Run from the test rather than at runtime: these are properties of a constant
 * in this file, so they cannot change between builds and checking them on a
 * phone would be spending a member's battery on our typing. What they catch is
 * the seventh routine somebody adds in a hurry.
 */
export function routineProblems(routines: readonly StretchRoutine[] = STRETCH_ROUTINES): string[] {
  const problems: string[] = [];
  const seenRoutines = new Set<string>();
  for (const r of routines) {
    if (seenRoutines.has(r.id)) problems.push(`two routines share the id "${r.id}" — routineById would only ever open one of them`);
    seenRoutines.add(r.id);
    if (!r.title.trim()) problems.push(`routine "${r.id}" has no title`);
    if (!r.note.trim()) problems.push(`routine "${r.id}" has no note, so its row would be a title over an empty line`);
    if (!r.steps.length) problems.push(`routine "${r.id}" has no stretches in it`);
    const seenSteps = new Set<string>();
    for (const s of r.steps) {
      if (seenSteps.has(s.id)) problems.push(`"${r.id}" holds ${s.id} twice — the runner would ask for the same position two stages apart with no reason on screen`);
      seenSteps.add(s.id);
      if (!/^[a-z0-9-]+$/.test(s.id)) problems.push(`"${s.id}" in "${r.id}" is not a catalogue slug, so no row would resolve for it`);
      if (!s.name.trim()) problems.push(`${s.id} in "${r.id}" has no name`);
      if (!Number.isInteger(s.holdSec)) problems.push(`${s.id} in "${r.id}" holds for ${s.holdSec} seconds, which is not a whole second`);
      if (s.holdSec < MIN_HOLD_SEC) problems.push(`${s.id} in "${r.id}" holds for ${s.holdSec}s, under the ${MIN_HOLD_SEC}s floor`);
      if (s.holdSec > MAX_HOLD_SEC) problems.push(`${s.id} in "${r.id}" holds for ${s.holdSec}s, over the ${MAX_HOLD_SEC}s ceiling`);
      if (s.sides !== 1 && s.sides !== 2) problems.push(`${s.id} in "${r.id}" claims ${s.sides} sides`);
    }
  }
  return problems;
}
