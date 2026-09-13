// Shared exercise-video library. Trainers add clips entirely from their phone —
// record or pick a video, it uploads to Supabase Storage, and the record saves
// to `exercise_videos` so the people they coach see it in their program on any
// device. No desktop required: the whole record → upload → assign loop is on
// the phone.
//
// ── What was wrong, and why it looked fine ─────────────────────────────────
//
// This never once saved a row. `exercise_videos` requires `exercise_id` and
// `title`; this file sent neither, so Postgres refused every insert with 23502.
// supabase-js resolves with `{ data: null, error }` rather than throwing, so the
// `catch` below never fired — execution simply fell through to the local branch
// and the trainer got an AsyncStorage-only entry while the screen said "Added".
// The clip was on one phone and nowhere else, and nothing said so.
//
// Three things changed with 49-exercise-video-library.sql:
//
//   · an exercise is now a catalogue row with a slug id, so `exercise_id` is
//     answerable. A movement a trainer invents mints its own row on first use —
//     see ensureExercise below — so "custom" is a first-class case, not an
//     unsupported one.
//   · the bucket is private. `video_path` is the durable handle and a signed URL
//     is minted at play time, so who may watch is decided by the row's policy
//     rather than by who has seen the link.
//   · `visibility` is the trainer's decision, per clip: nobody, the people they
//     coach, the whole gym, or everyone — plus a named-person grant list.
//
// And the read now reports its own failure. `videos: []` used to mean both "your
// coach has not uploaded anything" and "we could not reach the server", and the
// client library asserted the former in both cases.
//
// ── And the clips kept on the phone belong to somebody ────────────────────
//
// The entries this hook keeps locally — the ones whose row was refused — lived
// under `repple.exerciseVideos`, a key with no account in it that nothing ever
// cleared, so the next coach to sign in on a shared gym handset inherited them.
// They are keyed by account now; src/lib/handsetClips.ts holds the key, the
// validator and the argument for not migrating the old one.
import { useEffect, useState, useCallback } from 'react';
import { useAuthRevision } from './authRevision';
import { useAuth } from './auth';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  handsetClipsKey, readHandsetClips, writeHandsetClips, LEGACY_HANDSET_CLIPS_KEY,
  type ClipVisibility, type StoredClip,
} from '../lib/handsetClips';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { exerciseSlug } from '../lib/exerciseId';
import { writeFailure } from '../lib/wroteRows';
import { reportError } from '../lib/reportError';
import {
  VIDEO_BUCKET, exerciseVideoPath, videoUploadFailureLine, videoUploadRefusal,
  orphanedVideoObject, type VideoRowOutcome, type VideoUploadRefusal,
} from '../lib/exerciseVideoUpload';

/** Who the trainer decided may watch a clip. Mirrors the CHECK constraint on
 *  exercise_videos.visibility; 'private' still reaches anyone named in
 *  exercise_video_grants.
 *
 *  Declared in src/lib/handsetClips.ts now and aliased here, so the union the
 *  screens import and the union the stored-clip validator narrows to are one
 *  declaration rather than two that agree today. */
export type Visibility = ClipVisibility;

/** One clip, from either end: a row in `exercise_videos` or an entry this
 *  handset is holding because its row was refused.
 *
 *  The shape lives in src/lib/handsetClips.ts beside the function that reads it
 *  back off the device. It was `extends ExVideo` plus four fields; every field
 *  is the same field, and it moved so that what is written to storage and what
 *  is validated coming out of it cannot drift apart. */
export type VideoItem = StoredClip;

/** Whether the library could be read. `[]` with status 'error' is not the same
 *  claim as `[]` with status 'ready', and the screens must not conflate them.
 *
 *  Aliased to the shared vocabulary rather than restated, so that 'partial' —
 *  a library longer than one read of it — arrives here too. videos.tsx already
 *  gates its clip count on `status === 'ready'`, which means a truncated
 *  library renders its figure as a dash without that screen being touched. */
export type LibraryStatus = LoadStatus;

const SIGNED_TTL = 60 * 60; // an hour is longer than any set, shorter than a share
let SEQ = 1;

/** Eight characters of randomness beside the millisecond, the same shape
 *  coachLogo.ts, injuryDocs.ts and progressPhotos.ts already use. */
function newToken(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

/** Video upload is available whenever the backend is on (storage + table). */
export const videoUploadAvailable = () => USE_SUPABASE;

/**
 * Upload a phone video to the private bucket and return its storage PATH.
 *
 * It used to return a public URL, which is what made the bucket public and the
 * permission model decorative. The path is what gets stored; the URL is minted
 * per viewer, per hour, by playbackUrl().
 *
 * ── Why this no longer upserts ────────────────────────────────────────────
 *
 * This was `${uid}/${Date.now()}.mp4` with `upsert: true`, and it was the only
 * `upsert: true` against storage anywhere in the repository — injuryDocs.ts,
 * messaging.ts, avatarUpload.ts and coachLogo.ts all pass `upsert: false`.
 * `upsert: true` sends `x-upsert`, which makes the write an
 * `insert … on conflict do update`: a REPLACEMENT of the bytes behind a key
 * that a named client may already hold a grant and a signed URL for, with no
 * version, no checksum and no modified-at anywhere downstream that could show
 * it happened. supabase/parts/1150 removes `exvid_object_u` — the only UPDATE
 * policy on `storage.objects` in the project — and names this as its follow-up.
 *
 * So the write asks for a NEW object every time, and the key is built to be new
 * every time: `exerciseVideoPath()` puts a random token beside the millisecond,
 * the way coachLogoPath() and coachDocPath() already do. A millisecond alone is
 * not a unique key — two taps inside one millisecond collide, and `Date.now()`
 * is not monotonic across a clock correction on a phone.
 *
 * ── And a refused upload now says which refusal it was ────────────────────
 *
 * The failure path was `if (error) return null` with nothing else: no report,
 * and no way for the screen to tell "you are signed out" from "that key is
 * taken" from "the network died". `onFailure` is handed the sentence for the
 * actual cause, and the cause is reported either way — so a refusal that
 * reaches nobody's eyes still reaches the error log rather than vanishing.
 */
export async function uploadExerciseVideo(
  uri: string,
  onFailure?: (line: string) => void,
): Promise<string | null> {
  if (!USE_SUPABASE || !uri) return null;
  const fail = (reason: VideoUploadRefusal, detail: unknown): null => {
    const line = videoUploadFailureLine(reason);
    reportError('exerciseVideos.uploadExerciseVideo', detail ?? new Error(line), { reason });
    onFailure?.(line);
    return null;
  };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    // Not a silent null. A coach whose session lapsed while the picker was open
    // is the commonest way to arrive here, and "check your connection" is the
    // one piece of advice that cannot fix it.
    if (!uid) return fail('signed-out', new Error('no signed-in user'));
    const ab = await (await fetch(uri)).arrayBuffer();
    // The folder is the uploader's id: that is the whole of the storage write
    // rule (exvid_object_w), so a path shaped any other way is rejected.
    const path = exerciseVideoPath(uid, Date.now(), newToken());
    const { error } = await supabase.storage
      .from(VIDEO_BUCKET)
      .upload(path, ab, { contentType: 'video/mp4', upsert: false });
    if (error) return fail(videoUploadRefusal(error), error);
    return path;
  } catch (e) {
    // fetch() on the local file, or the upload with no reply at all.
    return fail(videoUploadRefusal(e), e);
  }
}

/**
 * A URL the player can actually open, or null when there is nothing to play.
 *
 * An external link (a coach who pointed at a video hosted elsewhere) is handed
 * back as-is. A file we host is signed on the spot: the signing call is itself
 * subject to the storage read policy, which asks the table whether this viewer
 * may watch — so a clip the trainer has not shared with them returns null here
 * rather than playing.
 */
export async function playbackUrl(v: Pick<VideoItem, 'url' | 'path'>): Promise<string | null> {
  if (v.url) return v.url;
  if (!v.path || !USE_SUPABASE) return null;
  try {
    const { data, error } = await supabase.storage
      .from(VIDEO_BUCKET)
      .createSignedUrl(v.path, SIGNED_TTL);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch { return null; }
}

/**
 * The catalogue id for an exercise name, creating the row if this is a movement
 * nobody has recorded before.
 *
 * A trainer typing "Kettlebell Windmill" is not an error to be refused — it is
 * the custom case working. The insert is `on conflict do nothing` in effect: a
 * duplicate is expected and ignored, because the slug already names the row we
 * wanted. Returns null only when the catalogue genuinely could not be written,
 * which is the one case where the video has to stay local.
 */
async function ensureExercise(name: string, group: string): Promise<string | null> {
  const id = exerciseSlug(name);
  if (!id) return null;
  try {
    // no-error-ok: a failed lookup falls through to the insert below, whose 23505 branch handles the row already existing
    const { data: found } = await supabase.from('exercises').select('id').eq('id', id).maybeSingle();
    if (found?.id) return found.id;
    const { error } = await supabase
      .from('exercises')
      .insert({ id, name, muscle_group: group || null, is_cardio: false });
    // 23505 means someone else created it between the two calls, which is a
    // success for our purposes: the row we wanted exists.
    if (error && (error as any).code !== '23505') return null;
    return id;
  } catch { return null; }
}

const rowToItem = (r: any): VideoItem => ({
  id: 'db' + r.id,
  // `title` is the NOT NULL column and `name` the one added out of band later;
  // either may be the populated one depending on when the row was written.
  name: r.name || r.title || 'Untitled',
  group: r.muscle_group || 'Uncategorised',
  dur: r.video_path ? 'clip' : 'link',
  // `uploaded` means a client can actually open something — it was hardcoded
  // true for every item, so an entry with no clip and no link still rendered as
  // "Live" and counted toward "N of M recorded".
  uploaded: !!(r.video_path || r.url),
  url: r.url || undefined,
  path: r.video_path || undefined,
  exerciseId: r.exercise_id ?? null,
  trainerId: r.trainer_id ?? null,
  visibility: (r.visibility as Visibility) || 'clients',
});

export function useExerciseVideos() {
  const authRev = useAuthRevision();
  const [added, setAdded] = useState<VideoItem[]>([]);
  const [remote, setRemote] = useState<VideoItem[]>([]);
  const [status, setStatus] = useState<LibraryStatus>('loading');
  // ── whose clips ────────────────────────────────────────────────────────
  //
  // The handset entries were read and written under one unqualified key with
  // no account in it and no entry in src/lib/signOutState.ts, so the next
  // person to sign in on a coach's handset opened Videos and read the previous
  // coach's clips. See src/lib/handsetClips.ts, which makes the same argument
  // src/lib/mealSwaps.ts makes about a member's meal swaps.
  //
  // `user?.id` rather than a `getUser()` inside `load`, because the KEY has to
  // be a render value: the effect below is keyed on it, which is what makes an
  // account switch a re-read rather than a list left standing from the last
  // session.
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const clipsKey = handsetClipsKey(uid);
  // False until a read of THIS key has come back. It arms the write in
  // `persist`, and it is reset before every read — see the effect.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Cleared BEFORE the read, not left at whatever the last key's read set it
    // to. `hydrated` is the arming flag for the write, and a flag that survived
    // the key changing would let an account switch whose read then failed write
    // this coach's empty list straight over the other one's stored clips —
    // which is the one way to LOSE a clip rather than merely show the wrong
    // one. Lane 4 caught this in its own fix; it is the same trap here.
    setHydrated(false);
    // No account is no store. The clips still work for this session; they are
    // simply not kept, which is what `handsetClipsKey` returning null means.
    if (!clipsKey) { setAdded([]); return; }
    let live = true;
    AsyncStorage.getItem(clipsKey)
      .then((r) => { if (live) { setAdded(readHandsetClips(r)); setHydrated(true); } })
      // An unreadable store is no clips on screen, and `hydrated` stays false,
      // so nothing is persisted over whatever is actually on the device. A clip
      // added in this session still shows; it is not kept, and the next launch
      // reads the real bytes again.
      .catch(() => { if (live) setAdded([]); });
    return () => { live = false; };
  }, [clipsKey]);

  // The unqualified key this replaces, removed rather than migrated: nothing
  // distinguishes a single-owner handset's own old clips from the previous
  // coach's on a shared one, and reading it would be the defect performed once
  // deliberately. See the header of src/lib/handsetClips.ts.
  useEffect(() => { AsyncStorage.removeItem(LEGACY_HANDSET_CLIPS_KEY).catch(() => {}); }, []);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    try {
      // No trainer filter: exvid_read decides what this person may see, and it
      // knows about grants and gym-wide sharing that a client-side filter would
      // get wrong. The error is read rather than assumed away.
      // Newest-first was already the order, which is the end worth keeping, and
      // now it is bounded. Unfiltered by trainer on purpose (see above), so at a
      // gym this is every coach's clips in one list — the read here that grows
      // with the business rather than with one person's use of it.
      const { data, error } = await supabase
        .from('exercise_videos')
        .select('id, exercise_id, trainer_id, title, name, muscle_group, url, video_path, visibility, created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(capLimit());
      if (error) { setStatus('error'); return; }
      const page = capped(data);
      setRemote(page.rows.map(rowToItem));
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch { setStatus('error'); }
    // Re-armed on sign-in. This read is RLS-scoped, so running it once at mount
    // — while still signed out — left status latched at 'error' for the life of
    // the app, and `load` never changed identity so the effect never re-ran.
  }, [authRev]);
  useEffect(() => { load(); }, [load]);

  /**
   * Show the new list, and keep it if this device is allowed to.
   *
   * Two guards, and neither is an "ignore":
   *
   *   · no key — nobody is signed in, so there is no account to keep it under
   *     and a shared key is the defect this file was changed to end.
   *   · not hydrated — the read of this key has not come back, or came back
   *     refused. Writing now would put this session's list on top of bytes we
   *     never managed to read.
   *
   * In both cases the clip is on screen for this session and is not kept. The
   * `try` this replaces could not catch anything at all: `setItem` returns a
   * promise, so a storage rejection was an unhandled rejection rather than the
   * ignored one the comment claimed.
   */
  const persist = (next: VideoItem[]) => {
    setAdded(next);
    if (!clipsKey || !hydrated) return;
    AsyncStorage.setItem(clipsKey, writeHandsetClips(next)).catch(() => { /* on screen this session either way */ });
  };

  /**
   * Returns where it landed: 'remote' is visible to the people the trainer
   * chose, on any device; 'local' is this phone only. videos.tsx used to
   * announce the former in both cases, because it branched on a build flag
   * rather than on the result.
   */
  const addVideo = async (v: {
    name: string; group?: string; url?: string; path?: string; visibility?: Visibility;
  }): Promise<'remote' | 'local' | 'none'> => {
    const name = (v.name || '').trim(); if (!name) return 'none';
    const group = (v.group || 'Uncategorised').trim() || 'Uncategorised';
    const visibility: Visibility = v.visibility || 'clients';
    // Which of the three the write turned out to be. 'unconfirmed' is the
    // starting value on purpose: every branch that ANSWERS sets it, and the one
    // that does not — an exception, meaning no reply at all — leaves it, which
    // is the reading that keeps a possibly-live row's file. See
    // `orphanedVideoObject` in src/lib/exerciseVideoUpload.ts.
    let outcome: VideoRowOutcome = 'unconfirmed';
    let uploader: string | null = null;
    if (USE_SUPABASE) {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        uploader = uid ?? null;
        const exerciseId = uid ? await ensureExercise(name, group) : null;
        if (uid && exerciseId) {
          const { data, error } = await supabase.from('exercise_videos').insert({
            exercise_id: exerciseId,
            trainer_id: uid,
            title: name,          // NOT NULL, and the reason nothing ever saved
            name,
            muscle_group: group,
            url: v.url || null,
            video_path: v.path || null,
            visibility,
          }).select().single();
          if (!error && data) { setRemote((p) => [rowToItem(data), ...p]); return 'remote'; }
          // The server replied and there is no row: `.single()` errors on nought
          // rows, so `!data` and `error` are the same answer.
          outcome = 'refused';
        } else {
          // Nobody signed in, or the catalogue would not take the movement. No
          // insert was attempted, so there is certainly no row.
          outcome = 'refused';
        }
      } catch { /* fall through to local, and say so */ }
    }

    // A file we uploaded seconds ago that no row will ever point at. Removed
    // here, while the coach's session still can — `exvid_object_r` needs a row,
    // so from the next launch nobody on the platform can even see it. The
    // fast path only: supabase/parts/2510 sweeps whatever this misses.
    const orphan = orphanedVideoObject(outcome, uploader, v.path);
    if (orphan) {
      try {
        const { error } = await supabase.storage.from(VIDEO_BUCKET).remove([orphan]);
        if (error) reportError('exerciseVideos.discardOrphan', error, { path: orphan });
      } catch (e) { reportError('exerciseVideos.discardOrphan', e, { path: orphan }); }
    }

    // `path` goes with the object. A local entry still carrying the key of a
    // file we have just deleted draws a play button on a clip that cannot be
    // signed by anybody, which is a worse answer than "not recorded yet".
    const path = orphan ? undefined : v.path;
    const item: VideoItem = {
      id: 'vx' + Date.now().toString(36) + SEQ++,
      name, group,
      dur: path ? 'clip' : 'link',
      uploaded: !!(path || v.url?.trim()),
      url: v.url?.trim() || undefined,
      path,
      exerciseId: exerciseSlug(name) || null,
      trainerId: null,
      visibility,
    };
    persist([item, ...added]);
    return 'local';
  };

  /**
   * Change who may watch a clip after the fact.
   *
   * ── Why the row count, and not `error` ─────────────────────────────────
   *
   * `load()` above deliberately does not filter by trainer: `exvid_read`
   * decides what this person may see, and it publishes every clip marked
   * 'public' and every platform clip belonging to no trainer. So the list this
   * hook hands back is NOT the coach's own clips — it is every clip they are
   * allowed to watch, including other coaches'.
   *
   * `exvid_trainer_rw` is `trainer_id = auth.uid()`, so an UPDATE aimed at one
   * of those matches zero rows. PostgREST returns 204 with `error` null, which
   * this read as success: it returned true and moved the chip to the level the
   * coach picked. Proved live against phgfwzpkkwdysftlgkoq by seeding a second
   * coach — one SELECT of the other coach's public clip, and an UPDATE of it
   * affecting 0 rows with no error at all.
   *
   * A coach who sets a clip of a named client to "Only me", and is told it is
   * private when it is still public, is the worst outcome this screen has. So
   * the count is what decides, and the local state is only moved after it.
   */
  const setVisibility = async (id: string, visibility: Visibility): Promise<boolean> => {
    if (!id.startsWith('db') || !USE_SUPABASE) return false;
    const r = await supabase
      .from('exercise_videos').update({ visibility }, { count: 'exact' }).eq('id', id.slice(2));
    const why = writeFailure('That sharing setting', r);
    if (why) { reportError('exerciseVideos.setVisibility', new Error(why), { id, visibility }); return false; }
    setRemote((p) => p.map((x) => (x.id === id ? { ...x, visibility } : x)));
    return true;
  };

  /**
   * Hand one clip to one person by name, whatever its visibility is otherwise.
   * This is the "whoever the trainer gives permissions to" case, and it can
   * reach a clip marked private.
   */
  const grantTo = async (id: string, clientId: string): Promise<boolean> => {
    if (!id.startsWith('db') || !USE_SUPABASE) return false;
    // The row is asked for back. An upsert that conflicts takes the UPDATE
    // path, and `exvid_grants_trainer_rw` can leave that matching nothing —
    // at which point PostgREST resolves with no error and no row, and the
    // toggle would light for a person who cannot watch the clip.
    const { data, error } = await supabase
      .from('exercise_video_grants')
      .upsert({ video_id: id.slice(2), client_id: clientId }, { onConflict: 'video_id,client_id' })
      .select('client_id');
    if (error) { reportError('exerciseVideos.grantTo', error, { id, clientId }); return false; }
    if (!data || data.length === 0) {
      reportError('exerciseVideos.grantTo', new Error('grant upsert returned no row'), { id, clientId });
      return false;
    }
    return true;
  };

  /**
   * Who this clip has been handed to by name.
   *
   * Returns null rather than [] when the list could not be read — a sharing
   * screen that renders "nobody" over a failed read invites a trainer to share
   * a clip a second time, or to believe they never shared something they did.
   */
  const listGrants = async (id: string): Promise<string[] | null> => {
    if (!id.startsWith('db') || !USE_SUPABASE) return null;
    // One row per person this clip was handed to, so it is bounded by the gym's
    // client list rather than by anything about the clip — a gym-wide "shared
    // with everyone" clip at a 1,200-member gym is over the ceiling.
    //
    // Truncation returns null, the same as a failed read, and the contract above
    // is why: the caller's question is "who has this", and a partial answer to
    // that question is worse than none. The screen renders null as "we could not
    // list who this is shared with" and a trainer checks rather than assumes; a
    // short list renders as names, and the person missing from it looks like
    // somebody the trainer never shared with and may then be re-shared or, far
    // worse, believed to have never been given access to it at all.
    const { data, error } = await supabase
      .from('exercise_video_grants').select('client_id').eq('video_id', id.slice(2))
      .order('client_id', { ascending: true }).limit(capLimit());
    if (error) return null;
    const page = capped(data);
    if (page.truncated) return null;
    return page.rows.map((r: any) => r.client_id);
  };

  /**
   * Take a clip back from one named person.
   *
   * The count, not `error`, for the reason setVisibility gives: a DELETE that
   * `exvid_grants_trainer_rw` refuses matches zero rows and reports nothing.
   * videos.tsx draws the toggle off on a true here and tells the coach the
   * person can no longer watch it — so an unconfirmed revoke is a statement
   * about somebody's access to a video that is not true.
   *
   * A grant that had already gone now reports as not-removed rather than as
   * removed. That is deliberate: videos.tsx only calls this for a person the
   * grant list said WAS granted, so no row means the list on screen is stale,
   * and sending the coach back to look is the right end of that.
   */
  const revokeFrom = async (id: string, clientId: string): Promise<boolean> => {
    if (!id.startsWith('db') || !USE_SUPABASE) return false;
    const r = await supabase
      .from('exercise_video_grants').delete({ count: 'exact' })
      .eq('video_id', id.slice(2)).eq('client_id', clientId);
    const why = writeFailure('That person’s access', r);
    if (why) { reportError('exerciseVideos.revokeFrom', new Error(why), { id, clientId }); return false; }
    return true;
  };

  /** Remove a clip. The stored file goes with it — a row deleted on its own
   *  would leave the video in the bucket with nothing pointing at it, which is
   *  a copy of a named person that nobody can find to delete later. */
  const removeVideo = async (id: string): Promise<boolean> => {
    if (id.startsWith('db')) {
      if (!USE_SUPABASE) return false;
      const target = remote.find((x) => x.id === id);
      // The count decides, for the reason setVisibility gives — and this one
      // did more damage than the others when it was wrong. A refused DELETE
      // returned true, so the clip was dropped from `remote` and the coach
      // could no longer see it to try again, while the row and everyone's
      // access to it stayed exactly where they were. The stored file was
      // deleted underneath it, which is the one part that CAN succeed on
      // somebody else's row, so the outcome was a live row pointing at nothing.
      const r = await supabase.from('exercise_videos').delete({ count: 'exact' }).eq('id', id.slice(2));
      const why = writeFailure('That clip', r);
      if (why) { reportError('exerciseVideos.removeVideo', new Error(why), { id }); return false; }
      if (target?.path) {
        // Swallowed on purpose, and the reason is stronger than it used to be.
        // This read "the row is gone; a stray file is not worth failing the
        // delete", which was a shrug at bytes nobody would chase. There is no
        // stray file now: the row delete above fires `trg_exercise_video_deleted`
        // (supabase/parts/1152), which queues `exercise-videos` + this path into
        // `object_purge` in the same transaction, and the drain sends the DELETE.
        // So this call is the fast path, not the only path — it clears the object
        // immediately when it works, and when it does not, the queue still has it.
        // A double delete is expected and handled: the drain treats 404 as
        // 'already absent' rather than as a failure.
        try { await supabase.storage.from(VIDEO_BUCKET).remove([target.path]); } catch { /* the queue has this path; see above */ }
      }
      setRemote((p) => p.filter((x) => x.id !== id));
      return true;
    }
    persist(added.filter((x) => x.id !== id));
    return true;
  };

  const videos: VideoItem[] = [...remote, ...added];
  return { videos, status, addVideo, removeVideo, setVisibility, grantTo, revokeFrom, listGrants, reload: load };
}
