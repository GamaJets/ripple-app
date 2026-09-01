// The shape of a logged workout, and nothing else any more.
//
// ── What this file used to be ──────────────────────────────────────────────
//
// It was the shapes for a no-backend repo (`mockRepo`), used when the app ran
// standalone in Expo Go before Supabase was wired. It carried a full fake
// client — a 6-point weight and body-fat history, two InBody scans, five
// logged workouts, a coach/client message thread, and a trainer named "Coach
// Daniel Reyes". Although `mockRepo` was not used once USE_SUPABASE was on,
// the literals still shipped inside the production Hermes bundle, and that
// exact workout log is the seed that ended up written into real users'
// Supabase rows. The people and numbers were emptied out then.
//
// ── Why the husks are gone too ─────────────────────────────────────────────
//
// `src/data/repo.ts` was the only thing that read MOCK_CLIENT, MOCK_MESSAGES,
// MOCK_FOOD, MOCK_TRAINER and MOCK_SESSIONS, and nothing at all read
// `repo.ts` — `USE_SUPABASE` is a hardcoded `true` in src/lib/config.ts, so
// the branch that reached for a mock repo cannot be taken. A live module full
// of plausible-shaped fake gym rows is the exact ingredient the incident above
// was made of, so both are deleted rather than left emptied.
//
// The file keeps its name because `WorkoutEntry` is imported by name from a
// dozen screens and renaming it is a separate change from removing dead data.
import type { Goal, Diet, Sex, Scan } from './types';

export interface MockClient {
  id: string;
  name: string;
  sex: Sex;
  dob: string;
  heightCm: number;
  goal: Goal;
  diet: Diet;
  activity: number;
  mealsPerDay: 3 | 4 | 5;
  weight: { t: string; v: number }[];
  bodyFat: { t: string; v: number }[];
  muscle: { t: string; v: number }[];
  scans: Scan[];
  log: WorkoutEntry[];
}
export interface WorkoutEntry {
  /** Primary key of the `workouts` row, once it has been saved. Absent on an
   *  entry that has only just been logged and not yet come back from the
   *  server. Edits and deletes match on this when it is there: matching on
   *  timestamp and exercise name instead would hit every row of a session,
   *  since one session writes all its exercises with the same timestamp. */
  id?: string;
  t: string;
  exercise: string;
  sets?: [number, number][];       // [reps, kg]
  /** Which of those sets were the person's own bodyweight, aligned to `sets`
   *  exactly as `feel` is. `bw[i] === true` changes what `sets[i][1]` MEANS:
   *  on an ordinary set it is the load, on a bodyweight set it is what was
   *  ADDED to the body — 0 for a plain pull-up, 20 for one with a belt.
   *
   *  Absent on every entry written before this existed, and absent is not
   *  false-for-every-set by accident: a set that predates the flag genuinely
   *  is not known to be bodyweight, and reading it as "not bodyweight" is the
   *  same answer the app gave before, which is the only honest default.
   *
   *  See src/lib/bodyweightSets.ts for why the flag is explicit rather than
   *  inferred from a stored zero, and for what a bodyweight set contributes to
   *  a tonnage when nobody has recorded what the person weighs. */
  bw?: boolean[];
  /** Which of those sets were HELD rather than repeated, aligned to `sets` the
   *  same way. `timed[i] === true` changes what `sets[i][0]` MEANS: on an
   *  ordinary set it is repetitions, on a timed set it is SECONDS.
   *
   *  This exists because the app prescribes holds and could not accept one:
   *  `buildProgram` writes '45 sec' planks and '30 sec/side' side planks, the
   *  isometric set method's own blurb says "the reps column is seconds", and
   *  both log paths refused anything that was not a positive whole number of
   *  reps. What people typed instead was 45 into a reps box, which reads for
   *  ever after as forty-five plank repetitions.
   *
   *  Absent on every entry written before this existed, and absent is NOT
   *  false-for-every-set: a 45 typed into a reps box last month is a figure
   *  nobody can now interpret, and relabelling it as a hold would invent a
   *  plank that may never have happened.
   *
   *  See src/lib/timedSets.ts for why a hold contributes no tonnage and no
   *  estimated 1RM, and what it is worth instead. */
  timed?: boolean[];
  feel?: ('easy' | 'ok' | 'hard')[]; // per-set perceived effort (RPE), aligned to sets
  cardio?: { mins: number; dist: number; unit: string; watts?: number; hrAvg?: number; hrHigh?: number };
  /** Seconds per heart-rate zone during the session. Absent when no HR source
   *  was connected — never zero-filled, so "no watch" stays distinguishable
   *  from "no effort". */
  zones?: import('./hr').ZoneSeconds;
  kcal?: number;
  /** How long the whole session ran, in minutes, when the person told us.
   *
   *  Optional on purpose, and NEVER defaulted. A strength session records reps
   *  and weight but no clock, so its length is otherwise unknowable — and a
   *  nominal "45 min" would be a fabricated figure sitting in a health record.
   *  Where a heart-rate source or a cardio entry measured the time we use that
   *  instead and leave this alone (see `sessionDuration` in
   *  `wearables/appleHealthWrite.ts`); this field is the third source, the one
   *  the person types. That is testimony from whoever was there — the same
   *  standing as the reps and the RPE beside it — not a guess by the app.
   *
   *  Session-scoped, so every entry sharing a `t` carries the same number. */
  sessionMins?: number;
  /** The coach who recorded this on the client's behalf, when it was not the
   *  client. Absent means they logged it themselves. Attribution is not
   *  editable from either app — the database trigger refuses a change. */
  loggedBy?: string;
  /** When the client changed something their coach had logged. Absent means
   *  untouched since. Server-set: the trigger stamps it, the app only reads it,
   *  which is why it is not in PERSISTED_FIELDS. */
  amendedAt?: string;
}
