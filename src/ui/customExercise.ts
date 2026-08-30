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
// adding an exercise to a programme. That write is the thing that must
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
 */
export async function ensureCatalogueRow(
  name: string,
  opts: { group?: string | null } = {},
): Promise<{ id: string; created: boolean }> {
  const id = exerciseSlug(name);
  const clean = name.trim();
  if (!id || !clean || !USE_SUPABASE) return { id, created: false };

  try {
    // Ask first. An insert that conflicts is not an error worth reporting —
    // the row existing is the outcome we want — but distinguishing "already
    // there" from "we just wrote it" is what lets a screen tell the coach
    // their movement was added.
    const { data: found, error: readErr } = await supabase
      .from('exercises').select('id').eq('id', id).maybeSingle();
    if (readErr) { reportError('customExercise.read', readErr, { id }); return { id, created: false }; }
    if (found) return { id, created: false };

    const { error } = await supabase.from('exercises').insert({
      id,
      name: clean,
      muscle_group: opts.group?.trim() || null,
      source: COACH_SOURCE,
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
