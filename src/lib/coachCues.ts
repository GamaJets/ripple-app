// A coach's own cue for a movement, written ONCE and carried everywhere.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// A coach says the same sentence about the same lift to every client they
// train: "brace before you unrack, chin tucked". Until now the only place in
// Repple to put it was `ProgramExercise.note` — the per-exercise note INSIDE
// one program day, on one client's week. So it was retyped on every
// assignment, and it drifted: the same coach's front squat carried three
// different cues across three clients, and nothing anywhere could tell which
// of the three was the one they meant.
//
// A cue is a fact about the MOVEMENT and the coach. The program note is a
// fact about THIS client on THIS day. Two different things, so two different
// places to keep them — supabase/parts/3150 holds the first, and the second
// stays exactly where it was.
//
// ── THE RULE: a cue PREFILLS a note. It never overwrites one. ─────────────
//
// This is the whole of the danger in the feature and it is stated first.
//
// A cue is a DEFAULT. The program note is the INSTANCE. A coach who wrote
// "go easy, right shoulder still sore" against Sara's overhead press wrote
// that about Sara, on purpose, and a cue arriving later must not replace it —
// that is not a prefill, it is an erasure of something a human typed about a
// particular person, performed silently, with no undo and no record that it
// ever said anything else. This codebase's standing rule is that a correction
// is a second recorded fact and never an erasure; a cue quietly eating a note
// is not even a correction.
//
// So `prefillNote` below has exactly one shape and every caller goes through
// it:
//
//     a note with any non-whitespace in it       is returned UNCHANGED, by
//                                                identity, for ever.
//     an empty, blank or absent note             takes the cue.
//
// It is idempotent, it never returns '' (an empty string stored as a note
// draws an empty bubble under the movement in the client's app — see
// `ProgramExercise.note` in src/lib/programs.ts), and it is deliberately NOT
// written as `existing || cue`: '0' is a note somebody typed, and `||` would
// throw it away. Null is not zero, and neither is a short answer.
//
// ── Reading this BEFORE the part is applied ──────────────────────────────
//
// supabase/parts/3150 is not applied to any database as this ships. A select
// naming a table PostgREST does not know about comes back as an error, and a
// screen that treated that as "no cues" would be claiming something about the
// coach from the absence of a table. Worse, a screen that let the error
// through takes the builder down — which is a coach unable to write a
// program because of a feature they have never used.
//
// So the read has THREE outcomes and collapsing any two of them is a defect:
//
//   'read'    the table answered. An empty `cues` under this status genuinely
//             means this coach has written none.
//   'absent'  the part has not been applied. No cue CAN exist, so no note is
//             prefilled and no cue editor is offered — but this is a different
//             fact from the one above and the screens say so rather than
//             drawing a control that would fail under the thumb.
//   throws    anything else. A read that timed out is not a coach with no
//             cues. The house rule is that a failed read is not an empty list.
//
// ── Which error code means 'absent', and why it is TWO of them ───────────
//
// Measured against this project's live PostgREST on 13 September 2026, with
// the publishable key, asking for a table that does not exist:
//
//     GET /rest/v1/coach_exercise_cues?select=cue&limit=1
//     {"code":"PGRST205", … "message":"Could not find the table
//      'public.coach_exercise_cues' in the schema cache"}
//
// PGRST205, not 42P01. PostgREST answers from its schema cache and never
// reaches Postgres at all, so the Postgres code for an undefined relation is
// never produced. Both are accepted here because both are reachable — 42P01
// arrives when the cache is warm and the table is dropped underneath it, which
// is the window during a rollback — and because src/lib/gymSigning.ts accepts
// only 42P01 for exactly this situation and would therefore THROW on this
// deployment rather than degrade. That is a defect in that file, not a reason
// to copy it.
//
// And ONLY those two. A 401, a 403, a 500 or a dropped connection is not a
// database without the feature.

/** The supabase client, or anything shaped like it. Kept structural so this
 *  module can be compiled and run under plain node by its test. */
type Queryable = { from: (table: string) => any };

/** Postgres, on a relation that does not exist. */
const UNDEFINED_TABLE = '42P01';
/** PostgREST, on a table absent from its schema cache. What this deployment
 *  actually returns — see the header. */
const UNKNOWN_TABLE = 'PGRST205';

/**
 * One cue: this coach's standing sentence about one movement.
 *
 * `exerciseId` is the catalogue id — `exerciseSlug(name)`, which is what
 * `exercises.id` holds and what every other movement-keyed thing in this app
 * is filed under. The cue is keyed on the MOVEMENT, not on the name a coach
 * happened to type, so "Back Squat" and "back squat" are one cue and not two.
 */
export interface CoachCue {
  exerciseId: string;
  cue: string;
  /** When it was last written, as the server recorded it. Null where the
   *  column could not be read, which is not the same as never written. */
  updatedAt: string | null;
}

/**
 * The answer to "what cues does this coach have", and the state of every
 * database part 3150 has not reached.
 *
 * See the header for why 'absent' is its own answer and not an empty list.
 */
export type CueRead =
  | { status: 'read'; cues: CoachCue[] }
  | { status: 'absent' };

/**
 * The default every caller starts from, and the honest state of a database
 * without the part. Named rather than inlined so a call site reads as the
 * claim it is making.
 */
export const NO_CUE_TABLE: CueRead = { status: 'absent' };

/** The longest a cue may be. Mirrored by the CHECK in supabase/parts/3150 —
 *  a coach typing past it is refused here with a sentence rather than by the
 *  database with a 23514. */
export const CUE_MAX = 500;

/* ── the identity of a movement ───────────────────────────────────────────── */

/**
 * The catalogue id for a movement name.
 *
 * Deliberately a local copy of the rule in src/lib/exerciseId.ts rather than an
 * import: this module is compiled and run by `node` under tsconfig.test.json,
 * and it is the ONE thing here that must agree with the rest of the app
 * exactly. `cueKeyMatchesSlug` in the test asserts character-for-character
 * agreement against that file's source, so a change there that this missed is
 * a failing test rather than a cue that silently stops matching its movement.
 */
export function cueKey(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ /g, '-');
}

/* ── reading a cue out of what came back ──────────────────────────────────── */

/**
 * This coach's cue for one movement, or null.
 *
 * Null under 'absent' as well as under "they have not written one", because
 * both mean there is nothing to offer — but the CALLER must not turn either
 * null into a sentence claiming the coach wrote nothing. `cueAvailability`
 * below is what a screen says out loud.
 */
export function cueFor(read: CueRead, name: string): string | null {
  if (read.status !== 'read') return null;
  const key = cueKey(name);
  if (!key) return null;
  const hit = read.cues.find((c) => c.exerciseId === key);
  return hit ? hit.cue : null;
}

/** The whole row, where a screen needs the date as well as the words. */
export function cueRowFor(read: CueRead, name: string): CoachCue | null {
  if (read.status !== 'read') return null;
  const key = cueKey(name);
  if (!key) return null;
  return read.cues.find((c) => c.exerciseId === key) ?? null;
}

/* ── THE RULE ─────────────────────────────────────────────────────────────── */

/**
 * The note to store, given the note that is there and the cue that could fill
 * it. THE one function. Every prefill in the product goes through this.
 *
 * ── What it does, in the order it is asked ────────────────────────────────
 *
 *   1. A note with any non-whitespace character in it is returned UNCHANGED —
 *      the same string, by identity, not a trimmed or normalised copy. A coach
 *      who indented their note, or ended it with a line break, wrote that too.
 *      This branch is first, before the cue is even looked at, because the
 *      cheapest way to guarantee a written note is never lost is for the code
 *      that could lose it never to run.
 *   2. An empty, whitespace-only or absent note takes the cue, trimmed.
 *   3. With no cue — or a cue that is itself blank — the answer is `undefined`
 *      and never ''. `ProgramExercise.note` says so in as many words: an empty
 *      string stored as a note renders an empty bubble under the movement in
 *      the client's app.
 *
 * ── What it is NOT ───────────────────────────────────────────────────────
 *
 * It is not `existing || cue`, and the difference is not stylistic. A note of
 * '0' — which is a whole sentence in a gym, "0 warm-up sets" — is falsy, and
 * `||` would replace it with the cue. Null is not zero; nor is '0' nothing.
 *
 * It is not `cue ?? existing` in either order with the operands swapped by
 * somebody tidying up. The asymmetry is the point.
 */
export function prefillNote(
  existing: string | null | undefined,
  cue: string | null | undefined,
): string | undefined {
  // (1) Anything a human typed wins, for ever, untouched.
  if (typeof existing === 'string' && existing.trim() !== '') return existing;
  // (2) and (3).
  const c = typeof cue === 'string' ? cue.trim() : '';
  return c === '' ? undefined : c;
}

/** Whether `prefillNote` would change this note. The control that offers a
 *  prefill is drawn from this, so a note already written never gets a button
 *  whose whole meaning is "replace what you wrote". */
export function wouldPrefill(
  existing: string | null | undefined,
  cue: string | null | undefined,
): boolean {
  // Written as "the note is blank AND there is a cue" rather than as a
  // comparison against `prefillNote`'s output, because the two must not be
  // able to disagree about the FIRST branch — a control drawn from a
  // comparison that happened to come out true over a written note is the exact
  // button this module exists to never draw.
  const blank = !(typeof existing === 'string' && existing.trim() !== '');
  const haveCue = typeof cue === 'string' && cue.trim() !== '';
  return blank && haveCue;
}

/** One exercise, with its note prefilled if and only if it has none.
 *
 *  Generic over the row rather than typed to `ProgramExercise`, because the
 *  builder's own draft row (`BEx`) carries a `key` the stored shape does not,
 *  and a function that took one and returned the other would drop it. The
 *  object is returned BY IDENTITY when nothing changes, so a `map` over a day
 *  that needed no prefill does not churn every row's reference. */
export function prefillExercise<T extends { name: string; note?: string }>(
  e: T,
  read: CueRead,
): T {
  const next = prefillNote(e.note, cueFor(read, e.name));
  if (next === e.note) return e;
  // An exercise whose note is undefined and stays undefined is untouched
  // above; reaching here means a blank note is being filled.
  return { ...e, note: next };
}

/** Every exercise of every day, same rule, same identity-preserving shape.
 *
 *  Safe to run more than once — `prefillNote` is idempotent, so a second pass
 *  over an already-prefilled week changes nothing. It is still only CALLED
 *  where exercises enter the builder (a movement added, a plan or template
 *  loaded) and never on render: a coach who deliberately CLEARS a note has
 *  cleared it, and a prefill running under their cursor would put it back. */
export function prefillDays<E extends { name: string; note?: string }, D extends { exercises: E[] }>(
  days: D[],
  read: CueRead,
): D[] {
  if (read.status !== 'read' || read.cues.length === 0) return days;
  let dayChanged = false;
  const out = days.map((d) => {
    let exChanged = false;
    const exercises = d.exercises.map((e) => {
      const n = prefillExercise(e, read);
      if (n !== e) exChanged = true;
      return n;
    });
    if (!exChanged) return d;
    dayChanged = true;
    return { ...d, exercises };
  });
  return dayChanged ? out : days;
}

/* ── writing one ──────────────────────────────────────────────────────────── */

/**
 * What a coach typed, checked before it is sent, or the sentence saying why
 * it cannot be.
 *
 * A cue is refused rather than silently normalised into nothing: somebody who
 * tapped Save on an empty box meant to do something, and "saved" over an empty
 * field would be this product claiming a cue exists where none does. Clearing
 * a cue is `deleteCue`, which is a different act with a different button.
 */
export function cueRefusal(draft: string, name: string): string | null {
  if (!cueKey(name)) {
    return 'This movement has no name to file a cue under, so there is nothing to attach it to.';
  }
  const c = (draft || '').trim();
  if (c === '') {
    return 'Type the cue first. Saving an empty box would not clear your cue — use Remove for that.';
  }
  if (c.length > CUE_MAX) {
    return `That is ${c.length} characters and a cue holds ${CUE_MAX}. A cue is the one sentence you say every time; the longer version belongs in the note for the client it is about.`;
  }
  return null;
}

/* ── the sentences ────────────────────────────────────────────────────────── */

/**
 * What the builder says where the part is not applied.
 *
 * Never "you have no cues", which would be a claim about this coach made from
 * the absence of a table.
 */
export const CUES_UNAVAILABLE_NOTE =
  'Saved cues are not switched on for this app yet, so there is nothing to prefill from. This is not a record that you have written none — keep typing notes here as you always have, and they are unaffected.';

/** What it says under a movement the coach has no cue for yet. True only when
 *  the read succeeded, which is why it is separate from the sentence above. */
export const NO_CUE_YET_NOTE =
  'No saved cue for this movement yet. Save one and it fills this box on every client you add it to from then on.';

/** The promise the coach is owed, said where they can see it before they tap.
 *  It is the rule this module exists to keep. */
export const CUE_NEVER_OVERWRITES =
  'A saved cue only ever fills an EMPTY note. Notes you have already written — here or on any other client — are never changed by it.';

/** The a11y hint on the control that fills an empty box from the cue. */
export const USE_CUE_HINT = 'Copies your saved cue into this note. Only available while the note is empty.';

/**
 * Why there is nothing to offer, or null when there is.
 *
 * The screen asks this rather than comparing statuses itself, so the
 * distinction between "not deployed" and "none written" cannot be lost at a
 * call site.
 */
export function cueAvailability(read: CueRead, name: string): string | null {
  if (read.status !== 'read') return CUES_UNAVAILABLE_NOTE;
  if (cueFor(read, name) === null) return NO_CUE_YET_NOTE;
  return null;
}

/* ── the reads and the write ──────────────────────────────────────────────── */

/**
 * Narrow an error to "this database has no such table".
 *
 * Exported because it is the load-bearing half of the tolerance and the test
 * asserts it directly: a 403 must never be read as a missing table, or a coach
 * whose grant is wrong is told the feature is off.
 */
export function isMissingCueTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === UNDEFINED_TABLE || code === UNKNOWN_TABLE;
}

/** Row → cue, refusing anything that is not one. A row with a blank cue is
 *  dropped rather than carried as '': it would prefill nothing and would make
 *  `cueFor` answer with a string that means "no cue". */
function rowToCue(r: any): CoachCue | null {
  const id = typeof r?.exercise_id === 'string' ? r.exercise_id.trim() : '';
  const cue = typeof r?.cue === 'string' ? r.cue.trim() : '';
  if (id === '' || cue === '') return null;
  return { exerciseId: id, cue, updatedAt: typeof r?.updated_at === 'string' ? r.updated_at : null };
}

/**
 * Every cue this coach has written.
 *
 * No coach id is sent, for the same reason `fetchMyRevocations` sends no member
 * id: the policy is `coach_id = auth.uid()`, so the session decides whose these
 * are and there is no argument through which one coach could ask for another's.
 *
 * `limit` is deliberately absent from the caller's control and the cap is the
 * catalogue's size, not a page: a coach with more cues than movements is not a
 * thing that exists, and a truncated cue list would mean a movement silently
 * losing its cue with no error anywhere.
 */
export async function fetchMyCues(sb: Queryable, cap = 2000): Promise<CueRead> {
  const { data, error } = await sb
    .from('coach_exercise_cues')
    .select('exercise_id, cue, updated_at')
    .limit(cap + 1);
  if (error) {
    if (isMissingCueTable(error)) return NO_CUE_TABLE;
    throw error;
  }
  const rows: any[] = data ?? [];
  if (rows.length > cap) {
    // Not silently sliced. A prefix here is a coach whose cue for some
    // movement is missing with nothing to show for it.
    throw new Error(`your saved cues came back at the ${cap}-row ceiling, so this is not all of them`);
  }
  const cues: CoachCue[] = [];
  for (const r of rows) {
    const c = rowToCue(r);
    if (c) cues.push(c);
  }
  return { status: 'read', cues };
}

/**
 * The cue a CLIENT sees under a movement: their own coach's, and nobody's
 * else.
 *
 * No coach id is sent here either, and that is the security property rather
 * than a convenience. The select policy in part 3150 admits exactly the rows
 * whose `coach_id` is the trainer of the signed-in client, so there is no
 * argument this function could carry that would widen it — a client cannot ask
 * for a stranger's cues by passing a different uuid, because it passes none.
 *
 * Filtered to the one movement on the server rather than read whole and
 * searched here: a client's exercise screen wants one sentence, and shipping
 * a coach's entire cue book to every member's phone to find it is a different
 * thing from what was asked for.
 */
export async function fetchCoachCue(sb: Queryable, name: string): Promise<CueRead> {
  const key = cueKey(name);
  // A movement with no name has no id to file under. 'read' with none is the
  // honest answer: nothing was refused and nothing is missing.
  if (!key) return { status: 'read', cues: [] };
  const { data, error } = await sb
    .from('coach_exercise_cues')
    .select('exercise_id, cue, updated_at')
    .eq('exercise_id', key)
    .limit(2);
  if (error) {
    if (isMissingCueTable(error)) return NO_CUE_TABLE;
    throw error;
  }
  const cues: CoachCue[] = [];
  for (const r of (data ?? []) as any[]) {
    const c = rowToCue(r);
    if (c) cues.push(c);
  }
  return { status: 'read', cues };
}

/**
 * Save this coach's cue for a movement.
 *
 * An upsert on (coach_id, exercise_id), which is the primary key: a cue is one
 * per coach per movement by definition, and re-saving is the coach changing
 * their mind about their own default. That is NOT the erasure this module is
 * careful about — no client's note is touched by it, and every note already
 * written stays exactly as written, because a prefill already happened once and
 * a prefill never runs again over a filled box.
 *
 * `coach_id` is NOT sent. It defaults to auth.uid() in the database, so no
 * caller can write a cue into somebody else's book; the WITH CHECK would refuse
 * it anyway, and sending nothing means there is no field to get wrong.
 *
 * The error is RETURNED and not swallowed. A write whose success is inferred
 * from the absence of a thrown exception is the defect scripts/check-writes.mjs
 * exists for: supabase-js resolves on a refusal.
 */
export async function saveCue(
  sb: Queryable,
  name: string,
  draft: string,
): Promise<{ ok: true; cue: CoachCue } | { ok: false; said: string }> {
  const refusal = cueRefusal(draft, name);
  if (refusal) return { ok: false, said: refusal };
  const key = cueKey(name);
  const cue = draft.trim();
  const { data, error } = await sb
    .from('coach_exercise_cues')
    .upsert({ exercise_id: key, cue }, { onConflict: 'coach_id,exercise_id' })
    .select('exercise_id, cue, updated_at');
  if (error) {
    if (isMissingCueTable(error)) {
      return { ok: false, said: CUES_UNAVAILABLE_NOTE };
    }
    return { ok: false, said: `That cue was not saved — ${error.message || 'the write was refused'}.` };
  }
  // Counted, not assumed. An upsert refused by RLS resolves with no error and
  // no rows on some paths; a zero-row answer is a write that did not happen.
  const rows = (data ?? []) as any[];
  const saved = rows.length ? rowToCue(rows[0]) : null;
  if (!saved) {
    return { ok: false, said: 'That cue was not saved — the write came back with no row, so nothing was stored.' };
  }
  return { ok: true, cue: saved };
}

/**
 * Remove this coach's cue for a movement.
 *
 * Deleting a cue is NOT an erasure of anything a client can see. Every note
 * already prefilled from it is a note in a program, stored on its own row,
 * and it stays — which is the correct behaviour and worth saying: a coach who
 * changes their standing cue is not retracting what they told forty people
 * last month, and a delete that reached into those weeks would be rewriting
 * coaching that has already happened.
 */
export async function deleteCue(
  sb: Queryable,
  name: string,
): Promise<{ ok: true } | { ok: false; said: string }> {
  const key = cueKey(name);
  if (!key) return { ok: false, said: 'This movement has no name to look a cue up by.' };
  const { data, error } = await sb
    .from('coach_exercise_cues')
    .delete()
    .eq('exercise_id', key)
    .select('exercise_id');
  if (error) {
    if (isMissingCueTable(error)) return { ok: false, said: CUES_UNAVAILABLE_NOTE };
    return { ok: false, said: `That cue was not removed — ${error.message || 'the delete was refused'}.` };
  }
  if (!((data ?? []) as any[]).length) {
    return { ok: false, said: 'That cue was not removed — nothing came back, so it may still be there.' };
  }
  return { ok: true };
}
