// Which way the person was facing.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// `public.progress_photos` carries a `pose` column — text, nullable, with a
// CHECK that pins it to exactly `'front'`, `'side'` or `'back'`. It is in the
// live database. It is in none of the reads: `listProgressPhotos` selects
// `id, client_id, taken_at, image_path, weight_kg, body_fat_pct` and stops
// there, `ProgressPhoto` does not declare it, and no screen in three apps has
// ever mentioned it.
//
// So app/(client)/compare.tsx puts any two photos side by side under one
// heading and one set of figures, and a front-on shot from March sits beside a
// side-on shot from September as though the two showed the same thing. They do
// not. A side view is where a waistline is legible and a front view is where
// shoulder width is; comparing across them shows a difference in camera angle
// and offers it as a difference in the body. That is the one reading a
// before-and-after exists to support, and it was being drawn from two
// incomparable pictures with nothing on screen to say so.
//
// ── What this module will NOT do ──────────────────────────────────────────
//
// Guess. A photograph reaches this app as pixels belonging to somebody's body,
// and nothing here turns one into a value — not a pose, not a measurement, not
// a score. `pose` is what the person recording the photo SAID, exactly as
// `bw[i]` and `timed[i]` in the workout log are what the member said about a
// set (src/lib/bodyweightSets.ts). Absent means nobody was asked, which is the
// honest reading of every row written before the column existed, and every one
// of them is NULL today.
//
// Nor does it choose a pair. Picking the two "matching" photos automatically
// would be this app selecting which pictures of somebody's body to show them
// side by side, and a comparison is the member's own choice — the pose is a
// label on what they picked and a caveat when the two do not agree, never a
// filter that removes a photo from the strip.
import { capLimit, assertWhole } from './rowCap';

/** The three the CHECK constraint allows. Nothing else is a pose. */
export type Pose = 'front' | 'side' | 'back';

/** In the order a person is asked for them, which is also the order they read
 *  in a strip: face on, turn, turn again. */
export const POSES: readonly Pose[] = ['front', 'side', 'back'];

/**
 * A stored value read as a pose, or null.
 *
 * Deliberately narrow, and narrow in the direction of silence. The column is
 * `text` with a CHECK behind it, but this value has also been through PostgREST,
 * a JSON round trip and possibly an offline queue, and the failure this guards
 * is the one every reader in this codebase eventually meets: a string nobody
 * expected coerced into a category and then printed as a fact about somebody's
 * photograph. `'Front'`, `' front '` and `'front-on'` are not the three values
 * the database permits; they are evidence that something else wrote the row,
 * and the answer to that is null and a sentence, not a best guess.
 */
export function readPose(v: unknown): Pose | null {
  return typeof v === 'string' && (POSES as readonly string[]).includes(v) ? (v as Pose) : null;
}

/**
 * How a pose reads on a label, or null when there is none.
 *
 * Null rather than "Unknown". An unlabelled photo is the ordinary case — every
 * row in the table is one — and stamping "Unknown" on a member's own picture
 * says the app looked and could not tell, when in truth nobody was ever asked.
 */
export function poseLabel(p: Pose | null): string | null {
  return p === 'front' ? 'Front on' : p === 'side' ? 'Side on' : p === 'back' ? 'From behind' : null;
}

/**
 * Whether two photos show the same view.
 *
 * Three answers, and the third is not a polite version of the second:
 *
 *   'same'      both are labelled and the labels agree
 *   'different' both are labelled and they do not — the comparison below is
 *               across two camera angles and the screen has to say so
 *   'unknown'   at least one is unlabelled, so there is nothing to compare.
 *               NOT 'same': treating an absent label as agreement is exactly
 *               the silence that let a front and a side sit side by side, with
 *               the difference in angle offered as a difference in the body.
 */
export type PoseMatch = 'same' | 'different' | 'unknown';

export function posesMatch(a: Pose | null, b: Pose | null): PoseMatch {
  if (a == null || b == null) return 'unknown';
  return a === b ? 'same' : 'different';
}

/**
 * What to say over a pair whose poses do not agree, or null when there is
 * nothing to say.
 *
 * Only on 'different'. On 'unknown' the screen says nothing about poses at all:
 * a caveat attached to every unlabelled pair would fire on every comparison
 * anybody has ever made, which is how a warning stops being read.
 *
 * It does not tell the member to pick different photos. They chose these two,
 * they may have chosen them on purpose, and the figures beside them — weight,
 * body fat, the span between the dates — are true of both days whichever way
 * the camera was pointing. What is not safe to read off two different angles is
 * the SHAPE, and that is the one thing the sentence names.
 */
export function poseMismatchNote(a: Pose | null, b: Pose | null): string | null {
  if (posesMatch(a, b) !== 'different') return null;
  const from = poseLabel(a), to = poseLabel(b);
  if (!from || !to) return null;
  return `These are two different views — ${from.toLowerCase()} and ${to.toLowerCase()}. The readings underneath are true of both days, but the shapes in the pictures are not directly comparable: some of what looks changed is the angle.`;
}

/* ── I/O ──────────────────────────────────────────────────────────────────
   Required lazily, not imported, for the reason src/lib/progressPhotos.ts
   gives: a top-level `import { supabase }` drags in AsyncStorage, and the pure
   half of this file is covered by a test that runs under plain `node` and
   would die on the import rather than on an assertion. */

type Sb = typeof import('./supabase').supabase;

function db(): Sb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require('./supabase') as { supabase: Sb }).supabase;
}

/** Just the two columns, because that is all this answers. */
interface PoseRow { id: string; pose: string | null }

/**
 * The pose of each of this person's photos, keyed by photo id.
 *
 * A second read rather than a column on the first, and that is a seam worth
 * naming: `listProgressPhotos` also signs every object key, so widening it is a
 * change to the one call the gallery, the compare screen and the report all
 * make. This asks for two columns and no signed URLs, it is covered by the same
 * `progress_photos_owner` policy, and a screen that cannot get it still renders
 * every photo — it simply says nothing about poses, which is what it did
 * before.
 *
 * A truncated read THROWS, for the reason ./rowCap.ts gives: a prefix of this
 * map would report "no pose recorded" for every photo past the ceiling, and a
 * missing label is indistinguishable from a label that was never read. The
 * caller catches it and falls back to saying nothing.
 */
export async function fetchPhotoPoses(): Promise<Map<string, Pose | null>> {
  const sb = db();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Sign in to read your progress photos.');

  const { data, error } = await sb
    .from('progress_photos')
    .select('id, pose')
    .eq('client_id', uid)
    .limit(capLimit());
  if (error) throw error;

  const rows = assertWhole((data ?? []) as PoseRow[], 'the poses of your progress photos');
  const out = new Map<string, Pose | null>();
  for (const r of rows) if (r && typeof r.id === 'string') out.set(r.id, readPose(r.pose));
  return out;
}
