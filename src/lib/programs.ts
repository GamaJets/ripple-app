// AI-style workout program — planned from goal + InBody body composition.
// The client just logs weight/reps against the plan; every exercise has
// alternatives if they'd rather not do it.
import type { Goal } from './types';

export interface ProgramExercise {
  key: string; name: string; group: string; sets: number; reps: string; alternatives: string[];
  /**
   * The load ACTUALLY PUT ON THE MACHINE for this exercise, in KILOGRAMS, or
   * null when nobody has said.
   *
   * Not a target. The number a member wants beside sets and reps is what they
   * loaded, because that is the one that changes week to week and the one they
   * have to remember when they walk back to the same machine.
   *
   * Kilograms because the record is metric everywhere else in this app —
   * `readLift` takes what was typed in whatever unit and returns kg, and
   * `liftLabel` reads it back. A second convention here would be a second
   * chance for a pounds member's 225 to be stored as 225 kg, which has happened
   * three times in this codebase already.
   *
   * Optional rather than defaulted: an exercise with no load is the ordinary
   * case — bodyweight work, a movement not loaded yet — and inventing a figure
   * would put a number on screen nobody chose.
   */
  loadKg?: number | null;
  /**
   * What the coach wants said about THIS movement, in their own words.
   *
   * "Keep the elbows tucked", "3-1-1 tempo", "stop two reps short", "the
   * machine by the window, seat on 4". Asked for as "trainer notes attached in
   * the exercise. then they are saved for future reference".
   *
   * A different field from `Program.note`, and deliberately not a reuse of it.
   * That one is the letter at the top of the week — why this block exists, what
   * to watch for overall — and it is read once, on the way in. This is read at
   * the machine, by somebody who has already forgotten the letter. Collapsing
   * the two would lose whichever was written second, and a tempo cue is useless
   * attached to a Tuesday.
   *
   * Optional rather than defaulted to '', for the same reason `loadKg` is: an
   * exercise with nothing to say about it is the ordinary case, and an empty
   * string stored as a note renders an empty bubble under the movement on the
   * client's screen — a coach appearing to have written something and left it
   * blank. The builder therefore writes `undefined` for a blank field rather
   * than trimming to ''.
   *
   * It is the COACH'S VOICE and is attributed as such wherever it is shown. A
   * cue rendered as the app's own instruction is the app telling somebody how
   * to lift, which is not a thing this app is entitled to do.
   */
  note?: string;
  /**
   * How long to rest after each set of THIS movement, in SECONDS, or absent
   * because nobody has said.
   *
   * Asked for as "there should a rest timer in between sets" — the timer itself
   * already existed in the guided runner, hardcoded to 90 seconds for every
   * exercise in every programme. That number is right for accessory work and
   * wrong at both ends of a session: a coach who programmes heavy triples wants
   * three minutes, and the same coach wants forty seconds on a finisher. One
   * constant cannot say either, and a client following a 90 second rest through
   * a set of heavy singles is training something the coach did not write.
   *
   * SECONDS, not minutes, because that is what the runner counts in and what
   * `startRest` takes. A second unit here would be a second chance for "3"
   * meaning three minutes to be stored as three seconds, which is the same
   * class of mistake `loadKg` documents above and which has bitten this
   * codebase repeatedly.
   *
   * Optional rather than defaulted to 90, for the same reason `loadKg` and
   * `note` are optional: an exercise with no rest set is the ordinary case, and
   * writing 90 into every row would make a number nobody chose indistinguishable
   * from one a coach typed. `restSecondsFor` in src/lib/restTimer.ts is the one
   * place that turns an absent value into a usable one, and the runner labels
   * the result so the client can see which they are looking at.
   */
  restSec?: number | null;
  /**
   * Which superset / tri-set / giant set this movement belongs to, or absent
   * because it stands on its own.
   *
   * An OPAQUE ID, and nothing else. It does not say "superset" and it does not
   * say how many movements are in the group, because neither is a fact about
   * this exercise — the name is derived from the size of the run of ADJACENT
   * exercises sharing this id, by `groupLabel`/`badges` in src/lib/setGroups.ts.
   * That file carries the reasoning; the short version is that a stored label
   * and a stored membership can disagree, and then the badge on the client's
   * screen is wrong while they are holding a dumbbell.
   *
   * Adjacency is the model, so reordering, removing and swapping need no
   * handling here: a tri-set that loses a movement is a run of two and is
   * relabelled a superset by the renderer that reads it.
   *
   * Optional, and absent is the ordinary case. Every programme already on a
   * phone has no groups at all, and a `null` or a missing field both mean the
   * same thing to `groupRuns` — which is why nothing here defaults it.
   */
  setGroupId?: string | null;
  /**
   * HOW the sets of this movement are performed — one of the ids in
   * `SET_METHODS` in src/lib/setMethods.ts: 'warmup', 'failure', 'drop',
   * 'amrap', 'restpause', 'cluster', 'tempo', 'eccentric', 'isometric',
   * 'backoff', 'cooldown'. Absent means a straight working set.
   *
   * Two things downstream read it rather than the name, and both would be
   * wrong without it: the rest timer (a drop set has no rest inside it, and
   * `restAfter` returns 0 so no countdown starts), and any total of training
   * volume (a warm-up is real work and is NOT tonnage, and `countsToVolume`
   * is what keeps somebody's numbers from jumping when they did nothing
   * different).
   *
   * A STRING rather than a union, so a programme written by a newer build and
   * opened on an older one still loads: `methodFor` resolves an id it does not
   * know to the default instead of dropping the set. Optional for the same
   * reason `loadKg` and `note` are — most sets are ordinary, and writing
   * 'normal' into every row would be a value nobody chose.
   */
  method?: string | null;
  /**
   * The sets of this movement written out ONE BY ONE, or absent because every
   * set is the same set.
   *
   * Asked for with a screenshot of another app's routine editor, where an
   * exercise is a table — set 1 at 42.5 for ten, set 2 at 42.5 for ten, set 3
   * at 45 for eight — rather than a single "3 × 8-10 at 42.5". Everything
   * above this line describes one set and multiplies it by `sets`, so a coach
   * could not write a top set heavier than its back-offs, could not ramp, and
   * could not say that set 1 is a warm-up and set 4 is a drop set. That last
   * one is what `method` is for and is the one thing a per-exercise field
   * cannot say twice.
   *
   * OPTIONAL, and absent is the ordinary case — the rules for reading it are
   * in src/lib/setRows.ts and every one of them falls back to `sets`, `reps`,
   * `loadKg` and `method` when it is not here. That is not politeness about
   * old data. A programme lives in `program_templates`, on each client's
   * assignment, and in the coach's on-device draft in AsyncStorage, and no
   * migration reaches all three — so an exercise without this field must
   * render and run in a new build exactly as it does in the old one, and
   * nothing writes it onto an exercise the coach has not edited.
   *
   * A row's own fields are optional for the same reason and read by the same
   * rule: an ABSENT key takes the exercise's value, a PRESENT one is the row's
   * own answer. So `{}` follows the exercise, `{ loadKg: null }` is a row with
   * nothing on the bar, and `{ method: null }` is an ordinary set inside an
   * exercise whose default is not.
   *
   * `sets` is kept equal to the number of rows by whoever writes them. Every
   * reader in the app counts progress against `sets` — "2 of 3 sets" on the
   * plan card, `done.length >= ex.sets` in the runner — and none of them knows
   * this field exists, so the two numbers are one fact and are written
   * together.
   *
   * Loads are KILOGRAMS here as they are everywhere else in this file; see
   * `loadKg` above for why a second convention is not on offer.
   */
  setRows?: Array<{ reps?: string | null; loadKg?: number | null; method?: string | null }> | null;
}
export interface ProgramDay { day: string; focus: string; cardio?: string; exercises: ProgramExercise[]; }
export interface Program { title: string; focus: string[]; note: string; days: ProgramDay[]; }

const E = (key: string, name: string, group: string, sets: number, reps: string, alternatives: string[]): ProgramExercise => ({ key, name, group, sets, reps, alternatives });

/** Focus areas inferred from body composition + goal (stands in for the scan/photo analysis). */
export function focusAreas(bodyFatPct: number | null | undefined, goal: Goal): string[] {
  const f: string[] = [];
  if (goal === 'fatloss') f.push('Full-body strength', 'Conditioning');
  else if (goal === 'muscle') f.push('Hypertrophy', 'Progressive overload');
  else f.push('Muscle tone', 'Definition');
  if (bodyFatPct != null && bodyFatPct >= 25) f.push('Glutes & core');
  else f.push('Shoulders & back');
  return f;
}

/** bodyFatPct may be null: a client with no scan still gets a program, it just
 *  is not biased by a body-composition figure nobody measured. */
export function buildProgram(goal: Goal, bodyFatPct: number | null | undefined): Program {
  const focus = focusAreas(bodyFatPct, goal);
  // Says only what is true. This used to read "Built from your latest InBody scan
  // (N% body fat) and goal. Your coach flagged X as a priority…" — but the caller
  // supplies bodyFatPct, and three of the six call sites pass a hardcoded constant
  // (25 from the trainer builder, 26/28/30 from the starter templates) for clients
  // who may have no scan at all and no coach. It claimed a measurement that had
  // not been taken and a coach decision nobody had made. The note is not currently
  // rendered to clients; this keeps it safe for whenever it is.
  const note = `A ${goal === 'fatloss' ? 'fat-loss' : goal === 'muscle' ? 'muscle-building' : 'toning'} plan with extra volume on ${(focus[focus.length - 1] || 'strength').toLowerCase()}. Progress the weight when you hit the top of the rep range.`;

  if (goal === 'muscle') {
    return {
      title: 'Push · Pull · Legs',
      focus, note,
      days: [
        { day: 'Mon', focus: 'Push', exercises: [E('bench', 'Bench Press', 'Chest', 4, '6-8', ['Dumbbell Press', 'Machine Chest Press', 'Push-up']), E('ohp', 'Overhead Press', 'Shoulders', 4, '8-10', ['Dumbbell Shoulder Press', 'Arnold Press']), E('incline', 'Incline Dumbbell Press', 'Chest', 3, '8-10', ['Incline Machine Press', 'Landmine Press']), E('lateral', 'Lateral Raise', 'Shoulders', 3, '12-15', ['Cable Lateral', 'Upright Row']), E('tricep', 'Triceps Pushdown', 'Arms', 3, '10-12', ['Skull Crusher', 'Dips']) ] },
        { day: 'Wed', focus: 'Pull', exercises: [E('deadlift', 'Deadlift', 'Back', 4, '5-6', ['Rack Pull', 'Trap-bar Deadlift']), E('pull', 'Pull-up', 'Back', 4, '6-10', ['Lat Pulldown', 'Assisted Pull-up']), E('row', 'Bent-over Row', 'Back', 3, '8-10', ['Seated Cable Row', 'Dumbbell Row']), E('facepull', 'Face Pull', 'Shoulders', 3, '12-15', ['Reverse Fly', 'Band Pull-apart']), E('curl', 'Barbell Curl', 'Arms', 3, '10-12', ['Dumbbell Curl', 'Hammer Curl']) ] },
        { day: 'Fri', focus: 'Legs', exercises: [E('squat', 'Back Squat', 'Legs', 4, '6-8', ['Front Squat', 'Leg Press', 'Goblet Squat']), E('rdl', 'Romanian Deadlift', 'Hamstrings', 4, '8-10', ['Leg Curl', 'Good Morning']), E('hipthrust', 'Hip Thrust', 'Glutes', 3, '10-12', ['Glute Bridge', 'Cable Kickback']), E('lunge', 'Walking Lunge', 'Legs', 3, '12', ['Bulgarian Split Squat', 'Step-up']), E('calf', 'Calf Raise', 'Calves', 4, '12-15', ['Seated Calf Raise', 'Leg-press Calf']) ] },
      ],
    };
  }
  // fatloss / tone → 3-day full body + conditioning, glute/core emphasis
  return {
    title: 'Full-body + Conditioning',
    focus, note,
    days: [
      { day: 'Mon', focus: 'Full Body A', cardio: '15 min incline walk', exercises: [E('squat', 'Back Squat', 'Legs', 4, '8-10', ['Goblet Squat', 'Leg Press', 'Bulgarian Split Squat']), E('hipthrust', 'Hip Thrust', 'Glutes', 3, '10-12', ['Glute Bridge', 'Cable Kickback', 'Step-up']), E('bench', 'Dumbbell Bench Press', 'Chest', 3, '10-12', ['Push-up', 'Machine Chest Press']), E('row', 'Seated Row', 'Back', 3, '10-12', ['Lat Pulldown', 'Dumbbell Row']), E('plank', 'Plank', 'Core', 3, '45 sec', ['Dead Bug', 'Hollow Hold']) ] },
      { day: 'Wed', focus: 'Full Body B', cardio: '20 min intervals', exercises: [E('rdl', 'Romanian Deadlift', 'Hamstrings', 4, '8-10', ['Leg Curl', 'Kettlebell Swing']), E('lunge', 'Walking Lunge', 'Legs', 3, '12', ['Reverse Lunge', 'Step-up']), E('ohp', 'Shoulder Press', 'Shoulders', 3, '10-12', ['Arnold Press', 'Lateral Raise']), E('pull', 'Lat Pulldown', 'Back', 3, '10-12', ['Assisted Pull-up', 'Straight-arm Pulldown']), E('core', 'Cable Crunch', 'Core', 3, '15', ['Hanging Knee Raise', 'Russian Twist']) ] },
      { day: 'Fri', focus: 'Full Body C', cardio: '15 min row', exercises: [E('hipthrust', 'Hip Thrust', 'Glutes', 4, '10-12', ['Glute Bridge', 'Cable Kickback']), E('squat', 'Goblet Squat', 'Legs', 3, '10-12', ['Leg Press', 'Split Squat']), E('bench', 'Push-up', 'Chest', 3, '12', ['Dumbbell Press', 'Machine Press']), E('row', 'Dumbbell Row', 'Back', 3, '12', ['Seated Row', 'Lat Pulldown']), E('plank', 'Side Plank', 'Core', 3, '30 sec/side', ['Pallof Press', 'Bird Dog']) ] },
    ],
  };
}

/** Today's day from the program based on weekday (Mon/Wed/Fri → nearest). */
export function todayIndex(days: ProgramDay[], weekday: number): number {
  // weekday: 0 Sun..6 Sat. Map program days to their weekday.
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  let best = 0, bestDiff = 99;
  days.forEach((d, i) => { const diff = Math.abs(map[d.day] - weekday); if (diff < bestDiff) { bestDiff = diff; best = i; } });
  return best;
}
