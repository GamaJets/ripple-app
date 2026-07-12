// Shared exercise-video library. The trainer adds clips (by link, or a recorded/
// picked file placeholder) and they flow to the client's Exercise Library. Both
// sides read this AsyncStorage-backed store, so a trainer's addition shows up for
// clients (re-read on screen mount). Real device upload + transcode + hosting is
// a native/backend step; attaching a hosted link works today over-the-air.
import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EX_VIDEOS, type ExVideo } from '../lib/trainerMock';

export interface VideoItem extends ExVideo { url?: string }

const KEY = 'repple.exerciseVideos';
let SEQ = 1;

export function useExerciseVideos() {
  const [added, setAdded] = useState<VideoItem[]>([]);

  const load = useCallback(async () => {
    try { const raw = await AsyncStorage.getItem(KEY); if (raw) setAdded(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const persist = (next: VideoItem[]) => {
    setAdded(next);
    try { AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const addVideo = (v: { name: string; group?: string; url?: string }) => {
    const name = (v.name || '').trim(); if (!name) return;
    const item: VideoItem = {
      id: 'vx' + Date.now().toString(36) + SEQ++, name,
      group: (v.group || 'Uncategorised').trim() || 'Uncategorised',
      dur: v.url ? 'link' : 'clip', uploaded: true, url: v.url?.trim() || undefined,
    };
    persist([item, ...added]);
  };
  const removeVideo = (id: string) => persist(added.filter((x) => x.id !== id));

  // Coach's additions first, then the seed library.
  const videos: VideoItem[] = [...added, ...(EX_VIDEOS as VideoItem[])];
  return { videos, addVideo, removeVideo, reload: load };
}
