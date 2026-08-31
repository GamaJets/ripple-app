// Shared food-log store — what the client actually ate today (via photo, barcode,
// AI description, or search), counting toward the day's macros. Persists to
// Supabase `food_logs` per client, and to this device, so a meal logged with no
// signal is still there tomorrow. Shared by the Meals tab and the Food Log screen.
//
// An empty food log is not a neutral fact here: the Meals tab reads `consumed`
// straight into the day's macro rings and the "remaining" figures the client
// eats against. When the hydrate below failed — a refused read, a dropped
// connection in a gym basement — it returned early and left `entries` at `[]`,
// so a client who had logged breakfast and lunch was shown their full day's
// calories still remaining and told to eat them again. `status` is what lets the
// Meals tab say "we couldn't load today's log" instead of "you have eaten
// nothing".
//
// ── The half of that which was still missing ───────────────────────────────
//
// `status` stopped the screen LYING about an unreadable log. It did nothing
// about the log itself, because nothing here was written to the device at all:
// the optimistic entry lived in a useState and the provider's own header said
// so — "it will be gone when you next open the app". A client eating in a gym
// cafe with no reception logged four things, saw them counted, and had them
// deleted by the next launch. That is not a display problem, it is the work.
//
// So this follows the shape src/ui/availability.ts settled on and
// src/ui/wellness.tsx rebuilt on: the device's saved copy goes on screen first,
// the server refreshes it, and `status` says which of the two is being looked
// at. A meal logged offline keeps its place under a `local:` id (see
// src/lib/wellnessSync.ts) and goes up on the next launch that reaches a
// server.
//
// ── Two things this store needs that the sleep log did not ─────────────────
//
// 1. It reads ONE DAY. A meal logged offline at nine on Tuesday night must be
//    sent under Tuesday's timestamp and must NOT be merged into Wednesday's
//    list, where it would eat Wednesday's remaining calories — the one number
//    this screen exists to show. It is held aside (`owedRef`), sent, and never
//    counted against a day it did not happen on. See src/lib/offlineQueue.ts.
//
// 2. Its rows can be REFUSED. `food_logs.via` carries a CHECK constraint, and
//    every AI-described meal used to be rejected by it — indistinguishably,
//    to this file, from being offline. A refused row queued is a row retried on
//    every launch forever and shown to the client as "1 waiting to send" for
//    the life of the install, so a refusal is dropped and said out loud, and
//    only an unanswered write is kept. `classifyWrite` is that distinction.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { FoodFigures } from '../lib/entryEdit';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { isPending, localId, mergeLog } from '../lib/wellnessSync';
import { classifyWrite, forDay, serverRows, staleForDay, todayKey, type WriteOutcome } from '../lib/offlineQueue';
import { useAuthRevision } from './authRevision';

export type LogVia = 'search' | 'barcode' | 'photo' | 'manual';
/** `at` is when it was eaten, and it is on the entry rather than implied by the
 *  read because a queued meal has to be sent under its own time. Without it a
 *  Tuesday dinner that waited for signal arrives on the server stamped
 *  Wednesday and lands in the wrong day's macros. */
export interface FoodEntry { id: string; at: string; name: string; kcal: number; protein: number; carbs: number; fat: number; via: LogVia }

interface FoodLogValue {
  entries: FoodEntry[];
  consumed: { kcal: number; protein: number; carbs: number; fat: number };
  /** Whether today's log is what the server holds. Under 'error' `consumed`
   *  is a floor, not a total — there may be entries we could not read, so
   *  "remaining" is an overestimate and must not be presented as a target. */
  status: LoadStatus;
  /**
   * Resolves true only once the entry is on the server.
   *
   * False no longer means the meal is lost. It means it is on this phone,
   * counted toward today, and either waiting for signal or refused outright —
   * `logFood` says which, and a screen that needs to tell somebody what
   * happened should call that instead. This stays a boolean because four
   * screens outside this file are built on it, and because "is it on the
   * server" remains the honest one-bit answer.
   */
  addFood: (f: Omit<FoodEntry, 'id' | 'at'>) => Promise<boolean>;
  /**
   * The same write, with the outcome it actually had.
   *
   * 'stored'  the server holds it.
   * 'unsent'  nobody answered. It is on the phone, it is counted, it goes up
   *           on the next launch that reaches a server, and it is in `unsent`.
   * 'refused' the server read it and declined. It is NOT kept — offering the
   *           same row to the same constraint again gets the same answer — so
   *           the caller has to say the meal was not logged.
   */
  logFood: (f: Omit<FoodEntry, 'id' | 'at'>) => Promise<WriteOutcome>;
  /** Resolves true only when the row was actually deleted. A refused delete
   *  brings the food back — and its calories with it — after a relaunch. */
  removeFood: (id: string) => Promise<boolean>;
  /**
   * Correct a meal that is already logged — TF-02.
   *
   * There was no update path here at all, so a mistyped 1200 kcal could only be
   * deleted and re-entered, and until somebody did that it went on eating the
   * day's remaining calories. RLS was never the obstacle: `food_owner` on
   * `food_logs` is an ALL policy, so the client could always have written this.
   *
   * Resolves true only once the corrected row is what the server holds. On
   * false NOTHING in `entries` has moved — the old figures are still on screen,
   * still what the server has, and the caller must say the correction did not
   * save rather than leave a number standing that only this phone believes.
   */
  updateFood: (id: string, next: FoodFigures) => Promise<boolean>;
  /** How many entries the server has not accepted yet — today's and any left
   *  over from an earlier day. Derived, never counted alongside the list,
   *  because a count in its own state is a second answer that drifts. */
  unsent: number;
}

/** Per-account, so signing out and back in as somebody else on a shared gym
 *  phone cannot show one client another client's meals — and cannot count
 *  them into their macros, which is the part that would be acted on. */
const cacheKey = (uid: string) => `repple.food:${uid}`;

const startOfTodayISO = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const rowToEntry = (r: any): FoodEntry => ({
  id: String(r.id), at: String(r.at ?? r.logged_at ?? new Date().toISOString()),
  name: r.name, kcal: Math.round(r.kcal ?? 0),
  protein: Math.round(r.protein ?? 0), carbs: Math.round(r.carbs ?? 0), fat: Math.round(r.fat ?? 0),
  via: (['search', 'barcode', 'photo', 'manual'].includes(r.via) ? r.via : 'manual'),
});

/** Oldest first, which is the order a day of meals is eaten in and the order
 *  this screen has always shown. `mergeLog` sorts newest-first — right for a
 *  sleep log, wrong for a diary — and the server read is newest-first too so
 *  that a truncated day keeps the most recent meals rather than the first
 *  four. The reversal is here, once, rather than at each of the three places
 *  the list is set. */
const chron = (list: FoodEntry[]): FoodEntry[] => [...list].reverse();

const Ctx = createContext<FoodLogValue | null>(null);

export function FoodLogProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  // Empty. This held a 130 kcal Greek yogurt marked "via search" that counted
  // into the day's macro rings on every launch. The Supabase hydration below
  // only cleared it on the happy path — signed out, offline, or on any query
  // error the early return left the seed standing, so a meal nobody ate was
  // reported as eaten.
  const [entries, setEntriesState] = useState<FoodEntry[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  // The list as it stands right now, for the async paths. Every mutation goes
  // through `setEntries`, which writes the ref and the state together, so an
  // insert resolving three seconds from now merges into what is actually on
  // screen. The alternative — a functional updater — is the shape this codebase
  // has twice had to unpick: React double-invokes updaters in development, so a
  // network call or a cache write placed inside one fires twice.
  const listRef = useRef<FoodEntry[]>([]);
  // Unsent meals from days that are not today. Not in `entries`, because they
  // are not part of today's macros; not thrown away, because they are the
  // client's work and the server has never heard of them.
  const owedRef = useRef<FoodEntry[]>([]);
  // The same number, in state, because `unsent` is rendered and a ref changing
  // does not re-render anything. Written only beside `owedRef`, never on its
  // own — one fact, two places, and the moment they are set apart they drift.
  const [owedCount, setOwedCount] = useState(0);
  const uidRef = useRef<string | null>(null);
  // False once a read has come back truncated. Writing a short day over the
  // good cached one would turn a temporary gap into this device's idea of what
  // the client ate — the same reasoning availability.ts gives for not caching
  // a truncated week.
  const cacheable = useRef(true);

  /** Today's list plus anything still owed from earlier days, which is what the
   *  cache has to hold: dropping the owed rows on the next write is exactly the
   *  work loss this file was changed to stop. */
  const writeCache = (owner: string | null) => {
    if (!owner || !cacheable.current) return;
    AsyncStorage.setItem(cacheKey(owner), JSON.stringify([...listRef.current, ...owedRef.current]))
      .catch(() => { /* the day is correct this session either way */ });
  };

  const setEntries = (next: FoodEntry[], owner: string | null) => {
    listRef.current = next;
    setEntriesState(next);
    writeCache(owner);
  };

  /**
   * Write one entry and adopt the id the server gave it.
   *
   * The row count is read, not just `error`: a write PostgREST narrows to zero
   * rows under RLS does not fail, it succeeds having done nothing, and
   * `classifyWrite` is where that stops looking like success.
   */
  const send = async (owner: string, e: FoodEntry): Promise<WriteOutcome> => {
    try {
      const { data, error } = await supabase.from('food_logs')
        .insert({ client_id: owner, logged_at: e.at, name: e.name, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, via: e.via })
        .select();
      const out = classifyWrite(error as any, data ? data.length : 0);
      if (out !== 'stored') { if (out === 'refused') reportError('foodLog.add', error); return out; }
      const row = rowToEntry(data![0]);
      // Adopting the server's id AND its figures. The row is what the day is
      // computed from now, and a numeric column that came back rounded
      // differently would otherwise leave the screen and the record disagreeing
      // about a meal nobody touched again.
      setEntries(listRef.current.map((x) => (x.id === e.id ? row : x)), owner);
      return 'stored';
    } catch { return 'unsent'; }
  };

  /** Push one owed entry from an earlier day. It never appears in `entries`, so
   *  it is dropped from `owedRef` on any outcome that is not "still waiting". */
  const sendOwed = async (owner: string, e: FoodEntry): Promise<void> => {
    let out: WriteOutcome = 'unsent';
    try {
      const { data, error } = await supabase.from('food_logs')
        .insert({ client_id: owner, logged_at: e.at, name: e.name, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, via: e.via })
        .select('id');
      out = classifyWrite(error as any, data ? data.length : 0);
      if (out === 'refused') reportError('foodLog.owed', error);
    } catch { out = 'unsent'; }
    if (out === 'unsent') return;
    owedRef.current = owedRef.current.filter((x) => x.id !== e.id);
    setOwedCount(owedRef.current.length);
    writeCache(owner);
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
      // because a cache key needs an account and there is no account. What is on
      // screen is authoritative and there is no absent server to misreport.
      if (!id || !USE_SUPABASE) {
        uidRef.current = null; setUid(null); owedRef.current = [];
        setEntries([], null); setStatus('ready'); return;
      }
      uidRef.current = id;
      setUid(id);

      // The device's copy, first and fast. This is what a client in a basement
      // gym sees, and it goes up before the network is even attempted.
      const day = todayKey();
      let cached: FoodEntry[] = [];
      try {
        const raw = await AsyncStorage.getItem(cacheKey(id));
        if (raw) cached = (JSON.parse(raw) as any[]).map(rowToEntry);
      } catch { /* no usable cache; the server read below is the only source */ }
      if (cancelled) return;
      const localToday = forDay(cached, day);
      // Everything unsent from an earlier day. A stored row from last week is
      // deliberately NOT kept: the server has it, and this cache is not a
      // history — it is what today needs plus what the server has not heard.
      owedRef.current = staleForDay(cached, day, isPending);
      setOwedCount(owedRef.current.length);
      if (localToday.length) setEntries(chron(mergeLog<FoodEntry>(null, localToday).entries), null);

      try {
        const { data, error } = await supabase.from('food_logs')
          .select('id, logged_at, name, kcal, protein, carbs, fat, via')
          .eq('client_id', id).gte('logged_at', startOfTodayISO())
          .order('logged_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled) return;
        // `serverRows` is the whole distinction: null when the read failed, []
        // when the server genuinely holds nothing today. Collapsing the two
        // deletes an offline breakfast the first time signal drops.
        const rows = serverRows<any>(error, data);
        // This early return IS the point. The cached meals stay on screen and
        // `status` records that they were not checked, rather than the screen
        // presenting an unread day as an empty one.
        if (rows === null) { setStatus('error'); return; }
        // Already narrow — one client, one day — so the ceiling is not reachable
        // by anybody eating food. It is capped anyway because the screen adds
        // these rows up into the day's calories and macros, and a total over a
        // truncated set is the one number in this app that must never be
        // guessed: it is what the client eats the rest of the day against.
        const page = capped(rows);
        if (page.truncated) cacheable.current = false;
        // Merged against what is on screen NOW, not against the cache this
        // effect read a moment ago. A client can log a meal while the refresh
        // is still in flight — it is the first thing somebody does on opening
        // this screen — and merging against the older `localToday` would set
        // the list back to a version that predates it, deleting the entry
        // between the tap and the render. `listRef` holds `localToday` already.
        const m = mergeLog<FoodEntry>(page.rows.map(rowToEntry), listRef.current);
        setEntries(chron(m.entries), id);
        setStatus(page.truncated ? 'partial' : 'ready');

        // Anything logged while offline goes up now. A failure here is neither
        // fatal nor silent: the entry keeps its local id, stays in the list,
        // stays counted in `unsent`, and is tried again on the next launch.
        for (const e of m.pending) { if (cancelled) return; await send(id, e); }
        for (const e of [...owedRef.current]) { if (cancelled) return; await sendOwed(id, e); }
      } catch { if (!cancelled) setStatus('error'); /* offline: the cached day stands, and now says so */ }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const logFood: FoodLogValue['logFood'] = async (f) => {
    const entry: FoodEntry = { ...f, id: localId(), at: new Date().toISOString() };
    // Optimistic, and cached immediately — a meal logged in a gym cafe has to
    // survive the app being killed before the network ever comes back.
    setEntries(chron(mergeLog<FoodEntry>(null, [entry, ...listRef.current]).entries), uidRef.current);
    if (!USE_SUPABASE || !uidRef.current) return 'unsent';
    const out = await send(uidRef.current, entry);
    // A refused row will be refused again forever. It comes back off the screen
    // and out of the cache, and the caller says the meal was not logged —
    // rather than counting calories nobody will ever be able to store.
    if (out === 'refused') setEntries(listRef.current.filter((x) => x.id !== entry.id), uidRef.current);
    return out;
  };

  const addFood: FoodLogValue['addFood'] = async (f) => (await logFood(f)) === 'stored';

  const removeFood: FoodLogValue['removeFood'] = async (id) => {
    // A pending id never reached the server, so dropping it locally is the
    // entire removal — here and in `owedRef`, which the screen cannot see but
    // which would otherwise send a meal the client has just deleted.
    if (isPending(id)) {
      owedRef.current = owedRef.current.filter((x) => x.id !== id);
      setOwedCount(owedRef.current.length);
      setEntries(listRef.current.filter((x) => x.id !== id), uidRef.current);
      return true;
    }
    if (!USE_SUPABASE) return false;
    try {
      // The row leaves the screen only once the server says it has gone. It used
      // to leave first, which meant a refused delete took the meal's calories
      // out of the day's rings — the client ate against a total that was wrong
      // until the next launch put the food back with no explanation.
      //
      // Counting the returned rows, not just checking `error`: a DELETE that
      // matched nothing SUCCEEDS in PostgREST, having removed zero rows.
      const { data, error } = await supabase.from('food_logs').delete().eq('id', id).select('id');
      if (error || !data || !data.length) { reportError('foodLog.remove', error); return false; }
      setEntries(listRef.current.filter((x) => x.id !== id), uidRef.current);
      return true;
    } catch (e) { reportError('foodLog.remove', e); return false; }
  };

  const updateFood: FoodLogValue['updateFood'] = async (id, next) => {
    // A pending entry exists on this phone and nowhere else, so editing it here
    // IS the whole edit — and it is the corrected figures that get sent when
    // signal returns, because the queue holds the entry rather than the write.
    if (isPending(id)) {
      owedRef.current = owedRef.current.map((x) => (x.id === id ? { ...x, ...next } : x));
      setEntries(listRef.current.map((x) => (x.id === id ? { ...x, ...next } : x)), uidRef.current);
      return true;
    }
    if (!USE_SUPABASE) return false;
    try {
      // Nothing is written to `entries` before this lands. The whole point of a
      // correction is that the figure on screen is the figure of record, and an
      // optimistic one would put the app straight back into the state this
      // codebase keeps being reported for: right on screen, wrong in the row.
      const { data, error } = await supabase.from('food_logs')
        .update({ name: next.name, kcal: next.kcal, protein: next.protein, carbs: next.carbs, fat: next.fat })
        .eq('id', id)
        .select();
      if (error || !data || !data.length) { reportError('foodLog.update', error); return false; }
      setEntries(listRef.current.map((x) => (x.id === id ? rowToEntry(data[0]) : x)), uidRef.current);
      return true;
    } catch (e) { reportError('foodLog.update', e); return false; }
  };

  // Derived from `entries`, so a corrected meal moves the day's totals — and
  // the "calories remaining" the client eats against — in the same tick the
  // correction lands. Nothing here caches a total that could outlive the meal
  // it was added up from.
  const consumed = useMemo(() => entries.reduce((a, f) => ({ kcal: a.kcal + f.kcal, protein: a.protein + f.protein, carbs: a.carbs + f.carbs, fat: a.fat + f.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 }), [entries]);

  // Today's pending entries plus whatever is owed from earlier days. The owed
  // rows are counted even though they are not on screen: they are the client's
  // meals, the server has never seen them, and a count that hid them would be
  // the same silence this file was rewritten to remove.
  const unsent = useMemo(
    () => entries.filter((e) => isPending(e.id)).length + owedCount,
    [entries, owedCount],
  );

  return <Ctx.Provider value={{ entries, consumed, status, addFood, logFood, removeFood, updateFood, unsent }}>{children}</Ctx.Provider>;
}

export function useFoodLog(): FoodLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFoodLog must be used inside <FoodLogProvider>');
  return v;
}
