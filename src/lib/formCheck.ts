// A clip of one set, for the coach to watch.
//
// The pure half of supabase/parts/2617 — paths, the rules about who may hold
// one, and every sentence a member or a coach reads. Nothing here touches the
// network, so all of it runs under plain `node` in formCheck.test.ts.
//
// ── this is not the other two video features ──────────────────────────────
//
// `exerciseVideoUpload.ts` is the COACH's library: demonstrations they record
// once and attach to a movement. Progress photos are the member's own body on
// a schedule. This is a member filming themselves lifting and asking one
// question about one set, which is a third thing with a third set of rules.
//
// ── what the member is agreeing to, said once, here ───────────────────────
//
// A video of somebody training is their face, their gym, their body, and often
// other members in the background. `MEMBER_CONSENT_NOTE` is the sentence shown
// before the camera opens, and it is deliberately specific about who sees it:
// one coach, the one they have now, and nobody else at all. The policies in
// part 2617 are what make that true; this is what makes it said.

/** The private bucket. Named once so no call site can drift. */
export const FORM_CLIP_BUCKET = 'form-checks';

/**
 * Where one member's clip goes.
 *
 * First segment is the MEMBER's id, because that is the whole of the storage
 * write rule — `formclip_obj_insert` is
 * `(storage.foldername(name))[1] = auth.uid()::text` — and the read rule keys
 * off the same segment to decide whether the caller is that member's coach. A
 * path shaped any other way is refused before a byte moves.
 *
 * `at` and `token` are arguments rather than read here, the same way
 * `exerciseVideoPath` takes them: the caller supplies the randomness it
 * already has and this stays pure.
 *
 * The workout and set are IN the key, not only in the row, so a bucket listing
 * is legible on its own — an orphaned object can be traced back to the set it
 * belonged to without joining anything.
 */
export function formClipPath(uid: string, workoutId: string, setIndex: number, at: number, token: string): string {
  const safeToken = String(token ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'clip';
  // The workout id is shortened rather than dropped: the full uuid makes a key
  // nobody can read at a glance, and the row holds the authoritative link.
  const safeWorkout = String(workoutId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'workout';
  const idx = Number.isFinite(setIndex) && setIndex >= 0 ? Math.floor(setIndex) : 0;
  return `${uid}/${safeWorkout}-${idx}-${Math.floor(at)}-${safeToken}.mp4`;
}

/**
 * Is this key inside this member's own folder?
 *
 * The TypeScript half of the insert policy, applied before the upload rather
 * than after the refusal. One folder deep and no traversal: `foldername(name)`
 * takes the first segment of a longer path happily, so `<uid>/a/b.mp4` would
 * satisfy the policy while being a shape nothing here writes or reads back.
 */
export function isOwnClipPath(uid: string | null | undefined, path: string | null | undefined): boolean {
  const id = String(uid ?? '').trim();
  const p = String(path ?? '').trim();
  if (!id || !p || p.length > 200) return false;
  if (!p.startsWith(`${id}/`)) return false;
  const rest = p.slice(id.length + 1);
  return !!rest && !rest.includes('/') && !rest.includes('..');
}

/**
 * Said before the camera opens, not after the upload.
 *
 * Consent that arrives once the file exists is not consent. This names the one
 * person who will see it and the fact that the member can delete it, because
 * those are the two things somebody weighs before filming themselves.
 */
export const MEMBER_CONSENT_NOTE =
  'This clip goes to your coach and to nobody else: not your gym, not reception, not another coach. '
  + 'If you change coach or stop coaching, the old one loses it the same day. You can delete it yourself at any time, and deleting it is final.';

/** Why a clip cannot be attached. Each wants a different next action. */
export type ClipRefusal = 'no-coach' | 'too-long' | 'too-big' | 'no-set' | null;

/**
 * Whether this set can take a clip.
 *
 * `hasCoach` is the one worth refusing on and the one an app would be tempted
 * to skip: a member with no coach can still record a video, and it would sit in
 * a bucket being read by nobody for as long as the account exists. Recording
 * into nothing is not a feature, it is storage somebody pays for.
 *
 * `seconds` and `bytes` are refused BEFORE the upload rather than by storage
 * afterwards, because a two-minute clip on gym wifi fails slowly and the
 * refusal arrives after the member has waited for it.
 */
export function clipRefusal(o: {
  hasCoach: boolean;
  setExists: boolean;
  seconds?: number | null;
  bytes?: number | null;
}): ClipRefusal {
  if (!o.setExists) return 'no-set';
  if (!o.hasCoach) return 'no-coach';
  if (o.seconds != null && Number.isFinite(o.seconds) && o.seconds > MAX_CLIP_SECONDS) return 'too-long';
  if (o.bytes != null && Number.isFinite(o.bytes) && o.bytes > MAX_CLIP_BYTES) return 'too-big';
  return null;
}

/** Sixty seconds. A form check is one set, and a set that takes longer than a
 *  minute is a set nobody is watching frame by frame anyway. */
export const MAX_CLIP_SECONDS = 60;
/** 60 MB, which is comfortably a minute of phone video at a sensible bitrate
 *  and is small enough to finish on gym wifi. */
export const MAX_CLIP_BYTES = 60 * 1024 * 1024;

/** The refusal, in words, with the next action in it. */
export function clipRefusalLine(r: ClipRefusal): string | null {
  switch (r) {
    case null: return null;
    case 'no-set':
      return 'That set is not logged yet. Log the set first and the clip attaches to it.';
    case 'no-coach':
      return 'A form check goes to your coach, and you do not have one yet. Find a coach first and this appears on every set.';
    case 'too-long':
      return `That clip is longer than ${MAX_CLIP_SECONDS} seconds. Film one set rather than the whole exercise. It is what your coach will watch anyway.`;
    case 'too-big':
      return 'That clip is too large to send. Film a shorter one, or record at a lower quality in your phone’s camera settings.';
  }
}

/**
 * What the coach reads above the clip.
 *
 * Always a sentence, never null — the declared type said `string | null` while
 * every branch returned a string, which is a contract the code did not have
 * and a caller would have written a needless guard around. A set with NO clip
 * is the caller's decision not to call this at all: most sets have none, and a
 * line under every one of them saying so is noise on a screen that is already
 * mostly numbers.
 */
export function clipNoteLine(note: string | null | undefined, whenLabel: string | null): string {
  const q = String(note ?? '').trim();
  const when = whenLabel ? ` (${whenLabel})` : '';
  if (!q) return `They attached a clip of this set${when}, without a question.`;
  return `They asked${when}: “${q}”`;
}
