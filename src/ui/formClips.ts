// The I/O half of a form check: pick, upload, record, read back, delete.
//
// Every rule and every sentence is in src/lib/formCheck.ts, which runs under
// plain `node`. This file is the part that needs a phone, a bucket and a
// session, and it decides nothing — it asks that module and obeys.
//
// The upload discipline is `uploadMessageAttachment`'s, deliberately: a fresh
// key every time, `upsert: false`, and the row written ONLY once the object is
// actually there. A row pointing at an object that failed to upload is a coach
// opening a clip that does not exist, which reads as the app being broken
// rather than as an upload having failed.
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { ensureMediaPermission } from './permissions';
import {
  FORM_CLIP_BUCKET, formClipPath, isOwnClipPath, clipRefusal, clipRefusalLine,
  MAX_CLIP_SECONDS, MAX_CLIP_BYTES,
} from '../lib/formCheck';

/** One clip as a screen holds it. */
export interface FormClip {
  id: string;
  workoutId: string;
  setIndex: number;
  path: string;
  note: string | null;
  createdAt: string;
}

/** A clip chosen and not yet sent. */
export interface PendingClip {
  uri: string;
  seconds: number | null;
  bytes: number | null;
}

function newToken(): string {
  return Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '').padEnd(8, '0');
}

/**
 * Film one, or choose one already filmed.
 *
 * Capped at the RECORDER rather than after the fact: a clip refused for its
 * length once it is recorded wastes the take, and the member is standing in a
 * gym. `ensureMediaPermission` says its own piece — including offering
 * Settings when iOS will not ask again — so a false here is already explained
 * on screen and returns no error of its own.
 */
export async function pickFormClip(source: 'camera' | 'library'): Promise<{ clip: PendingClip | null; error: string | null }> {
  const purpose = 'send your coach a clip of a set';
  if (!(await ensureMediaPermission(source === 'camera' ? 'camera' : 'library', purpose))) {
    return { clip: null, error: null };
  }
  try {
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: MAX_CLIP_SECONDS })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (res.canceled || !res.assets || !res.assets[0]) return { clip: null, error: null };
    const a = res.assets[0];
    return {
      clip: {
        uri: a.uri,
        // The picker reports duration in milliseconds when it reports it at
        // all. Null stays null — see `clipRefusal`: an unmeasured clip is
        // allowed through rather than blocked on a phone that does not say.
        seconds: typeof a.duration === 'number' && Number.isFinite(a.duration) ? a.duration / 1000 : null,
        bytes: typeof a.fileSize === 'number' && Number.isFinite(a.fileSize) ? a.fileSize : null,
      },
      error: null,
    };
  } catch (e) {
    reportError('formClips.pick', e);
    return { clip: null, error: 'The camera could not be opened. Try again.' };
  }
}

/**
 * Send one, and record it against the set.
 *
 * Order matters and is the opposite of the obvious one: the object goes up
 * first and the row is written only if it lands. The row is what a coach sees;
 * writing it first would put a clip on their screen that opens to nothing.
 *
 * A set already carrying a clip has it REPLACED — `(workout_id, set_index)` is
 * unique, and two clips of one set with no way to tell which is current is how
 * a coach reviews the wrong one. The old object is deleted after the new row
 * lands, and a failure to delete it is logged rather than surfaced: the member
 * has what they asked for, and an orphaned object is our problem.
 */
export async function sendFormClip(o: {
  memberId: string;
  workoutId: string;
  setIndex: number;
  clip: PendingClip;
  note: string;
  hasCoach: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build has no server, so the clip has nowhere to go.' };

  // Every refusal the pure module knows about, before a byte moves.
  const refusal = clipRefusal({
    hasCoach: o.hasCoach, setExists: !!o.workoutId, seconds: o.clip.seconds, bytes: o.clip.bytes,
  });
  if (refusal) return { ok: false, error: clipRefusalLine(refusal) ?? 'That clip cannot be sent.' };

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(o.clip.uri);
    if (!res.ok) return { ok: false, error: 'That clip could not be read off your phone.' };
    bytes = await res.arrayBuffer();
  } catch (e) {
    reportError('formClips.read-file', e);
    return { ok: false, error: 'That clip could not be read off your phone.' };
  }

  // The picker did not always say how big it was. Now we know, and the same
  // limit is applied rather than letting storage answer with an opaque 413.
  if (bytes.byteLength > MAX_CLIP_BYTES) {
    return { ok: false, error: clipRefusalLine('too-big') ?? 'That clip is too large to send.' };
  }

  const path = formClipPath(o.memberId, o.workoutId, o.setIndex, Date.now(), newToken());
  // The TypeScript half of the storage policy, checked before the round trip
  // rather than after the refusal.
  if (!isOwnClipPath(o.memberId, path)) {
    reportError('formClips.path', new Error('built a key outside the member folder'), { path });
    return { ok: false, error: 'That clip could not be prepared. Nothing has been sent.' };
  }

  const previous = await fetchFormClip(o.workoutId, o.setIndex);

  const up = await supabase.storage.from(FORM_CLIP_BUCKET)
    .upload(path, bytes, { contentType: 'video/mp4', upsert: false });
  if (up.error) {
    reportError('formClips.upload', up.error, { path });
    return { ok: false, error: 'That clip did not upload, so your coach has not been sent anything. Try again on a better connection.' };
  }

  // `upsert` on the ROW, because replacing a set's clip is the ordinary case
  // and the unique index is what makes it one write rather than a delete and
  // an insert that can half-happen.
  const { error } = await supabase.from('form_clips').upsert({
    user_id: o.memberId,
    workout_id: o.workoutId,
    set_index: o.setIndex,
    path,
    note: o.note.trim() ? o.note.trim() : null,
  }, { onConflict: 'workout_id,set_index' });

  if (error) {
    reportError('formClips.row', error, { path });
    // The object is up and nothing points at it. Removed, so the bucket does
    // not fill with clips no row describes — and if THAT fails too it is
    // logged and left, because the member must not be told their clip failed
    // twice over something they cannot act on.
    void supabase.storage.from(FORM_CLIP_BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: 'The clip uploaded but could not be attached to the set, so your coach will not see it. Try again.' };
  }

  // Only now, and only the one it replaced.
  if (previous && previous.path !== path) {
    void supabase.storage.from(FORM_CLIP_BUCKET).remove([previous.path]).catch((e) => {
      reportError('formClips.cleanup', e, { path: previous.path });
    });
  }
  return { ok: true };
}

/** The clip on one set, or null because there is not one. Null is also what a
 *  failed read produces — the caller shows no clip either way, and a sentence
 *  claiming there is none would be a claim this cannot make. */
export async function fetchFormClip(workoutId: string, setIndex: number): Promise<FormClip | null> {
  if (!USE_SUPABASE || !workoutId) return null;
  try {
    const { data, error } = await supabase
      .from('form_clips')
      .select('id, workout_id, set_index, path, note, created_at')
      .eq('workout_id', workoutId)
      .eq('set_index', setIndex)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as Record<string, unknown>;
    return {
      id: String(r.id),
      workoutId: String(r.workout_id),
      setIndex: Number(r.set_index),
      path: String(r.path),
      note: typeof r.note === 'string' && r.note.trim() ? r.note : null,
      createdAt: String(r.created_at),
    };
  } catch (e) {
    reportError('formClips.read', e);
    return null;
  }
}

/**
 * Every clip one member has attached, newest first.
 *
 * Read by the COACH from their client screen, and by the member from their
 * own. Both go through the same query and RLS decides what comes back:
 * `form_clips_own` for the member, `form_clips_coach_read` for the coach who
 * currently coaches them, nothing for anybody else.
 *
 * `null` is a read that did not land and is NOT an empty list. A coach told
 * "they have not sent you any" over a failed read would stop looking, which is
 * the failure this whole codebase keeps writing down.
 */
export async function fetchFormClipsFor(memberId: string, limit = 20): Promise<FormClip[] | null> {
  if (!USE_SUPABASE || !memberId) return null;
  try {
    const { data, error } = await supabase
      .from('form_clips')
      .select('id, workout_id, set_index, path, note, created_at')
      .eq('user_id', memberId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) { reportError('formClips.list', error); return null; }
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      workoutId: String(r.workout_id),
      setIndex: Number(r.set_index),
      path: String(r.path),
      note: typeof r.note === 'string' && r.note.trim() ? r.note : null,
      createdAt: String(r.created_at),
    }));
  } catch (e) {
    reportError('formClips.list', e);
    return null;
  }
}

/**
 * A URL that plays, for a short while.
 *
 * The bucket is private, so this is the only way to watch one — and the signed
 * URL is checked against `formclip_obj_read`, which is the member and the coach
 * who currently coaches them. A coach who has since been changed gets nothing,
 * which is the point.
 */
export async function formClipUrl(path: string, seconds = 60 * 30): Promise<string | null> {
  if (!USE_SUPABASE || !path) return null;
  try {
    const { data, error } = await supabase.storage.from(FORM_CLIP_BUCKET).createSignedUrl(path, seconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch (e) {
    reportError('formClips.sign', e);
    return null;
  }
}

/**
 * Delete one. The member's own act, and final.
 *
 * The row goes first here, unlike the upload. A row with no object is a coach
 * tapping into nothing; an object with no row is invisible to everybody and is
 * swept by the storage delete that follows. So the order is chosen so that a
 * half-failure leaves the harmless one.
 */
export async function deleteFormClip(clip: FormClip): Promise<{ ok: boolean; error: string | null }> {
  if (!USE_SUPABASE) return { ok: false, error: 'This build has no server.' };
  const { error, count } = await supabase
    .from('form_clips').delete({ count: 'exact' }).eq('id', clip.id);
  if (error) {
    reportError('formClips.delete', error);
    return { ok: false, error: 'That clip was not deleted. It is still with your coach.' };
  }
  if ((count ?? 0) === 0) {
    // PostgREST answers a delete that matched nothing as a success. Saying
    // "deleted" over that is how somebody believes a video is gone when it is
    // not — which for this content is the worst thing this file could do.
    return { ok: false, error: 'That clip was not deleted — it may already be gone, or it is not yours to remove. Pull down to see what is actually there.' };
  }
  void supabase.storage.from(FORM_CLIP_BUCKET).remove([clip.path]).catch((e) => {
    reportError('formClips.delete-object', e, { path: clip.path });
  });
  return { ok: true, error: null };
}
