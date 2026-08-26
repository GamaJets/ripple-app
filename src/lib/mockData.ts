// Shapes for the no-backend repo (`mockRepo`), used when the app runs standalone
// in Expo Go before Supabase is wired.
//
// The *data* here is empty. These constants previously carried a full fake
// client — a 6-point weight/body-fat history, two InBody scans, five logged
// workouts, a coach/client message thread, and a trainer named "Coach Daniel
// Reyes" — and although `mockRepo` is not used when USE_SUPABASE is on, the
// literals still shipped inside the production Hermes bundle, and this exact
// workout log is the seed that ended up written into real users' Supabase rows.
// Types stay; invented people and numbers do not.
import type { Goal, Diet, Sex, TrainingSession, Scan, Message, FoodEntry } from './types';

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
}

export const MOCK_CLIENT: MockClient = {
  id: 'c1',
  name: '',
  sex: 'f',
  dob: '',
  heightCm: 0,
  goal: 'fatloss',
  diet: 'meat',
  activity: 1.45,
  mealsPerDay: 3,
  weight: [],
  bodyFat: [],
  muscle: [],
  scans: [],
  log: [],
};

export const MOCK_MESSAGES: Message[] = [];

export const MOCK_FOOD: FoodEntry[] = [];

export const MOCK_TRAINER = {
  id: 't1',
  name: '',
  sessionFee: 0,
  clients: [] as { id: string; name: string; goal: Goal; weightDelta: number }[],
};

export const MOCK_SESSIONS: TrainingSession[] = [];
