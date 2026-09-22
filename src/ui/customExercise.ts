// A movement a coach types that the catalogue has never heard of.
//
// ── Why it becomes a catalogue row ────────────────────────────────────────
//
// Asked for directly: when a coach saves an exercise the catalogue does not
// list, it should go into the library. Until now a typed name stayed a string
// on one workout row — so the same movement logged twice was two unrelated
// records, it never gained an illustration, it never appeared in a search, and
// a coach's own progression existed only inside whichever session they wrote
// it in. `exercises_staff_w` has always permitted a trainer to write the
// catalogue; nothing ever did.
//
// The id is exerciseSlug(name), the one identity rule (src/lib/exerciseId.ts),
// so a coach-minted row and every later reference to that name resolve to the
// same thing — which is the entire point of writing it down.
//
// ── Why it is marked, and why that matters ───────────────────────────────
//
// `source: 'coach'` rather than 'repdb'. A row like this has a name and
// perhaps a muscle group and NOTHING else — no description, no instructions,
// no illustration, no muscle data. Filing it as though it were a curated
// catalogue entry would make the library's own claims untrue: the attribution
// check credits RepDB for what RepDB wrote, and "illustrated" has to keep
// meaning illustrated. A screen can tell the two apart and say which it is.
//
// ── Why a failure is not raised at the caller ────────────────────────────
//
// This runs alongside a write the coach actually asked for — logging a set,
// adding an exercise to a program. That write is the thing that must
// succeed. If the catalogue insert is refused (offline, a policy, a race with
// another coach minting the same name) the log still stands and the movement
// is still a string, which is exactly where it was before. So this reports and
// resolves false rather than throwing into somebody's save.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { exerciseSlug } from '../lib/exerciseId';
import { reportError } from '../lib/reportError';

/** What a coach-authored catalogue row is marked as. */
export const COACH_SOURCE = 'coach';

/**
 * Put `name` in the catalogue if it is not there already.
 *
 * Returns the slug it resolves to whether or not anything was written — the
 * caller wants the identity, and an existing row is a success, not a clash.
 *
 * ── why `group` is required, and required in the TYPE ─────────────────────
 *
 * It was `opts: { group?: string | null } = {}`, so the two live callers
 * omitted it and four rows went into a 615-row catalogue with `muscle_group`
 * null and no muscle data either. Those four then flowed into an assigned
 * program and two templates as exercises with a blank `group` — and
 * `groupsOf` (src/ui/groupTone.ts) drops a blank on purpose, because a guess
 * made from a movement's NAME is exactly the kind of fact this app does not
 * invent. So the owner's Upper day read "Chest · Arms · Back" with no
 * Shoulders over a day containing an overhead press, and nothing anywhere said
 * why.
 *
 * A muscle group is not decoration on this row. It is what puts the movement
 * on the body map, in the day's chips, and in Muscle Focus. A row without one
 * is invisible to all three while looking perfectly fine in a list, which is
 * the worst shape a missing fact can take.
 *
 * Required at the type level so the next caller does not compile rather than
 * discovering this in somebody's program; and refused at RUNTIME too,
 * because a screen can still hand this an empty string from a picker nobody
 * touched. The refusal reports and resolves rather than throwing, for the
 * reason in this file's header: it runs alongside a write the coach actually
 * asked for, and that write must stand.
 *
 * The "row already exists" path is untouched by this. An existing row is the
 * outcome the caller wants, and its group is already whatever the catalogue
 * says — this has no business overwriting it.
 */
export async function ensureCatalogueRow(
  name: string,
  opts: { group: string },
): Promise<{ id: string; created: boolean }> {
  const id = exerciseSlug(name);
  const clean = name.trim();
  if (!id || !clean || !USE_SUPABASE) return { id, created: false };
  const group = (opts?.group ?? '').trim();

  try {
    // Ask first. An insert that conflicts is not an error worth reporting —
    // the row existing is the outcome we want — but distinguishing "already
    // there" from "we just wrote it" is what lets a screen tell the coach
    // their movement was added.
    const { data: found, error: readErr } = await supabase
      .from('exercises').select('id').eq('id', id).maybeSingle();
    if (readErr) { reportError('customExercise.read', readErr, { id }); return { id, created: false }; }
    if (found) return { id, created: false };

    // Only now. A missing group is not a reason to refuse a row that already
    // exists — the caller asked for the identity, and it has one.
    if (!group) {
      reportError('customExercise.group',
        new Error('a new catalogue row needs a muscle group; nothing was written'), { id });
      return { id, created: false };
    }

    // ── who wrote it ──────────────────────────────────────────────────
    //
    // `source = 'coach'` said a coach added this row and nothing said WHICH
    // coach — so a platform admin looking at a typo in a catalogue every gym
    // reads had nobody to ask what it was meant to be, and no way to tell a
    // mistake from a movement they simply had not heard of. Part 2380 gave
    // them the ability to correct a row; this is what makes it answerable.
    //
    // A failed read of our own id does not stop the write. The row is worth
    // more than its provenance — refusing to record a coach's movement
    // because we could not name them would be trading the thing for the
    // label — and `created_by` is nullable precisely so this can be absent.
    // The insert policy accepts null or the caller's own id and nothing else.
    let author: string | null = null;
    try { author = (await supabase.auth.getUser()).data?.user?.id ?? null; } catch { author = null; }

    const { error } = await supabase.from('exercises').insert({
      id,
      name: clean,
      muscle_group: group,
      source: COACH_SOURCE,
      ...(author ? { created_by: author } : {}),
    });
    if (error) {
      // 23505 is a unique violation: another writer got there between the
      // read and the insert. The row exists, which is all the caller needed.
      if ((error as { code?: string }).code === '23505') return { id, created: false };
      reportError('customExercise.insert', error, { id });
      return { id, created: false };
    }
    return { id, created: true };
  } catch (e) {
    reportError('customExercise.insert', e, { id });
    return { id, created: false };
  }
}
