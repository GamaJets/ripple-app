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
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { shapeSeries, type RecurringSeries, type RawSeries } from '../lib/recurring';

export interface AvailSlot { id: string; dow: number; hour: number; minute: number; dur: number }

/** The outcome of `addSlot`. See the note on it for why this is not a boolean. */
export type AddSlotResult = 'saved' | 'duplicate' | 'local';

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
          //
          // The rows come BACK, and that is the fix rather than a tidy-up. The
          // insert used to discard them, so the slots on screen kept the local
          // ids they were created with — and `removeSlot` treats an id with no
          // dash as one that never reached the server and deletes it locally
          // only. So a coach who set their week offline, came back into signal,
          // and then removed a Tuesday had it deleted from the phone, left on
          // the server, and read back onto the phone at the next launch. The
          // slot they had closed kept re-appearing, and the sessions generated
          // from it were real.
          const { data: up, error: upErr } = await supabase.from('trainer_availability')
            .insert(local.map((sl) => ({ trainer_id: u, dow: sl.dow, hour: sl.hour, minute: Number(sl.minute) || 0, dur: sl.dur })))
            .select('id, dow, hour, minute, dur');
          if (cancelled) return;
          if (upErr || !up) { setStatus('error'); return; }
          const synced: AvailSlot[] = up.map((r: any) => ({ id: String(r.id), dow: r.dow, hour: r.hour, minute: Number(r.minute) || 0, dur: r.dur })).sort(byTime);
          setSlots(synced);
          try { AsyncStorage.setItem(KEY, JSON.stringify(synced)); } catch { /* the slots are correct this session either way */ }
          setStatus('ready');
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

  /** What happened to a weekly slot the coach just added.
   *
   *  This used to be a bare `Promise<boolean>` and the one caller ignored it,
   *  which was reasonable of them: `false` was returned for three different
   *  things — the slot is already in the list, the slot is on this phone but not
   *  on the server, and there is nobody signed in — and only one sentence could
   *  ever have been written about all three. So nothing was said at all, and a
   *  weekly slot that never reached the server sat in the sheet looking saved.
   *  It is the template the coach generates their month from, so a slot that is
   *  only on this phone is four sessions that never open.
   *
   *  'saved'     the slot is on the server, where the generator and the coach's
   *              other devices can see it.
   *  'duplicate' they already offer that day and time; nothing changed.
   *  'local'     it is on this phone only. Kept and shown, because a coach in a
   *              basement gym still gets to write their week down — but not
   *              claimed as saved. */
  const addSlot = async (dow: number, hour: number, minute: number, dur: number): Promise<AddSlotResult> => {
    // The duplicate check runs on the minute as well. On the hour alone it
    // refused a coach who already offered 9:00 from adding 9:30 — silently,
    // since the caller only sees false, which also means "saved on this phone
    // only". A unique index says the same thing server-side so two of their
    // devices cannot race past it.
    if (slots.some((s) => s.dow === dow && s.hour === hour && s.minute === minute)) return 'duplicate';
    const localId = 'av' + Date.now().toString(36) + SEQ++;
    persist([...slots, { id: localId, dow, hour, minute, dur }]);
    if (!USE_SUPABASE || !uid) return 'local';
    try {
      const { data, error } = await supabase.from('trainer_availability').insert({ trainer_id: uid, dow, hour, minute, dur }).select('id').single();
      const sid = data?.id;
      if (error || !sid) return 'local';
      setSlots((p) => p.map((sl) => (sl.id === localId ? { ...sl, id: String(sid) } : sl)));
      return 'saved';
    } catch { return 'local'; }
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

/* ── Standing appointments ──────────────────────────────────────────────────
 *
 * The weekly template above is AVAILABILITY: "I am free on Tuesdays at seven",
 * turned into concrete open slots by a Generate button somebody has to press
 * again every month. It is the right shape for what it describes and it cannot
 * describe a standing appointment — "Ana trains with me at seven every Tuesday"
 * — which is the single most common fact about a personal trainer's week.
 *
 * `session_series` (supabase/parts/135) is that. A daily job materialises it
 * eight weeks ahead, so nobody re-taps anything, and each occurrence is an
 * ordinary booked session: the same waitlist, the same notice window, the same
 * fee, the same exclusion constraint.
 *
 * These live here rather than in src/ui/sessions.tsx because a series is an
 * arrangement about the WEEK, which is what this file is about, and because
 * sessions.tsx already owns the concrete calendar the arrangement produces.
 */

/** What `create_session_series` did. `skipped` is not a failure — see the note
 *  on clashes in part 135 — and `clashedOn` is what makes it actionable. */
export interface SeriesCreated {
  seriesId: string;
  created: number;
  skipped: number;
  clashedOn: string[];
}

/** What `end_session_series` did. `charged` is read from the server rather than
 *  assumed, and the server states it as false: ending a standing appointment
 *  never prices a cancellation. */
export interface SeriesEnded {
  removed: number;
  leftStanding: number;
  effectiveOn: string | null;
  charged: boolean;
}

/**
 * The zone the local hour on a series is an hour IN.
 *
 * Null rather than a guess when the runtime cannot say. A series stored against
 * the wrong zone is an appointment at seven in the morning somewhere nobody
 * involved lives, and defaulting to UTC would produce exactly that silently —
 * so the caller refuses to create one instead, and says why.
 */
export function deviceTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.includes('/') ? tz : null;
  } catch { return null; }
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Every standing appointment the signed-in person is a party to.
 *
 * One hook for both apps: `my_session_series()` returns the coach's and the
 * client's from the same definer function, scoped by auth.uid(), so the coach
 * screen and the client screen cannot come to disagree about what was agreed.
 *
 * `status` is the ordinary discipline. An empty list under 'error' means the
 * arrangements could not be READ, not that there are none — and "you have no
 * standing appointments" said to somebody who trains every Tuesday is exactly
 * the class of sentence this codebase keeps having to take back.
 */
export function useRecurringSeries() {
  const authRev = useAuthRevision();
  const [series, setSeries] = useState<RecurringSeries[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const reload = useCallback(async () => {
    // A series only exists on the server. There is no local fallback to show,
    // and 'ready' over an empty list is honest here: with the backend off there
    // is nothing that could have one.
    if (!USE_SUPABASE) { setSeries([]); setStatus('ready'); return; }
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) { setSeries([]); setStatus('ready'); return; }
      const { data, error } = await supabase.rpc('my_session_series');
      if (error) { setStatus('error'); return; }
      setSeries(shapeSeries((data ?? []) as RawSeries[]));
      setStatus('ready');
    } catch { setStatus('error'); }
  }, []);

  useEffect(() => { reload(); }, [authRev, reload]);

  /**
   * Agree a standing appointment. The coach's call — `create_session_series`
   * refuses anybody who is not the client's coach with 42501.
   *
   * Resolves an error string rather than throwing, because every refusal here
   * has a sentence a coach can act on: they are not your client, that is not a
   * zone this server knows, this device cannot tell us what zone it is in.
   */
  const create = useCallback(async (o: {
    clientId: string; dow: number; hour: number; minute: number; durationMin: number;
    startsOn?: string | null; endsOn?: string | null;
  }): Promise<{ ok: true; report: SeriesCreated } | { ok: false; error: string }> => {
    if (!USE_SUPABASE) {
      return { ok: false, error: 'This build is running without the server, and a standing appointment lives on it.' };
    }
    const tz = deviceTimeZone();
    if (!tz) {
      return { ok: false, error: 'This device can’t say what time zone it is in, and a weekly appointment has to be stored against one. Set the zone in your phone’s settings and try again.' };
    }
    try {
      const { data, error } = await supabase.rpc('create_session_series', {
        p_client: o.clientId, p_dow: o.dow, p_hour: o.hour, p_minute: o.minute,
        p_duration: o.durationMin, p_tz: tz,
        p_starts_on: o.startsOn ?? null, p_ends_on: o.endsOn ?? null,
      });
      if (error || !data) return { ok: false, error: error?.message ?? 'That standing appointment was not created.' };
      const d = data as any;
      await reload();
      return {
        ok: true,
        report: {
          seriesId: String(d.series_id),
          created: toNum(d.created),
          skipped: toNum(d.skipped),
          clashedOn: Array.isArray(d.clashed_on) ? d.clashed_on.map(String) : [],
        },
      };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'That standing appointment was not created.' };
    }
  }, [reload]);

  /**
   * End it. Either party may — an agreement one side cannot leave is not one.
   *
   * THIS IS NOT A CANCELLATION AND IT NEVER RAISES A FEE. See the long note on
   * `end_session_series` in part 135 and `cancelOptions` in src/lib/recurring.ts:
   * the implementation that loops the occurrences and cancels each of them bills
   * somebody a late fee for a year of sessions, and `charged` comes back from
   * the server stated as false so no screen has to take this comment's word for
   * it.
   */
  const end = useCallback(async (seriesId: string, effectiveOn?: string | null):
  Promise<{ ok: true; report: SeriesEnded } | { ok: false; error: string }> => {
    if (!USE_SUPABASE) {
      return { ok: false, error: 'This build is running without the server, and a standing appointment lives on it.' };
    }
    try {
      const { data, error } = await supabase.rpc('end_session_series', {
        p_series: seriesId, p_effective: effectiveOn ?? null,
      });
      if (error || !data) return { ok: false, error: error?.message ?? 'That standing appointment is still running.' };
      const d = data as any;
      await reload();
      return {
        ok: true,
        report: {
          removed: toNum(d.removed),
          leftStanding: toNum(d.left_standing),
          effectiveOn: d.effective_on ? String(d.effective_on) : null,
          charged: !!d.charged,
        },
      };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'That standing appointment is still running.' };
    }
  }, [reload]);

  return { series, status, reload, create, end };
}
