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
import { useEffect, useState, useCallback } from 'react';
import { useAuthRevision } from './authRevision';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExVideo } from '../lib/trainerMock';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { exerciseSlug } from '../lib/exerciseId';

/** Who the trainer decided may watch a clip. Mirrors the CHECK constraint on
 *  exercise_videos.visibility; 'private' still reaches anyone named in
 *  exercise_video_grants. */
export type Visibility = 'private' | 'clients' | 'gym' | 'public';

export interface VideoItem extends ExVideo {
  url?: string;
  /** Catalogue id of the movement this demonstrates, or null for a local-only
   *  entry that never reached the server. */
  exerciseId: string | null;
  /** Whose clip it is. Null means a platform clip belonging to no gym. */
  trainerId: string | null;
  visibility: Visibility;
  /** Path inside the private bucket, when we host the file ourselves. */
  path?: string;
}

/** Whether the library could be read. `[]` with status 'error' is not the same
 *  claim as `[]` with status 'ready', and the screens must not conflate them.
 *
 *  Aliased to the shared vocabulary rather than restated, so that 'partial' —
 *  a library longer than one read of it — arrives here too. videos.tsx already
 *  gates its clip count on `status === 'ready'`, which means a truncated
 *  library renders its figure as a dash without that screen being touched. */
export type LibraryStatus = LoadStatus;

const KEY = 'repple.exerciseVideos';
const SIGNED_TTL = 60 * 60; // an hour is longer than any set, shorter than a share
let SEQ = 1;

/** Video upload is available whenever the backend is on (storage + table). */
export const videoUploadAvailable = () => USE_SUPABASE;

/**
 * Upload a phone video to the private bucket and return its storage PATH.
 *
 * It used to return a public URL, which is what made the bucket public and the
 * permission model decorative. The path is what gets stored; the URL is minted
 * per viewer, per hour, by playbackUrl().
 */
export async function uploadExerciseVideo(uri: string): Promise<string | null> {
  if (!USE_SUPABASE || !uri) return null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return null;
    const ab = await (await fetch(uri)).arrayBuffer();
    // The folder is the uploader's id: that is the whole of the storage write
    // rule (exvid_object_w), so a path shaped any other way is rejected.
    const path = `${uid}/${Date.now()}.mp4`;
    const { error } = await supabase.storage
      .from('exercise-videos')
      .upload(path, ab, { contentType: 'video/mp4', upsert: true });
    if (error) return null;
    return path;
  } catch { return null; }
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
      .from('exercise-videos')
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

  const load = useCallback(async () => {
    try { const raw = await AsyncStorage.getItem(KEY); if (raw) setAdded(JSON.parse(raw)); } catch { /* ignore */ }
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

  const persist = (next: VideoItem[]) => {
    setAdded(next);
    try { AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
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
    if (USE_SUPABASE) {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
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
        }
      } catch { /* fall through to local, and say so */ }
    }
    const item: VideoItem = {
      id: 'vx' + Date.now().toString(36) + SEQ++,
      name, group,
      dur: v.path ? 'clip' : 'link',
      uploaded: !!(v.path || v.url?.trim()),
      url: v.url?.trim() || undefined,
      path: v.path,
      exerciseId: exerciseSlug(name) || null,
      trainerId: null,
      visibility,
    };
    persist([item, ...added]);
    return 'local';
  };

  /** Change who may watch a clip after the fact. */
  const setVisibility = async (id: string, visibility: Visibility): Promise<boolean> => {
    if (!id.startsWith('db') || !USE_SUPABASE) return false;
    const { error } = await supabase
      .from('exercise_videos').update({ visibility }).eq('id', id.slice(2));
    if (error) return false;
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
    const { error } = await supabase
      .from('exercise_video_grants')
      .upsert({ video_id: id.slice(2), client_id: clientId }, { onConflict: 'video_id,client_id' });
    return !error;
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

  const revokeFrom = async (id: string, clientId: string): Promise<boolean> => {
    if (!id.startsWith('db') || !USE_SUPABASE) return false;
    const { error } = await supabase
      .from('exercise_video_grants').delete().eq('video_id', id.slice(2)).eq('client_id', clientId);
    return !error;
  };

  /** Remove a clip. The stored file goes with it — a row deleted on its own
   *  would leave the video in the bucket with nothing pointing at it, which is
   *  a copy of a named person that nobody can find to delete later. */
  const removeVideo = async (id: string): Promise<boolean> => {
    if (id.startsWith('db')) {
      if (!USE_SUPABASE) return false;
      const target = remote.find((x) => x.id === id);
      const { error } = await supabase.from('exercise_videos').delete().eq('id', id.slice(2));
      if (error) return false;
      if (target?.path) {
        try { await supabase.storage.from('exercise-videos').remove([target.path]); } catch { /* the row is gone; a stray file is not worth failing the delete */ }
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
