// Trainer weekly availability template. A set of recurring day-of-week + hour
// slots the coach offers every week; "generate" turns them into concrete open
// sessions for the next few weeks. Persists to AsyncStorage (per device). Kept
// as a self-contained hook so it needs no provider wiring.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

export interface AvailSlot { id: string; dow: number; hour: number; dur: number }

const KEY = 'repple.trainer.availability';
let SEQ = 1;

export function useAvailability() {
  const [slots, setSlots] = useState<AvailSlot[]>([]);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let local: AvailSlot[] = [];
      try { const raw = await AsyncStorage.getItem(KEY); if (raw) { local = JSON.parse(raw); if (!cancelled) setSlots(local); } } catch { /* ignore */ }
      if (!USE_SUPABASE) return;
      // Durable server copy (session-9 SQL): server wins; if the server is empty
      // but this device has slots, push them up (recovers pre-sync schedules).
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user?.id;
        if (!u || cancelled) return;
        setUid(u);
        const { data: rows, error } = await supabase.from('trainer_availability').select('id, dow, hour, dur').eq('trainer_id', u).order('dow', { ascending: true });
        if (error || cancelled) return;
        if (rows && rows.length) {
          const server: AvailSlot[] = rows.map((r: any) => ({ id: String(r.id), dow: r.dow, hour: r.hour, dur: r.dur }));
          setSlots(server.sort((a, b) => a.dow - b.dow || a.hour - b.hour));
          try { AsyncStorage.setItem(KEY, JSON.stringify(server)); } catch { /* ignore */ }
        } else if (local.length) {
          try { await supabase.from('trainer_availability').insert(local.map((sl) => ({ trainer_id: u, dow: sl.dow, hour: sl.hour, dur: sl.dur }))); } catch { /* ignore */ }
        }
      } catch { /* offline: local copy stands */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = (next: AvailSlot[]) => {
    const sorted = [...next].sort((a, b) => a.dow - b.dow || a.hour - b.hour);
    setSlots(sorted);
    try { AsyncStorage.setItem(KEY, JSON.stringify(sorted)); } catch { /* ignore */ }
  };

  const addSlot = (dow: number, hour: number, dur: number) => {
    if (slots.some((s) => s.dow === dow && s.hour === hour)) return; // no dup
    const localId = 'av' + Date.now().toString(36) + SEQ++;
    persist([...slots, { id: localId, dow, hour, dur }]);
    if (USE_SUPABASE && uid) {
      try {
        supabase.from('trainer_availability').insert({ trainer_id: uid, dow, hour, dur }).select('id').single().then(
          (res: any) => { const sid = res?.data?.id; if (sid) setSlots((p) => p.map((sl) => (sl.id === localId ? { ...sl, id: String(sid) } : sl))); },
          () => { /* keep local */ },
        );
      } catch { /* ignore */ }
    }
  };
  const removeSlot = (id: string) => {
    persist(slots.filter((s) => s.id !== id));
    if (USE_SUPABASE && id.includes('-')) { try { supabase.from('trainer_availability').delete().eq('id', id).then(() => {}, () => {}); } catch { /* ignore */ } }
  };

  return { slots, addSlot, removeSlot };
}

/** Concrete dates for a weekly slot over the next `weeks` weeks (from today). */
export function upcomingDates(dow: number, hour: number, weeks = 4, from = new Date()): Date[] {
  const out: Date[] = [];
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cand = new Date(base);
      cand.setDate(base.getDate() + w * 7 + d);
      if (cand.getDay() === dow) {
        cand.setHours(hour, 0, 0, 0);
        if (cand.getTime() > from.getTime()) out.push(cand);
        break;
      }
    }
  }
  return out;
}
