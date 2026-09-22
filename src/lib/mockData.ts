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
  /** The tempo each of those sets was PERFORMED at, aligned to `sets` the same
   *  way, in the order a prescribed tempo is written in — eccentric · pause at
   *  the bottom · concentric · pause at the top, with `X` in the concentric
   *  slot for "as fast as you can".
   *
   *  This is the other half of a prescription that has only ever had one.
   *  src/lib/setIntensity.ts has read, named and spelled out a tempo since it
   *  was written, and nothing in the app could record one — so a coach could
   *  ask for a four-second eccentric and the log could not say whether they got
   *  it.
   *
   *  Null AT AN INDEX is not a tempo of zero and not a prescription met: it is
   *  a set nobody was asked about, which is the ordinary case, because the
   *  member is only asked where a tempo was prescribed. Absent ENTIRELY is the
   *  same answer for the whole entry. Read it through `recordedTempo` in
   *  src/lib/performedTempo.ts, which is also what stops a short array sliding
   *  one set's tempo onto another. */
  tempos?: (string | null)[];
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
  /** The booked PT session this training was logged against, when it was
   *  logged against one. Absent is the ordinary case — a client's own workout,
   *  a coach's own training, or an hour written up from a client's record
   *  rather than from the session (supabase/parts/890).
   *
   *  Read-only here, like `amendedAt` and for a related reason: it is a fact
   *  about the WRITE that made the row, so it is not in `PERSISTED_FIELDS` and
   *  `entryToRow` does not send it. src/ui/floorQueue.ts puts it on the insert.
   *  src/lib/loggedSession.ts is what reads it back. */
  sessionId?: string;
  /** When a coach-logged set was changed after it was filed. Absent means
   *  untouched since. Server-set: the trigger stamps it, the app only reads it,
   *  which is why it is not in PERSISTED_FIELDS. */
  amendedAt?: string;
  /** WHO made that change: the member it is about, or the coach who logged it
   *  (supabase/parts/3230). Server-set with `amendedAt` and read-only for the
   *  same reason. Absent on a change stamped before the column existed, which
   *  is why a caption must still be able to say "changed" without a name. */
  amendedBy?: string;
}
