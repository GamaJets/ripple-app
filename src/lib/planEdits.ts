// The changes a member makes to their own plan, and where they live.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// Four pieces of state on app/(client)/workouts.tsx — `swaps`, `exEdits`,
// `customEx` and `removedEx` — were plain `useState`. They are, between them,
// every change a member can make to the programme they were given: swap a lift
// for one the gym actually has, correct the load the coach guessed, take out a
// movement their shoulder will not do, add the one they did instead.
//
// The screen persisted exactly two things, and neither was any of those: the
// guided-session draft (`repple.guidedSession`) and the per-day set draft
// (`repple.workoutDraft.<date>`). So a swap made on Tuesday was gone on
// Wednesday, and a load corrected at the rack was gone the moment the app was
// killed. The member did the work of fixing their programme once a week, for
// ever, and nobody ever saw it.
//
// The second half is worse than the first. None of it reached the coach. A
// coach writing Bench Press for somebody whose gym has no bench sees a
// programme being followed; the member sees a lift they substitute every single
// session. Neither of them can see the other, and the thing that would settle
// it — "they have swapped this four weeks running" — was being typed into a
// React state and thrown away.
//
// ── Why one blob and not a row per change ──────────────────────────────────
//
// Because the four are ONE answer to one question: what does this member's plan
// actually look like when they train. They are read together, written together
// and shown together, and a schema that spreads them over four tables invites
// three of them to arrive and one not to — which is the same partial state this
// file exists to remove.
//
// ── The keys ───────────────────────────────────────────────────────────────
//
// `swaps`, `exEdits` and `removed` are keyed `dayIdx:exerciseKey`, which is the
// screen's own `uid()` and identifies one row on one WEEKDAY rather than a
// movement in general. That is deliberate and it survives the week strip: a
// member who swaps Monday's bench has swapped Monday's bench, this week and
// next, because that is the row the coach wrote. `custom` is not keyed at all —
// it is a flat list, exactly as the screen has always held it.
//
// Nothing here trims, migrates or reconciles against the programme. A key that
// no longer matches any exercise is left alone: the coach may put that movement
// back next week, and a member's correction is not the app's to discard.
import type { ProgramExercise } from './programs';
import type { SetRow } from './setRows';

/** Where the edits live on the device. One key for all four, for the reason
 *  above: they are one answer and must not half-arrive. */
export const PLAN_EDITS_KEY = 'repple.planEdits';

/** What a member has changed about their own plan. */
export interface PlanEdits {
  /** `dayIdx:key` → the movement they do instead. */
  swaps: Record<string, string>;
  /**
   * `dayIdx:key` → the sets, reps or load they set themselves.
   *
   * `setRows` is a TABLE — a row per set, each with its own reps and its own
   * load — and it is what a member writing 60 / 65 / 65 into their own plan
   * produces. It was added after the other three and obeys the same rule they
   * do: a key that is ABSENT is a member who has not said, so every correction
   * ever written before it round-trips through here and through AsyncStorage
   * exactly as it did.
   *
   * The other three are kept alongside it rather than replaced by it, and that
   * is not redundancy. `sets` must equal the number of rows — src/lib/setRows.ts
   * sets out at length why those two numbers are one fact — and `reps`/`loadKg`
   * are the exercise's own fallback, which is what every reader that has never
   * heard of a table still reads.
   */
  exEdits: Record<string, {
    sets?: number; reps?: string; loadKg?: number | null; setRows?: SetRow[] | null;
  }>;
  /** `dayIdx:key` for every movement they have taken off that day. */
  removed: string[];
  /** Movements they added that the programme does not contain. */
  custom: ProgramExercise[];
}

export const EMPTY_PLAN_EDITS: PlanEdits = { swaps: {}, exEdits: {}, removed: [], custom: [] };

/** True when the member has changed nothing. Used to decide whether there is
 *  anything to say — and never to decide whether the read worked, which is a
 *  different question with a different answer below. */
export function isEmptyEdits(e: PlanEdits): boolean {
  return !Object.keys(e.swaps).length && !Object.keys(e.exEdits).length
    && !e.removed.length && !e.custom.length;
}

/** How many separate changes there are, for a sentence that has to count them.
 *  A movement both swapped and re-loaded is two changes, because it is: the
 *  coach has two things to look at. */
export function editCount(e: PlanEdits): number {
  return Object.keys(e.swaps).length + Object.keys(e.exEdits).length + e.removed.length + e.custom.length;
}

/** Changes belonging to one weekday, so a screen showing Tuesday can say what
 *  has been changed about Tuesday rather than about the week. */
export function editsForDay(e: PlanEdits, dayIdx: number): number {
  const mine = (k: string) => k.indexOf(`${dayIdx}:`) === 0;
  return Object.keys(e.swaps).filter(mine).length
    + Object.keys(e.exEdits).filter(mine).length
    + e.removed.filter(mine).length;
}

const obj = (v: unknown): Record<string, any> =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? (v as Record<string, any>) : {};

/**
 * Read a stored blob, and say whether it was actually read.
 *
 * The pair is the whole point, and it is the same distinction
 * src/lib/workoutQueue.ts draws for the offline queue: `null` from AsyncStorage
 * is a real answer — this member has never changed anything — and bytes that
 * will not parse are NOT. Collapsing the two would have the next write
 * serialise an empty object over a member's whole set of corrections because
 * one JSON parse failed once.
 *
 * `read: false` means the caller must not write. Nothing here enforces that;
 * it cannot. The latch lives with whoever owns the storage.
 */
export function readPlanEdits(raw: string | null | undefined): { edits: PlanEdits; read: boolean } {
  if (raw == null) return { edits: EMPTY_PLAN_EDITS, read: true };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { edits: EMPTY_PLAN_EDITS, read: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { edits: EMPTY_PLAN_EDITS, read: false };
  }
  const p = parsed as Record<string, unknown>;
  const swaps: PlanEdits['swaps'] = {};
  for (const [k, v] of Object.entries(obj(p.swaps))) if (typeof v === 'string' && v) swaps[k] = v;
  const exEdits: PlanEdits['exEdits'] = {};
  for (const [k, v] of Object.entries(obj(p.exEdits))) {
    if (!v || typeof v !== 'object') continue;
    const row: PlanEdits['exEdits'][string] = {};
    // Each key only if it is PRESENT, because absent and null mean different
    // things here exactly as they do in src/lib/setRows.ts: no `loadKg` key is
    // "the member has not said", and `loadKg: null` is "the member says there
    // is nothing on it".
    if (typeof v.sets === 'number' && Number.isFinite(v.sets)) row.sets = v.sets;
    if (typeof v.reps === 'string') row.reps = v.reps;
    if ('loadKg' in v) row.loadKg = (typeof v.loadKg === 'number' && Number.isFinite(v.loadKg)) ? v.loadKg : null;
    // The table. Read row by row rather than trusted wholesale, because this
    // blob also arrives from the SERVER and a jsonb column will hold anything.
    // An empty array is dropped for the same reason src/lib/setRows.ts refuses
    // to create one: `setRows: []` is a movement with no sets to log against,
    // which is a worse answer than the old fields already give.
    if (Array.isArray(v.setRows)) {
      const table: SetRow[] = (v.setRows as unknown[])
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
        .map((x) => {
          const r: SetRow = {};
          if (typeof x.reps === 'string') r.reps = x.reps;
          // Present-with-a-null is a real answer here — "nothing on the bar" —
          // and is not the same as the key being absent, which is "this row
          // follows the exercise". Both survive JSON; that is the whole reason
          // the shape is what it is.
          if ('loadKg' in x) r.loadKg = (typeof x.loadKg === 'number' && Number.isFinite(x.loadKg)) ? x.loadKg : null;
          return r;
        });
      if (table.length) row.setRows = table;
    }
    if (Object.keys(row).length) exEdits[k] = row;
  }
  const removed = Array.isArray(p.removed) ? p.removed.filter((x): x is string => typeof x === 'string' && !!x) : [];
  const custom = Array.isArray(p.custom)
    ? (p.custom as unknown[]).filter((x): x is ProgramExercise =>
      !!x && typeof x === 'object'
      && typeof (x as ProgramExercise).key === 'string'
      && typeof (x as ProgramExercise).name === 'string')
    : [];
  return { edits: { swaps, exEdits, removed, custom }, read: true };
}

/** What goes on the device and into the row. One serialiser, so the cache and
 *  the database cannot grow two opinions about the shape. */
export function writePlanEdits(e: PlanEdits): string {
  return JSON.stringify({ swaps: e.swaps, exEdits: e.exEdits, removed: e.removed, custom: e.custom });
}

/**
 * What to tell the member about where their changes are.
 *
 * Three states and three sentences, and the middle one is the one that has to
 * exist: changes kept on the phone but not yet seen by the coach are not lost
 * AND are not shared, and every version of this screen that collapsed those two
 * either frightened somebody or misled them.
 *
 * Null when there is nothing changed, because "0 changes are saved" is not a
 * sentence.
 */
export function planEditsNote(e: PlanEdits, shared: boolean | null): string | null {
  const n = editCount(e);
  if (n <= 0) return null;
  const what = `${n} change${n === 1 ? '' : 's'} to your plan`;
  if (shared === true) return `${what} saved, and your coach can see ${n === 1 ? 'it' : 'them'}.`;
  if (shared === false) return `${what} saved on this phone. ${n === 1 ? 'It has' : 'They have'} not reached your coach yet, and ${n === 1 ? 'it goes' : 'they go'} up on their own next time you have signal.`;
  return `${what} saved on this phone.`;
}
