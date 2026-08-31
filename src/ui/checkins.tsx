// Weekly check-ins. Client submits weight + energy/sleep/mood/adherence + a note;
// the coach sees the latest on the client detail. Persists to Supabase per user,
// and to this device, so one written with no signal is still there tomorrow.
//
// A check-in is the one thing in this app that BOTH sides read: the client sees
// their own history, the coach sees `latest` on the client detail and judges
// adherence from it. A failed read produced `checkins: []` and therefore
// `latest: null`, which the coach's screen renders as "no check-ins yet" — a
// client who has checked in every week for a month can be shown to their coach
// as someone who has never once bothered. `status` is what stops that being
// stated as fact.
//
// ── The other half: it was thrown away rather than kept ────────────────────
//
// Nothing here was written to the device. A check-in composed with no signal
// went into a useState, the insert failed, and app/(client)/checkin.tsx said
// the honest thing — "the rest of this week — energy, sleep, mood, adherence
// and your note — is not saved anywhere" — and it was right, which is the
// problem. This is a form somebody sits down and fills in once a week, with a
// written note to their coach in it. Telling them to type it again because the
// gym has no reception is not a graceful degradation, it is the app losing
// their work and admitting it politely.
//
// It now follows the shape src/ui/availability.ts settled on and
// src/ui/wellness.tsx rebuilt on: the device's saved copy goes on screen first,
// the server refreshes it, and `status` says which of the two is being looked
// at. A check-in written offline keeps its place under a `local:` id (see
// src/lib/wellnessSync.ts) and goes up on the next launch that reaches a
// server.
//
// ── What a pending check-in must never be allowed to imply ─────────────────
//
// That the coach has seen it. `latest` is read on the coach's own screens, and
// the whole point of filling this in is that somebody else reads it. So
// `unsent` is here, `latestSent` is separate from `latest`, and the client
// screen says "saved on this phone, not sent yet" rather than "your coach can
// see this week's check-in" — which is the sentence a person acts on by not
// sending it again.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { adoptServerId, isPending, localId, mergeLog } from '../lib/wellnessSync';
import { classifyWrite, serverRows, type WriteOutcome } from '../lib/offlineQueue';
import { useAuthRevision } from './authRevision';

export interface CheckIn {
  id: string; at: string;
  weightKg: number; energy: number; sleep: number; mood: number; adherence: number; note: string;
}

interface CheckInsValue {
  checkins: CheckIn[];
  latest: CheckIn | null;
  /** The most recent check-in the SERVER holds — the one a coach could actually
   *  have read. Separate from `latest`, which may be a pending one this phone
   *  is still carrying, because "your coach has this" and "you have written
   *  this" are different claims and only one of them is safe to make. */
  latestSent: CheckIn | null;
  /** Whether `checkins` is the server's answer. Under 'error' a null `latest`
   *  means unknown, and no screen should read it as "never checked in". */
  status: LoadStatus;
  /**
   * Resolves true only once the check-in is on the server, where the coach can
   * read it.
   *
   * False no longer means it is gone. It means the coach has not got it: it is
   * on this phone, in the history, counted in `unsent`, and it goes up on the
   * next launch that reaches a server. `sendCheckIn` says which of the two
   * kinds of false it was.
   */
  addCheckIn: (c: Omit<CheckIn, 'id' | 'at'>) => Promise<boolean>;
  /**
   * The same write, with the outcome it actually had.
   *
   * 'stored'  the server holds it and the coach can read it.
   * 'unsent'  nobody answered. Kept, counted, and sent on the next launch.
   * 'refused' the server read it and declined — a constraint, a policy. It is
   *           NOT kept, because the same row will be refused every time it is
   *           offered, and the caller has to say it was not saved.
   */
  sendCheckIn: (c: Omit<CheckIn, 'id' | 'at'>) => Promise<WriteOutcome>;
  /** How many check-ins are on this phone and nowhere else. */
  unsent: number;
}

/** Per-account. A check-in carries a weight, a mood and a note to a named
 *  coach; caching it under one key on a shared gym phone would put one
 *  client's week in front of the next person to sign in. */
const cacheKey = (uid: string) => `repple.checkins:${uid}`;

const rowToCI = (r: any): CheckIn => ({
  id: String(r.id), at: String(r.at ?? new Date().toISOString()),
  weightKg: Number(r.weight_kg ?? r.weightKg) || 0,
  energy: Number(r.energy) || 0, sleep: Number(r.sleep) || 0,
  mood: Number(r.mood) || 0, adherence: Number(r.adherence) || 0,
  note: String(r.note ?? ''),
});
const ciToRow = (uid: string, c: CheckIn) => ({ user_id: uid, at: c.at, weight_kg: c.weightKg, energy: c.energy, sleep: c.sleep, mood: c.mood, adherence: c.adherence, note: c.note });

const Ctx = createContext<CheckInsValue | null>(null);

export function CheckInsProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [checkins, setCheckinsState] = useState<CheckIn[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  // The list as it stands right now, for the async paths. Every mutation goes
  // through `setCheckins`, which writes the ref and the state together, so an
  // insert resolving three seconds from now merges into what is actually on
  // screen. A functional updater is the wrong place for a network call or a
  // cache write: React double-invokes updaters in development and both would
  // fire twice.
  const listRef = useRef<CheckIn[]>([]);
  const uidRef = useRef<string | null>(null);
  // False once a read has come back truncated. Writing a short history over the
  // good cached one would turn a temporary gap into this device's idea of how
  // often the client has checked in — the same reasoning availability.ts gives
  // for not caching a truncated week.
  const cacheable = useRef(true);

  const setCheckins = (next: CheckIn[], owner: string | null) => {
    listRef.current = next;
    setCheckinsState(next);
    if (owner && cacheable.current) {
      // Cached in the app's own shape, not the row's. `rowToCI` reads both
      // (`weight_kg ?? weightKg`) so a cache written by either is readable, but
      // round-tripping through the row shape here would mean a third place that
      // has to agree about the column names for no gain.
      AsyncStorage.setItem(cacheKey(owner), JSON.stringify(next))
        .catch(() => { /* the history is correct this session either way */ });
    }
  };

  /**
   * Write one check-in and adopt the id the server gave it.
   *
   * The returned rows are counted, not just `error`. A write PostgREST narrows
   * to zero rows under RLS does not fail — it succeeds having done nothing —
   * and this insert used to check only `error`, so a check-in that no policy
   * would accept was reported to the client as sent to their coach.
   */
  const send = async (owner: string, c: CheckIn): Promise<WriteOutcome> => {
    try {
      const { data, error } = await supabase.from('check_ins').insert(ciToRow(owner, c)).select('id');
      const out = classifyWrite(error as any, data ? data.length : 0);
      if (out !== 'stored') return out;
      setCheckins(adoptServerId(listRef.current, c.id, String(data![0].id)), owner);
      return 'stored';
    } catch { return 'unsent'; }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // No session is a true answer, not a failed check. getUser() REJECTS when
      // nobody is signed in, and treating that as an error latched this provider
      // into 'error' on the first tick — before anybody had signed in — where it
      // stayed, because the effect never ran a second time.
      let id: string | null = null;
      try {
        const { data: sess } = await supabase.auth.getSession();
        id = sess?.session?.user?.id ?? null;
      } catch { /* no local session; treated as signed out below */ }
      if (cancelled) return;

      cacheable.current = true;

      // Signed out, or a build with no backend: nothing is read from the cache,
      // because a cache key needs an account. What is on screen is
      // authoritative and there is no absent server to misreport.
      if (!id || !USE_SUPABASE) {
        uidRef.current = null; setUid(null);
        setCheckins([], null); setStatus('ready'); return;
      }
      uidRef.current = id;
      setUid(id);

      // The device's copy, first and fast. This is what a client in a basement
      // gym sees, and it goes up before the network is even attempted.
      let local: CheckIn[] = [];
      try {
        const raw = await AsyncStorage.getItem(cacheKey(id));
        if (raw) local = (JSON.parse(raw) as any[]).map(rowToCI);
      } catch { /* no usable cache; the server read below is the only source */ }
      if (cancelled) return;
      if (local.length) setCheckins(mergeLog<CheckIn>(null, local).entries, null);

      try {
        // Newest-first and capped. Daily check-ins reach a thousand rows in under
        // three years of the habit this app is built to encourage, and the coach's
        // adherence figure is an average over whatever came back.
        const { data, error } = await supabase.from('check_ins')
          .select('id, at, weight_kg, energy, sleep, mood, adherence, note')
          .eq('user_id', id).order('at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled) return;
        // null when the read failed, [] when this client genuinely has never
        // checked in. Collapsing the two is what turned a dropped connection
        // into "no check-ins yet" on a coach's screen.
        const rows = serverRows<any>(error, data);
        // This early return IS the point. The cached history stays on screen and
        // `status` records that it was not checked.
        if (rows === null) { setStatus('error'); return; }
        const page = capped(rows);
        if (page.truncated) cacheable.current = false;
        // No rows means no check-ins. Show that, do NOT invent one — this used to
        // INSERT a fabricated 68.0 kg check-in into Supabase for every new account,
        // which then persisted forever and drove the trainer's adherence figures.
        // Merged against what is on screen NOW, not against the cache this
        // effect read a moment ago: a check-in submitted while the refresh was
        // still in flight would otherwise be set back out of the list.
        // `listRef` holds `local` already.
        const m = mergeLog<CheckIn>(page.rows.map(rowToCI), listRef.current);
        setCheckins(m.entries, id);
        setStatus(page.truncated ? 'partial' : 'ready');

        // Anything written while offline goes up now — and this is the one in
        // the app with somebody waiting at the other end. A failure here is
        // neither fatal nor silent: it keeps its local id, stays in the
        // history, stays counted in `unsent`, and is tried again next launch.
        for (const c of m.pending) { if (cancelled) return; await send(id, c); }
      } catch { if (!cancelled) setStatus('error'); /* offline: the cached history stands, and now says so */ }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const sendCheckIn: CheckInsValue['sendCheckIn'] = async (c) => {
    const entry: CheckIn = { ...c, id: localId(), at: new Date().toISOString() };
    // Optimistic, and cached immediately — a check-in typed in a changing room
    // has to survive the app being killed before signal comes back.
    setCheckins(mergeLog<CheckIn>(null, [entry, ...listRef.current]).entries, uidRef.current);
    if (!USE_SUPABASE || !uidRef.current) return 'unsent';
    const out = await send(uidRef.current, entry);
    // A refused row will be refused again forever, so it does not sit in the
    // history looking filed. The caller says it was not saved.
    if (out === 'refused') setCheckins(listRef.current.filter((x) => x.id !== entry.id), uidRef.current);
    return out;
  };

  const addCheckIn: CheckInsValue['addCheckIn'] = async (c) => (await sendCheckIn(c)) === 'stored';

  const unsent = useMemo(() => checkins.filter((c) => isPending(c.id)).length, [checkins]);
  // The newest one the server actually holds. `checkins` is newest-first, so
  // this is the first entry that is not still waiting.
  const latestSent = useMemo(() => checkins.find((c) => !isPending(c.id)) ?? null, [checkins]);

  return <Ctx.Provider value={{ checkins, latest: checkins[0] ?? null, latestSent, status, addCheckIn, sendCheckIn, unsent }}>{children}</Ctx.Provider>;
}

export function useCheckIns(): CheckInsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCheckIns must be used inside <CheckInsProvider>');
  return v;
}
