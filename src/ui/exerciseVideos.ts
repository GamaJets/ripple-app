// Shared exercise-video library. Trainers add clips entirely from their phone —
// record/pick a video, it uploads to Supabase Storage (hosted), and the record
// saves to `exercise_videos` so the trainer's clients see it in their program on
// any device. Falls back to a local-only entry (or a hosted link) offline.
// No desktop required — the whole record → upload → assign loop is on the phone.
import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExVideo } from '../lib/trainerMock';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

export interface VideoItem extends ExVideo { url?: string }

const KEY = 'repple.exerciseVideos';
let SEQ = 1;

/** Video upload is available whenever the backend is on (storage + table). */
export const videoUploadAvailable = () => USE_SUPABASE;

/** Upload a phone video file (local uri) to hosting; returns a public URL. */
export async function uploadExerciseVideo(uri: string): Promise<string | null> {
  if (!USE_SUPABASE || !uri) return null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return null;
    const ab = await (await fetch(uri)).arrayBuffer();
    const path = `${uid}/${Date.now()}.mp4`;
    const { error } = await supabase.storage.from('exercise-videos').upload(path, ab, { contentType: 'video/mp4', upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from('exercise-videos').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch { return null; }
}

// `uploaded` means a client can actually open something. It was hardcoded true
// for every item, so a library entry with no clip and no link still rendered
// as "Live" and counted toward "N of M recorded" - the figure was always M of M
// and the "not recorded yet" branch in videos.tsx was unreachable.
const rowToItem = (r: any): VideoItem => ({ id: 'db' + r.id, name: r.name, group: r.muscle_group || 'Uncategorised', dur: r.url ? 'clip' : 'link', uploaded: !!r.url, url: r.url || undefined });

export function useExerciseVideos() {
  const [added, setAdded] = useState<VideoItem[]>([]);
  const [remote, setRemote] = useState<VideoItem[]>([]);

  const load = useCallback(async () => {
    try { const raw = await AsyncStorage.getItem(KEY); if (raw) setAdded(JSON.parse(raw)); } catch { /* ignore */ }
    if (USE_SUPABASE) {
      try {
        const { data } = await supabase.from('exercise_videos').select('*').order('created_at', { ascending: false });
        if (Array.isArray(data)) setRemote(data.map(rowToItem));
      } catch { /* stay on local */ }
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const persist = (next: VideoItem[]) => {
    setAdded(next);
    try { AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  /** Returns where it landed: 'remote' is visible to clients on any device,
   *  'local' is this phone only. videos.tsx used to announce the former in
   *  both cases, because it branched on a build flag rather than the result. */
  const addVideo = async (v: { name: string; group?: string; url?: string }): Promise<'remote' | 'local' | 'none'> => {
    const name = (v.name || '').trim(); if (!name) return 'none';
    const group = (v.group || 'Uncategorised').trim() || 'Uncategorised';
    if (USE_SUPABASE) {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (uid) {
          const { data } = await supabase.from('exercise_videos').insert({ trainer_id: uid, name, muscle_group: group, url: v.url || null }).select().single();
          if (data) { setRemote((p) => [rowToItem(data), ...p]); return 'remote'; }
        }
      } catch { /* fall through to local */ }
    }
    const item: VideoItem = { id: 'vx' + Date.now().toString(36) + SEQ++, name, group, dur: v.url ? 'link' : 'clip', uploaded: !!v.url?.trim(), url: v.url?.trim() || undefined };
    persist([item, ...added]);
    return 'local';
  };

  const removeVideo = (id: string) => {
    if (id.startsWith('db')) {
      if (USE_SUPABASE) { try { supabase.from('exercise_videos').delete().eq('id', id.slice(2)).then(() => {}, () => {}); } catch { /* ignore */ } }
      setRemote((p) => p.filter((x) => x.id !== id));
      return;
    }
    persist(added.filter((x) => x.id !== id));
  };

  const videos: VideoItem[] = [...remote, ...added];
  return { videos, addVideo, removeVideo, reload: load };
}
