// Trainer weekly availability template. A set of recurring day-of-week + hour
// slots the coach offers every week; "generate" turns them into concrete open
// sessions for the next few weeks. Persists to AsyncStorage (per device). Kept
// as a self-contained hook so it needs no provider wiring.
//
// ── The cache that could not say it was stale ──────────────────────────────
//
// This hook shows the device's saved copy first, then refreshes from the server.
// That order is right: a coach in a basement gym still sees their week. What was
// wrong is that after a FAILED refresh the local copy stayed on screen looking
// exactly as current as a confirmed one — same slots, same styling, no marker —
// and the coach then acted on it. They told a client "Tuesday 7am is free" from
// a copy of their schedule that predated the change on the server, or generated
// concrete sessions from stale slots.
//
// Nothing about the fallback changes. `status` simply says which copy you are
// looking at: 'ready' means the server confirmed these slots, 'error' means
// these came off this device and could not be checked.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';

export interface AvailSlot { id: string; dow: number; hour: number; dur: number }

const KEY = 'repple.trainer.availability';
let SEQ = 1;

export function useAvailability() {
  const [slots, setSlots] = useState<AvailSlot[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let local: AvailSlot[] = [];
      try { const raw = await AsyncStorage.getItem(KEY); if (raw) { local = JSON.parse(raw); if (!cancelled) setSlots(local); } } catch { /* no cached copy; the server read below is the only source */ }
      // Local-only build: this device IS the store, so what is on screen is
      // authoritative and there is no absent server to misreport.
      if (!USE_SUPABASE) { if (!cancelled) setStatus('ready'); return; }
      // Durable server copy (session-9 SQL): server wins; if the server is empty
      // but this device has slots, push them up (recovers pre-sync schedules).
      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const u = auth?.user?.id;
        // Signed out: there is no server copy to be out of step with.
        if (!u) { setStatus('ready'); return; }
        setUid(u);
        const { data: rows, error } = await supabase.from('trainer_availability').select('id, dow, hour, dur').eq('trainer_id', u).order('dow', { ascending: true });
        if (cancelled) return;
        // This early return is the whole bug: the cached slots stayed on screen
        // and nothing recorded that they had not been checked.
        if (error) { setStatus('error'); return; }
        if (rows && rows.length) {
          const server: AvailSlot[] = rows.map((r: any) => ({ id: String(r.id), dow: r.dow, hour: r.hour, dur: r.dur }));
          setSlots(server.sort((a, b) => a.dow - b.dow || a.hour - b.hour));
          try { AsyncStorage.setItem(KEY, JSON.stringify(server)); } catch { /* the slots are correct this session either way */ }
          setStatus('ready');
        } else if (local.length) {
          // Server has nothing, this device does: push the device copy up. Until
          // that insert lands the local slots are still unconfirmed, so a
          // failure here leaves the status at 'error' rather than 'ready'.
          const { error: upErr } = await supabase.from('trainer_availability').insert(local.map((sl) => ({ trainer_id: u, dow: sl.dow, hour: sl.hour, dur: sl.dur })));
          setStatus(upErr ? 'error' : 'ready');
        } else {
          // Server confirmed: this coach genuinely has no availability set.
          setStatus('ready');
        }
      } catch { if (!cancelled) setStatus('error'); /* offline: local copy stands, and now says so */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = (next: AvailSlot[]) => {
    const sorted = [...next].sort((a, b) => a.dow - b.dow || a.hour - b.hour);
    setSlots(sorted);
    try { AsyncStorage.setItem(KEY, JSON.stringify(sorted)); } catch { /* ignore */ }
  };

  /** Resolves true only once the slot is on the server, where the coach's other
   *  devices and the session generator will see it. False means this phone only. */
  const addSlot = async (dow: number, hour: number, dur: number): Promise<boolean> => {
    if (slots.some((s) => s.dow === dow && s.hour === hour)) return false; // no dup
    const localId = 'av' + Date.now().toString(36) + SEQ++;
    persist([...slots, { id: localId, dow, hour, dur }]);
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { data, error } = await supabase.from('trainer_availability').insert({ trainer_id: uid, dow, hour, dur }).select('id').single();
      const sid = data?.id;
      if (error || !sid) return false;
      setSlots((p) => p.map((sl) => (sl.id === localId ? { ...sl, id: String(sid) } : sl)));
      return true;
    } catch { return false; }
  };
  /** Resolves true only when the slot is gone server-side. A refused delete
   *  leaves the coach bookable at an hour they thought they had closed. */
  const removeSlot = async (id: string): Promise<boolean> => {
    persist(slots.filter((s) => s.id !== id));
    // A local id never reached the server, so dropping it locally is the whole
    // of the removal.
    if (!USE_SUPABASE || !id.includes('-')) return true;
    try {
      const { error } = await supabase.from('trainer_availability').delete().eq('id', id);
      return !error;
    } catch { return false; }
  };

  return { slots, status, addSlot, removeSlot };
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
