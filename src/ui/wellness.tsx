// Wellness — the sleep log. (Hydration moved to useHabits; see below.)
//
// It starts EMPTY. This provider used to ship two invented sleep nights (7.5h
// and 6.5h, timestamped off Date.now() so they always read as "last night" and
// "the night before"). Recovery rendered them as the client's own history, and
// worse, dashboard.tsx fed the sleep average into readinessScore() — so the
// biggest number on the home screen was computed from two literals.
//
// ── The gap this file used to admit to, and no longer has ──────────────────
//
// The header here read: "Nothing here persists yet: a cup logged now is gone on
// relaunch. That is a gap, but an empty log the user fills is honest, where a
// pre-filled one is not." Both halves were true, and the second half made the
// first one liveable-with for a while. It stopped being liveable-with the
// moment readiness started reading this log, because the consequence is not
// "the Recovery list is short". It is this:
//
//   A client logs seven and a half hours on Monday morning. The home screen
//   computes a readiness score from it and shows them a number. They close the
//   app. They open it at lunchtime and it says "Log a night of sleep to see
//   your readiness" — about the night they just logged, which the app had a
//   figure for an hour ago. Nothing is broken and nothing says anything is
//   wrong; the state simply was not anywhere.
//
// And for a client with no watch or ring, this typed log is the ONLY sleep
// readiness has. src/lib/readiness.ts spends a paragraph explaining that it
// will not fill a missing night with a guess and will shorten its window
// instead — which is right, and which means an evaporating log does not degrade
// the score, it deletes it.
//
// So the nights go to `sleep_logs` now (supabase/parts/109), owner-scoped by
// auth.uid() and readable by nobody else, including the coach. That last part
// is deliberate and the migration argues it at length: device-measured sleep is
// already behind a per-client sharing switch (src/lib/wearables/sleepAccess.ts),
// and granting a blanket read of the TYPED nights would route around that
// switch for the one source a client without a wearable has.
//
// ── It still works with no signal, and now it says so ──────────────────────
//
// The app is used in gyms with no reception and that has to keep being true, so
// this follows the shape src/ui/availability.ts settled on: the device's saved
// copy goes on screen first, the server refreshes it, and `status` says which
// of the two is being looked at. 'ready' means the server confirmed these
// nights. 'error' means these came off this device and could not be checked —
// and, per src/ui/loadStatus.ts, an EMPTY list under 'error' means "we do not
// know what you have logged", never "you have logged nothing".
//
// A night logged offline keeps its place in the list under a `local:` id and is
// pushed up on the next launch that reaches the server. See
// src/lib/wellnessSync.ts for the merge, and for why a failed read (null) must
// not be treated as an empty answer ([]).
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import { adoptServerId, isPending, localId, mergeLog } from '../lib/wellnessSync';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

export interface SleepEntry { id: string; at: string; hours: number; quality: number }

/** Per-account, so signing out and back in as somebody else cannot show one
 *  client another client's nights off this device. `availability.ts` caches
 *  under a single key and has that flaw; a sleep log is more personal than a
 *  weekly grid, and the account id is known before the cache is read because
 *  `getSession()` reads local storage rather than the network. */
const cacheKey = (uid: string) => `repple.sleep:${uid}`;

interface WellnessValue {
  // Hydration used to live here as well, as a plain useState(0): not persisted,
  // and entirely separate from the water counter on the home screen, which is
  // stored per day under repple.water:<date> by useHabits. Adding a glass on
  // one screen left the other unchanged, and Recovery's count reset to zero on
  // every app restart. Both were reported. There is one store now — useHabits —
  // and Recovery reads it directly, so the two screens cannot drift again.
  sleep: SleepEntry[];
  /** Resolves true only once the night is stored server-side. False means the
   *  entry is on this phone and nowhere else — it is still shown, and it will
   *  be sent on the next launch that reaches the server. */
  addSleep: (hours: number, quality: number) => Promise<boolean>;
  /** Whether the nights on screen were confirmed by the server. Under 'error'
   *  an empty list means UNKNOWN and a non-empty one is this device's cached
   *  copy, not a confirmed current one. */
  status: LoadStatus;
  /** How many of `sleep` have not reached the server. Derived from the list
   *  rather than counted alongside it, because a count kept in its own state is
   *  a second answer to the same question and the two drift. */
  unsent: number;
}
const Ctx = createContext<WellnessValue | null>(null);

/** Rows out of `sleep_logs`, defensively. `hours` is numeric in Postgres, which
 *  supabase-js hands back as a string on some paths and a number on others, and
 *  a string reaching `sleep.reduce((a, s) => a + s.hours, 0)` on the Recovery
 *  screen concatenates instead of adding — "07.56.5" rather than 14. */
const rowToEntry = (r: any): SleepEntry => ({
  id: String(r.id),
  at: String(r.at ?? r.created_at ?? new Date().toISOString()),
  hours: Number(r.hours) || 0,
  quality: Number(r.quality) || 0,
});

export function WellnessProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [sleep, setSleepState] = useState<SleepEntry[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  // The list as it stands right now, for the async paths.
  //
  // Every mutation here goes through `setSleep`, which writes the ref and the
  // state together, so `listRef.current` is what an insert that resolves three
  // seconds from now should be merging into. The alternative — a functional
  // updater — is the shape this codebase has twice had to unpick: React
  // double-invokes updaters in development, so a network call or a cache write
  // placed inside one fires twice, and an updater is no place for either. See
  // the notes on toggleHabit and markWaterDone in habits.tsx.
  const listRef = useRef<SleepEntry[]>([]);
  // False once a read has come back truncated. Writing a short log over the
  // good cached one would turn a temporary gap into this device's idea of the
  // client's history — the same reasoning availability.ts gives for not caching
  // a truncated week.
  const cacheable = useRef(true);

  const setSleep = (next: SleepEntry[], owner: string | null) => {
    listRef.current = next;
    setSleepState(next);
    if (owner && cacheable.current) {
      AsyncStorage.setItem(cacheKey(owner), JSON.stringify(next)).catch(() => { /* the nights are correct this session either way */ });
    }
  };

  /** Write one entry and adopt the id the server gave it. Returns false for
   *  every reason the row is not on the server, which the caller reports as
   *  "this phone only" — never as a failure the user has to redo. */
  const send = async (owner: string, e: SleepEntry): Promise<boolean> => {
    try {
      const { data, error } = await supabase.from('sleep_logs')
        .insert({ user_id: owner, at: e.at, hours: e.hours, quality: e.quality })
        .select('id').single();
      const sid = data?.id;
      // `.single()` sets `error` when no row comes back, so a refused insert
      // cannot arrive here looking like a successful one — but `sid` is checked
      // anyway, because adopting `undefined` as an id would quietly turn a
      // pending entry into one nothing will ever retry.
      if (error || !sid) return false;
      setSleep(adoptServerId(listRef.current, e.id, String(sid)), owner);
      return true;
    } catch { return false; }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // No session is a true answer, not a failed check. getUser() REJECTS when
      // nobody is signed in, and treating that as an error latched sibling
      // providers into 'error' on the first tick — before anybody had signed in
      // — where they stayed, because the effect never ran a second time.
      let id: string | null = null;
      try {
        const { data: sess } = await supabase.auth.getSession();
        id = sess?.session?.user?.id ?? null;
      } catch { /* no local session; treated as signed out below */ }
      if (cancelled) return;

      cacheable.current = true;

      // Signed out, or a build with no backend at all: this device IS the
      // store, so what is on screen is authoritative and there is no absent
      // server to misreport. Nothing is read from the cache either — a cache
      // key needs an account, and there is no account.
      if (!id || !USE_SUPABASE) { setUid(null); setSleep([], null); setStatus('ready'); return; }
      setUid(id);

      // The device's copy, first and fast. This is what a client in a basement
      // gym sees, and it goes up before the network is even attempted.
      let local: SleepEntry[] = [];
      try {
        const raw = await AsyncStorage.getItem(cacheKey(id));
        if (raw) local = (JSON.parse(raw) as any[]).map(rowToEntry);
      } catch { /* no usable cache; the server read below is the only source */ }
      if (cancelled) return;
      if (local.length) setSleep(mergeLog<SleepEntry>(null, local).entries, null);

      try {
        const { data, error } = await supabase.from('sleep_logs')
          .select('id, at, hours, quality')
          .eq('user_id', id)
          .order('at', { ascending: false })
          .limit(capLimit());
        if (cancelled) return;
        // This early return IS the point. The cached nights stay on screen and
        // `status` records that they were not checked, rather than the screen
        // presenting a stale copy as a confirmed one.
        if (error) { setStatus('error'); return; }
        const page = capped(data);
        if (page.truncated) cacheable.current = false;
        const m = mergeLog<SleepEntry>(page.rows.map(rowToEntry), local);
        setSleep(m.entries, id);
        setStatus(page.truncated ? 'partial' : 'ready');

        // Anything logged while offline goes up now. A failure here is neither
        // fatal nor silent: the entry keeps its local id, stays in the list,
        // stays counted in `unsent`, and is tried again on the next launch.
        for (const e of m.pending) {
          if (cancelled) return;
          await send(id, e);
        }
      } catch { if (!cancelled) setStatus('error'); /* offline: the cached copy stands, and now says so */ }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const addSleep = async (hours: number, quality: number): Promise<boolean> => {
    // Unchanged from the in-memory version, and load-bearing: tapping "Log
    // Sleep" without touching either control used to file a night the client
    // never had, which then became their sleep average and fed readiness. The
    // screen disables the button for the same reason; this is the second line.
    if (!hours) return false;
    const e: SleepEntry = { id: localId(), at: new Date().toISOString(), hours, quality };
    // Optimistic, and cached immediately — a night logged in a lift has to
    // survive the app being killed before the network ever comes back.
    setSleep(mergeLog<SleepEntry>(null, [e, ...listRef.current]).entries, uid);
    if (!USE_SUPABASE || !uid) return false;
    return send(uid, e);
  };

  const unsent = useMemo(() => sleep.filter((e) => isPending(e.id)).length, [sleep]);

  return <Ctx.Provider value={{ sleep, addSleep, status, unsent }}>{children}</Ctx.Provider>;
}
export function useWellness(): WellnessValue { const v = useContext(Ctx); if (!v) throw new Error('useWellness must be used inside <WellnessProvider>'); return v; }
