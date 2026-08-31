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
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';

export interface AvailSlot { id: string; dow: number; hour: number; minute: number; dur: number }

/** Slot ordering, in one place: day, then hour, then minute. Written once
 *  because it is applied in four (the server read, `persist`, and both sorts
 *  that used to stop at the hour and therefore shuffled 9:45 above 9:15). */
const byTime = (a: AvailSlot, b: AvailSlot) => a.dow - b.dow || a.hour - b.hour || a.minute - b.minute;

const KEY = 'repple.trainer.availability';
let SEQ = 1;

export function useAvailability() {
  const authRev = useAuthRevision();
  const [slots, setSlots] = useState<AvailSlot[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let local: AvailSlot[] = [];
      // The cached copy predates `minute`, so every slot in it is on the hour.
      // Normalised on the way in rather than trusted, for the same reason the
      // server rows are.
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          local = (JSON.parse(raw) as AvailSlot[]).map((sl) => ({ ...sl, minute: Number(sl.minute) || 0 }));
          if (!cancelled) setSlots(local);
        }
      } catch { /* no cached copy; the server read below is the only source */ }
      // Local-only build: this device IS the store, so what is on screen is
      // authoritative and there is no absent server to misreport.
      if (!USE_SUPABASE) { if (!cancelled) setStatus('ready'); return; }
      // Durable server copy (session-9 SQL): server wins; if the server is empty
      // but this device has slots, push them up (recovers pre-sync schedules).
      try {
        // No session is a true answer, not a failed check. getUser() REJECTS
        // when nobody is signed in, and treating that as an error latched this
        // provider into 'error' on the first tick — before anybody had signed
        // in — where it stayed, because the effect never ran a second time.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const u = auth?.user?.id;
        // Signed out: there is no server copy to be out of step with.
        if (!u) { setStatus('ready'); return; }
        setUid(u);
        // A weekly grid: seven days by twenty-four hours is 168 slots at the
        // absolute most, so this cannot truncate. Capped regardless, because
        // "the table only holds a few rows" is a fact about today's schema that
        // no future writer is obliged to preserve, and the cost of the limit is
        // nothing. `capped()` below is what makes it a claim rather than a hope.
        const { data: rows, error } = await supabase.from('trainer_availability')
          .select('id, dow, hour, minute, dur').eq('trainer_id', u)
          .order('dow', { ascending: true }).order('hour', { ascending: true }).order('minute', { ascending: true })
          .limit(capLimit());
        if (cancelled) return;
        // This early return is the whole bug: the cached slots stayed on screen
        // and nothing recorded that they had not been checked.
        if (error) { setStatus('error'); return; }
        const page = capped(rows);
        if (page.rows.length) {
          // `minute` arrived after this table did, so a row written by an
          // older build has no value for it in an older CACHE either. Null
          // there means on the hour, which is what those rows have always
          // meant — coerced rather than left undefined, because undefined
          // reaches `String(m).padStart` and renders ":NaN".
          const server: AvailSlot[] = page.rows.map((r: any) => ({ id: String(r.id), dow: r.dow, hour: r.hour, minute: Number(r.minute) || 0, dur: r.dur }));
          setSlots(server.sort(byTime));
          // Deliberately not cached when short. This copy is what the coach
          // sees offline, and writing a truncated grid over the good one would
          // turn a temporary gap into the device's idea of their week.
          if (!page.truncated) { try { AsyncStorage.setItem(KEY, JSON.stringify(server)); } catch { /* the slots are correct this session either way */ } }
          setStatus(page.truncated ? 'partial' : 'ready');
        } else if (local.length) {
          // Server has nothing, this device does: push the device copy up. Until
          // that insert lands the local slots are still unconfirmed, so a
          // failure here leaves the status at 'error' rather than 'ready'.
          const { error: upErr } = await supabase.from('trainer_availability').insert(local.map((sl) => ({ trainer_id: u, dow: sl.dow, hour: sl.hour, minute: Number(sl.minute) || 0, dur: sl.dur })));
          setStatus(upErr ? 'error' : 'ready');
        } else {
          // Server confirmed: this coach genuinely has no availability set.
          setStatus('ready');
        }
      } catch { if (!cancelled) setStatus('error'); /* offline: local copy stands, and now says so */ }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const persist = (next: AvailSlot[]) => {
    const sorted = [...next].sort(byTime);
    setSlots(sorted);
    try { AsyncStorage.setItem(KEY, JSON.stringify(sorted)); } catch { /* ignore */ }
  };

  /** Resolves true only once the slot is on the server, where the coach's other
   *  devices and the session generator will see it. False means this phone only. */
  const addSlot = async (dow: number, hour: number, minute: number, dur: number): Promise<boolean> => {
    // The duplicate check runs on the minute as well. On the hour alone it
    // refused a coach who already offered 9:00 from adding 9:30 — silently,
    // since the caller only sees false, which also means "saved on this phone
    // only". A unique index says the same thing server-side so two of their
    // devices cannot race past it.
    if (slots.some((s) => s.dow === dow && s.hour === hour && s.minute === minute)) return false;
    const localId = 'av' + Date.now().toString(36) + SEQ++;
    persist([...slots, { id: localId, dow, hour, minute, dur }]);
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { data, error } = await supabase.from('trainer_availability').insert({ trainer_id: uid, dow, hour, minute, dur }).select('id').single();
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

/** Concrete dates for a weekly slot over the next `weeks` weeks (from today).
 *
 *  `minute` defaults to 0 so that a caller written before quarter hours
 *  existed still produces the on-the-hour dates it always did. */
export function upcomingDates(dow: number, hour: number, minute = 0, weeks = 4, from = new Date()): Date[] {
  const out: Date[] = [];
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cand = new Date(base);
      cand.setDate(base.getDate() + w * 7 + d);
      if (cand.getDay() === dow) {
        cand.setHours(hour, minute, 0, 0);
        if (cand.getTime() > from.getTime()) out.push(cand);
        break;
      }
    }
  }
  return out;
}
