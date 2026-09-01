// The member's own attendance, read once and reduced to the shapes a screen
// can render without making a decision the record does not support.
//
// A hook rather than a provider: one screen wants it, it is three reads, and
// nothing else in the app needs to hold it open. src/ui/classes.tsx is the
// provider for the timetable and deliberately does not grow this — it reads
// only classes that have NOT finished (`gte('starts_at', nowIso)`), which is
// the opposite half of the schedule from the one this is about, and folding a
// backwards-looking history into a forwards-looking booking store would put
// every past class into the list a member books from.
//
// ── Why `status` is not a formality here ───────────────────────────────────
//
// Everything on this screen is a claim about somebody's own history, and the
// empty-list sentence — "you have not been in" — is the exact sentence
// src/ui/loadStatus.ts was written about. Under 'error' the rows are UNKNOWN,
// not absent, and the screen must say so; under 'partial' the rows are real and
// no rate may be computed from them. Both are carried here rather than left to
// the screen to infer from an array length.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';
import { cacheKey, cachedAtLine, packCache, readCache, withinHorizon } from '../lib/readCache';
import {
  fetchMyAttendance, mergeAttendance, attendedDays, rhythm, localDay,
  type AttendanceEvent, type Rhythm,
} from '../lib/attendance';

/** Where this device keeps the member's own attendance. Two keys, because the
 *  undated events are a separate list that must never be folded into the dated
 *  one — see rule 3 in src/lib/attendance.ts. */
const ATT_SCOPE = 'attendance';
const ATT_UNDATED_SCOPE = 'attendanceUndated';

/** Weeks drawn on the rhythm strip. Twelve is a quarter — long enough to show a
 *  habit forming or stopping, short enough that every bar fits on a phone. */
export const RHYTHM_WEEKS = 12;

export interface MyAttendance {
  status: LoadStatus;
  /** Newest first. Under 'error' this is whatever we had before the failure. */
  events: AttendanceEvent[];
  /** Events we hold and cannot place in time — see rule 3 in src/lib/attendance.ts.
   *  Never merged into `events`, never dropped. */
  undated: AttendanceEvent[];
  /** Distinct local days the record proves they were at a gym. */
  days: string[];
  /** Weekly picture. `perWeek` is null unless the read was whole. */
  rhythm: Rhythm;
  /** False when at least one class row did not come back, so some event on
   *  screen is unlabelled. The screen says which, rather than showing a blank. */
  classesComplete: boolean;
  /**
   * The sentence for a history that came off this device rather than off the
   * server, or null when what is on screen was confirmed.
   *
   * Goes with `status === 'error'`. The rule this holds is the one the header
   * states: under 'error' the rows are UNKNOWN. A cached list makes them
   * "what we last saw", which is a better answer than an empty screen and a
   * strictly worse one than a live read — and the member has to be able to tell
   * which they are looking at.
   */
  cachedNote: string | null;
  reload: () => Promise<void>;
}

export function useMyAttendance(): MyAttendance {
  const authRev = useAuthRevision();
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [undated, setUndated] = useState<AttendanceEvent[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [rh, setRh] = useState<Rhythm>({ weeks: [], firstDay: null, countedWeeks: 0, perWeek: null });
  const [classesComplete, setClassesComplete] = useState(true);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  /** True once the server has answered this session, so a later failed reload
   *  does not put an older copy over a confirmed one. */
  const confirmed = useRef(false);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    try {
      // getSession and not getUser: getUser REJECTS when nobody is signed in,
      // and treating that as a failure latches this into 'error' before anybody
      // has logged in. No session is a true answer, and the true answer for a
      // signed-out reader is an empty history rather than a broken one.
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id ?? null;
      if (!uid) {
        setEvents([]); setUndated([]); setDays([]);
        setRh({ weeks: [], firstDay: null, countedWeeks: 0, perWeek: null });
        setStatus('ready');
        return;
      }

      // ── this device's copy, before the network ──────────────────────────
      //
      // A member with no signal could not see their own attendance at the gym
      // they were standing in. `days` and `rhythm` are recomputed from the
      // cached events rather than cached themselves — two copies of one derived
      // figure is how they come to disagree — and the rate is computed as a
      // NOT-whole read, because a cached list is by definition not confirmed to
      // be all of it.
      if (!confirmed.current) {
        try {
          const [rawEv, rawUn] = await Promise.all([
            AsyncStorage.getItem(cacheKey(ATT_SCOPE, uid)),
            AsyncStorage.getItem(cacheKey(ATT_UNDATED_SCOPE, uid)),
          ]);
          const cached = readCache<AttendanceEvent>(rawEv);
          if (cached.rows && cached.rows.length && withinHorizon(cached.at)) {
            const cachedUndated = readCache<AttendanceEvent>(rawUn);
            const cd = attendedDays(cached.rows);
            const cToday = localDay(new Date().toISOString());
            setEvents(cached.rows);
            setUndated(cachedUndated.rows ?? []);
            setDays(cd);
            setRh(rhythm(cd, cToday ?? '', RHYTHM_WEEKS, false));
            setCachedAt(cached.at);
          }
        } catch { /* no usable cache; the read below is the only source */ }
      }

      const res = await fetchMyAttendance(supabase, uid);
      if (!res.ok) {
        reportError('attendance.read', new Error(res.reason));
        // Deliberately NOT clearing what is on screen. Under 'error' the last
        // thing we knew beats replacing somebody's training history with
        // nothing at the moment their signal drops — and the screen's banner
        // says it is not confirmed current.
        setStatus('error');
        return;
      }

      const now = new Date();
      const { events: ev, undated: un } = mergeAttendance(
        res.value.bookings, res.value.visits, res.value.classes, now,
      );
      const d = attendedDays(ev);
      const today = localDay(now.toISOString());
      setEvents(ev);
      setUndated(un);
      setDays(d);
      // `whole` is the read's own answer, not a guess from the row count. A
      // truncated read yields a list and no rate — src/lib/rowCap.ts.
      setRh(rhythm(d, today ?? '', RHYTHM_WEEKS, !res.value.truncated));
      setClassesComplete(res.value.classesComplete);
      setStatus(res.value.truncated ? 'partial' : 'ready');
      confirmed.current = true;
      setCachedAt(null);
      // Cached only when the read was whole AND every class row came back.
      // A partial history written to this device would be opened, next launch,
      // as the member's whole record — and the one thing this screen must never
      // do is understate how often somebody has been in.
      if (!res.value.truncated && res.value.classesComplete) {
        AsyncStorage.setItem(cacheKey(ATT_SCOPE, uid), packCache(ev))
          .catch(() => { /* the history is right this session either way */ });
        AsyncStorage.setItem(cacheKey(ATT_UNDATED_SCOPE, uid), packCache(un))
          .catch(() => { /* as above */ });
      }
    } catch (e) {
      reportError('attendance.read', e);
      setStatus('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load, authRev]);

  return { status, events, undated, days, rhythm: rh, classesComplete, cachedNote: cachedAtLine(cachedAt), reload: load };
}
