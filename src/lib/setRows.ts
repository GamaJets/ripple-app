/**
 * A LIST OF SET ROWS, where the app has only ever had one spec per exercise.
 *
 * Asked for with a screenshot of another app's routine editor, where an
 * exercise is not "3 × 10 at 42.5" but a table:
 *
 *     SET   KG     REPS
 *      1   42.5     10
 *      2   42.5     10
 *      3   45        8
 *
 * ── What could not be written down before ─────────────────────────────────
 *
 * `ProgramExercise` carries `sets: number`, `reps: string` and one `loadKg`,
 * so every set of a movement is the same set. A coach could not programme a
 * top set heavier than its back-offs, could not ramp, and — since `method`
 * arrived — could not say that set 1 is a warm-up and set 4 is a drop set,
 * which is the single most useful thing the method catalogue can express and
 * the one thing the per-exercise field cannot say twice.
 *
 * ── Why the old fields are still the truth for most exercises ─────────────
 *
 * `setRows` is OPTIONAL and everything below falls back to `sets`/`reps`/
 * `loadKg` when it is absent. That is not politeness about legacy data, it is
 * the only safe reading: programmes live in `program_templates` and on
 * assignments in the database AND in an on-device draft in AsyncStorage, and
 * there is no migration that can reach all three. An exercise with no
 * `setRows` must therefore render and run in a new build exactly as it does in
 * the old one, and nothing here writes the field onto an exercise the coach
 * has not edited — `addSetRow`, `removeSetRow` and `patchSetRow` are the only
 * three functions that produce one, and each is reached from a control the
 * coach taps.
 *
 * ── absent inherits, present answers ──────────────────────────────────────
 *
 * A row's fields are optional too, and the rule is the same one throughout:
 *
 *   · the key is ABSENT       → the row has not said, and the exercise's own
 *                               `reps`/`loadKg`/`method` is used
 *   · the key is PRESENT      → that is the row's answer, `null` included
 *
 * So `{ }` is a row that follows the exercise, `{ loadKg: null }` is a row
 * with nothing on the bar even though the exercise names a load, and
 * `{ method: null }` is an ordinary set inside an exercise whose default is a
 * drop set. `undefined` survives neither `JSON.stringify` nor a jsonb column,
 * which is exactly the behaviour wanted: absence is what round-trips.
 *
 * `reps` is the one exception, and only for a present-but-blank value. A set
 * of no reps is not a thing a coach can mean, so '' has nothing to say and
 * inherits like an absent key rather than rendering an empty column.
 *
 * ── Why `sets` is kept in step ────────────────────────────────────────────
 *
 * The three editing functions return `sets` alongside `setRows`, and callers
 * apply both. Every existing reader counts progress against `sets` —
 * `done.length >= ex.sets` in the runner, `sets.length/e.sets` on the plan
 * card, the first-open-exercise scan — and none of them knows this file
 * exists. A four-row exercise still carrying `sets: 3` would show a client
 * "3/3 sets" with a fourth row unlogged underneath it. The two numbers are one
 * fact, so they are written together or not at all.
 *
 * Nothing here converts a unit. Loads are kilograms, in and out, and the
 * render boundary is where `liftIn`/`volumeIn` turn them into what somebody
 * reads — see src/lib/units.ts.
 */
import { countsToVolume } from './setMethods';

/** One row of the table. See the header for what an absent key means. */
export type SetRow = {
  reps?: string | null;
  loadKg?: number | null;
  method?: string | null;
};

/**
 * The part of a `ProgramExercise` this file reads. Structural rather than the
 * interface itself, so the builder's own `BEx` — which carries a draft key, a
 * unit the coach typed in, and fields this file has no opinion about — can be
 * passed straight in without being converted first.
 */
export type SetSpec = {
  sets: number;
  reps: string;
  loadKg?: number | null;
  method?: string | null;
  setRows?: SetRow[] | null;
};

/** One set as it is DISPLAYED and RUN: every field resolved, nothing absent. */
export type PlannedSet = {
  /** 1-based, because it is the number in the SET column. */
  n: number;
  reps: string;
  loadKg: number | null;
  method: string | null;
  /**
   * Whether this came from a row the coach wrote, or from `sets` copies of the
   * one spec. The builder uses it to decide whether it is editing a table or
   * still showing the old single-spec fields.
   */
  fromRow: boolean;
};

const own = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k) && (o as Record<string, unknown>)[k] !== undefined;

/**
 * Whether this exercise carries a real table.
 *
 * An EMPTY array is not one. `setRows: []` would otherwise mean an exercise
 * with no sets at all — nothing to display, nothing to log against — and a
 * client opening their programme to a movement they cannot record is a worse
 * answer than the one the old fields already give. So an empty array falls
 * back like an absent one, and `removeSetRow` refuses to create it in the
 * first place.
 */
export function hasSetRows(ex: SetSpec): boolean {
  return Array.isArray(ex.setRows) && ex.setRows.length > 0;
}

/**
 * How many `sets` copies to make of the single spec.
 *
 * Floored and never negative. A non-finite `sets` — which no path in this app
 * writes, but a jsonb column can hold — is 0 rather than a loop that does not
 * end.
 */
function specCount(sets: number): number {
  if (!Number.isFinite(sets)) return 0;
  return Math.max(0, Math.floor(sets));
}

/**
 * The rows to put on screen: the coach's table when there is one, and
 * otherwise `sets` copies of the single spec, which is exactly what every
 * screen in the app draws today.
 */
export function expandSets(ex: SetSpec): PlannedSet[] {
  const exReps = ex.reps ?? '';
  const exLoad = ex.loadKg ?? null;
  const exMethod = ex.method ?? null;
  if (!hasSetRows(ex)) {
    return Array.from({ length: specCount(ex.sets) }, (_, i) => ({
      n: i + 1, reps: exReps, loadKg: exLoad, method: exMethod, fromRow: false,
    }));
  }
  return (ex.setRows as SetRow[]).map((r, i) => ({
    n: i + 1,
    // Present-but-blank inherits. See the header: '' has nothing to say.
    reps: own(r, 'reps') && String(r.reps ?? '').trim() ? String(r.reps) : exReps,
    loadKg: own(r, 'loadKg') ? (r.loadKg ?? null) : exLoad,
    method: own(r, 'method') ? (r.method ?? null) : exMethod,
    fromRow: true,
  }));
}

/** How many sets this exercise is, by the same rule `expandSets` uses. */
export function setCount(ex: SetSpec): number {
  return hasSetRows(ex) ? (ex.setRows as SetRow[]).length : specCount(ex.sets);
}

/**
 * The reps a rep string names, as a SPAN.
 *
 * "10" is ten. "6-8" is six to eight, and it stays two numbers rather than
 * being averaged into seven — seven is a figure nobody wrote, and a plan that
 * reads "between 255 and 340 kg" is telling the truth where "297.5 kg" is
 * telling a story. An en dash is accepted because coaches type one.
 *
 * Anything else is null, and null is a real answer: "45 sec" is an isometric
 * hold whose column is seconds, "AMRAP" is a set whose reps are not known in
 * advance, and multiplying either by a load would be arithmetic on something
 * that is not a rep count.
 */
export function readRepSpan(text: string | null | undefined): { low: number; high: number } | null {
  const s = String(text ?? '').trim();
  if (!s) return null;
  // Tested rather than captured: the capture group and the whole match were
  // the same string by construction, so one of them was a second name for the
  // other and a mutation run could swap them with nothing able to notice.
  if (/^\d+$/.test(s)) { const n = Number(s); return { low: n, high: n }; }
  const span = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(s);
  if (!span) return null;
  const a = Number(span[1]);
  const b = Number(span[2]);
  // Written backwards ("12-8") is still a span, and the ends are put in order
  // rather than refused: the coach meant a range and a screen that showed a
  // low above its high would look like the bug.
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

export type VolumeTally = {
  /** Σ reps × load over the rows that count, in KILOGRAMS, at the low end. */
  lowKg: number;
  /** The same sum at the high end. Equal to `lowKg` when no row is a range. */
  highKg: number;
  /** How many rows are in those two figures. */
  counted: number;
  /** Rows a METHOD kept out — a warm-up, a cool-down. Never silently dropped. */
  notVolume: number;
  /**
   * Rows that count but carry no arithmetic: a bodyweight set with no load, or
   * a reps column that is seconds or "AMRAP". They are named rather than
   * folded into the total as zero, because a session of eight bodyweight sets
   * is not a session of no work.
   */
  unfigured: number;
};

/** Money-free rounding: two decimal places, so 16.5 × 8 does not arrive as
 *  131.99999999999999 and make a test that is really about warm-ups fail. */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The planned working volume of an exercise.
 *
 * The METHOD decides what counts, never the name of the movement and never the
 * position of the row — `countsToVolume` in src/lib/setMethods.ts is asked, so
 * a warm-up and a cool-down are excluded and a method added to the catalogue
 * later cannot quietly start inflating this. That field exists precisely to
 * stop somebody's tonnage jumping on a day they did nothing different, and a
 * per-set table is the first thing in the app able to put a warm-up and a
 * working set inside one exercise.
 */
export function plannedVolume(ex: SetSpec): VolumeTally {
  const out: VolumeTally = { lowKg: 0, highKg: 0, counted: 0, notVolume: 0, unfigured: 0 };
  for (const s of expandSets(ex)) {
    if (!countsToVolume(s.method)) { out.notVolume += 1; continue; }
    const span = readRepSpan(s.reps);
    if (span == null || s.loadKg == null || !Number.isFinite(s.loadKg)) { out.unfigured += 1; continue; }
    out.lowKg += span.low * s.loadKg;
    out.highKg += span.high * s.loadKg;
    out.counted += 1;
  }
  out.lowKg = round2(out.lowKg);
  out.highKg = round2(out.highKg);
  return out;
}

/** What the three editing functions hand back. Applied together — see the
 *  header on why `sets` may never lag behind the rows. */
export type RowsPatch = { setRows: SetRow[]; sets: number };

/**
 * The table this exercise would have if it were edited — the coach's own rows,
 * or the single spec written out `sets` times.
 *
 * This is the ONE place the old shape becomes the new one, and it only ever
 * runs underneath a control the coach pressed.
 *
 * `reps` and `loadKg` are written out explicitly, `null` included, because they
 * are the COLUMNS the coach is about to type into and a figure they can see and
 * edit must not also be an inheritance that moves under them.
 *
 * `method` deliberately is NOT. It is the exercise's default rather than a
 * column, and materialising it would freeze that default into every row the
 * moment a set was added — so a coach who then changed the exercise from
 * ordinary to drop set would watch the control do nothing. Left absent, each
 * row goes on asking the exercise, and a row that wants to differ says so.
 */
function materialise(ex: SetSpec): SetRow[] {
  return expandSets(ex).map((s) => ({ reps: s.reps, loadKg: s.loadKg }));
}

/**
 * Add a set, at the end, copying the last one.
 *
 * A copy rather than a blank row: the reason a coach adds a fourth set is
 * almost never to leave it empty, and an empty row would inherit the exercise
 * spec — so on a ramp the new set would silently be the FIRST set's numbers,
 * which is the one thing a ramp says it is not.
 *
 * At the end, and only at the end. An "insert after row N" took an index this
 * screen never passed, and an unused index is a branch nothing can be wrong
 * about until the day something uses it — a mutation run proved no assertion
 * was watching it. There is one control and it appends.
 *
 * An exercise with no sets at all still gains one, taken from the exercise's
 * own spec because there is no row to copy.
 */
export function addSetRow(ex: SetSpec): RowsPatch {
  const rows = materialise(ex);
  const src: SetRow = rows[rows.length - 1] ?? { reps: ex.reps ?? '', loadKg: ex.loadKg ?? null };
  const next = [...rows, { ...src }];
  return { setRows: next, sets: next.length };
}

/**
 * Remove a set.
 *
 * The LAST row is not removable, and the control that calls this is hidden
 * rather than disabled where there is one row left. An exercise of zero sets is
 * not a lighter exercise, it is a movement in the plan that nothing can be
 * logged against — the coach means "remove the exercise", and there is already
 * a control for that.
 *
 * An index off either end removes nothing, which needs no guard of its own:
 * `filter` matches no row and hands back the table it was given. A bounds check
 * here read as care and was code that could not be wrong, which a mutation run
 * showed by deleting half of it without a single assertion noticing.
 */
export function removeSetRow(ex: SetSpec, at: number): RowsPatch {
  const rows = materialise(ex);
  if (rows.length <= 1) return { setRows: rows, sets: rows.length };
  const next = rows.filter((_, i) => i !== at);
  return { setRows: next, sets: next.length };
}

/**
 * Change one row. The patch's keys replace the row's; a key it does not carry
 * is left alone, so setting a method does not wipe a load typed a second
 * earlier. An index off either end changes nothing, for the reason above.
 */
export function patchSetRow(ex: SetSpec, at: number, patch: SetRow): RowsPatch {
  const rows = materialise(ex);
  const next = rows.map((r, i) => (i === at ? { ...r, ...patch } : r));
  return { setRows: next, sets: next.length };
}
