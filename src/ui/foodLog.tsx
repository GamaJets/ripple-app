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
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
// A storage-first read of who is signed in that says WHICH kind of nobody it
// found. `getSession()` answers `session: null` for an unreachable auth server
// as well as for a signed-out device (src/lib/authReadFate.ts), and on this
// provider the two decide whether a client's day of meals is shown as empty.
import { sessionUid } from '../lib/sessionUid';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { FoodFigures } from '../lib/entryEdit';
import { isWhole, worstStatus, type LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { isPending, localId, mergeLog } from '../lib/wellnessSync';
import { classifyWrite, dayOf, forDay, registerFlush, serverRows, staleForDay, todayKey, type WriteOutcome } from '../lib/offlineQueue';
// The day a meal goes to, and which meal it was. src/lib/foodLogging.ts holds
// both, and its header holds the decision this provider turns on: a back-dated
// row NEVER LAPSES. src/lib/outbox.ts drops a day plan whose date has passed
// and tells the member, because a plan for a day nobody can live any more has
// stopped meaning anything. A food row is the opposite kind of thing — a record
// of something that happened, as true a fortnight later as it was that evening,
// carrying its own `logged_at` so a late send still lands in the right day. It
// is queued until the server takes it or refuses it, and nothing here ever
// drops one for age.
import { isLogVia, readMealSlot, type MealSlot } from '../lib/foodLogging';
import { useAuthRevision } from './authRevision';
import { useRecoverRead } from './readRefresh';

export type LogVia = 'search' | 'barcode' | 'photo' | 'manual';
/** `at` is when it was eaten, and it is on the entry rather than implied by the
 *  read because a queued meal has to be sent under its own time. Without it a
 *  Tuesday dinner that waited for signal arrives on the server stamped
 *  Wednesday and lands in the wrong day's macros. It is also what a back-dated
 *  row is: a meal the member says they ate on a day that is not today. */
export interface FoodEntry {
  id: string; at: string; name: string; kcal: number; protein: number; carbs: number; fat: number; via: LogVia;
  /**
   * Which meal it was, or null for "nobody told us".
   *
   * ── NOT READ FROM THE SERVER YET, AND NOT WRITTEN TO IT ──────────────────
   *
   * The `meal` column is specified in a part file that is deliberately NOT
   * applied. Naming a column that does not exist in a PostgREST select is a
   * 42703, which `serverRows` correctly reads as a failed read — so adding
   * `meal` to the two `.select()` lists below would put the entire food log
   * into 'error' for every member until the part was applied, and adding it to
   * the two inserts would have `classifyWrite` report every meal as refused.
   * Either one trades the whole feature for a heading.
   *
   * So the column is absent from every query here and this field is always
   * null in practice. `rowToEntry` already reads it through `readMealSlot`, so
   * the day the part is applied the change is `, meal` in the two select lists
   * and `meal: e.meal ?? null` in the two inserts, and nothing else.
   */
  meal?: MealSlot | null;
}

interface FoodLogValue {
  entries: FoodEntry[];
  consumed: { kcal: number; protein: number; carbs: number; fat: number };
  /** Whether today's log is what the server holds. Under 'error' `consumed`
   *  is a floor, not a total — there may be entries we could not read, so
   *  "remaining" is an overestimate and must not be presented as a target. */
  status: LoadStatus;
  /**
   * Read again from the server.
   *
   * A real re-read, not a state reset: it bumps the key the load effect below
   * is keyed on, so the same query runs and `status` goes back through
   * 'loading' to whatever the server answers this time. Nothing local is
   * cleared and nothing pending is dropped, so a refused re-read leaves what is
   * on screen exactly where it was with the status saying it is not confirmed.
   *
   * Added for the pull-to-refresh gesture on the screens this provider feeds:
   * without it those screens could show a failed read for the whole session
   * with no way to ask again.
   */
  reload: () => void;
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
   *
   * ── `loggedAt`: the meal you forgot to log ───────────────────────────────
   *
   * Omitted is unchanged: the row is stamped now and joins today's list, and
   * the ordinary case behaves exactly as it always has.
   *
   * Given an instant on ANOTHER day, the row goes to that day and NOT into
   * `entries`. That is not a detail — `entries` is what `consumed` is summed
   * from and what "calories remaining" is computed against, and a meal the
   * member ate on Tuesday counted into Wednesday's remaining calories is the
   * single worst thing this file could do. A back-dated row is held in exactly
   * the queue this provider already keeps for yesterday's unsent dinner, is
   * counted in `unsent` while it waits, and NEVER LAPSES however long that is
   * — see the import note at the top of this file and the header of
   * src/lib/foodLogging.ts for why that is the opposite of the rule
   * src/lib/outbox.ts applies to a day plan.
   *
   * Pass an instant, not a day: src/lib/foodLogging.ts · `readLogDay` turns the
   * day a member picked into one, at local noon, and refuses the future.
   */
  logFood: (f: Omit<FoodEntry, 'id' | 'at'>, loggedAt?: string) => Promise<WriteOutcome>;
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
  /**
   * The unsent entries belonging to days that are NOT today.
   *
   * Yesterday's dinner logged in a basement, and now also anything the member
   * back-dated while offline. Deliberately not in `entries` — they are not part
   * of today's macros and must never be added into them — but they are the
   * member's meals and the server has never heard of them, so a reader of a
   * PAST day has to be able to see them or it under-reports that day by exactly
   * the rows this device is holding. `useFoodHistory` merges them in.
   */
  owed: FoodEntry[];
  /**
   * Bumped whenever a row is written to a day other than today.
   *
   * A back-dated row must not silently change a figure the member has already
   * been shown as settled. The only reader of a past day inside this file is
   * `useFoodHistory`, whose effect is keyed on this, so an accepted back-date
   * re-reads the fortnight rather than leaving Tuesday's total on screen
   * without the meal that has just been added to it.
   *
   * A counter rather than a flag: two back-dates are two re-reads.
   */
  pastRevision: number;
  /**
   * Whether this account has EVER logged a meal. `null` while nothing has been
   * able to say.
   *
   * ── why this is here and not derived from `entries` ─────────────────────
   *
   * Everything else on this provider is about TODAY, deliberately, and that is
   * right: a meal from Tuesday must never reach Wednesday's remaining
   * calories. But the Getting Started checklist asks a different question —
   * "have you ever logged a meal" — and both screens that draw it were
   * answering it from `entries.length > 0`, which is today's list. So the item
   * ticked in the evening and un-ticked itself at midnight, `checklistLeft`
   * never reached zero, and the onboarding row stayed pinned to the home
   * screen of a member who had logged every meal for six months.
   *
   * This is the honest answer to that question and nothing else reads it. It
   * is NOT a streak and must never become one: there is no window in it, no
   * "recently", and no date floor on the query behind it. Once true it stays
   * true, because "you have logged a meal" is a thing that happened.
   *
   * Null is the usual meaning here: no read has answered. A checklist row off
   * a null draws a dash, counts as neither done nor outstanding, and keeps the
   * list from calling itself finished — src/lib/firstRun.ts.
   */
  everLogged: boolean | null;
}

/** Per-account, so signing out and back in as somebody else on a shared gym
 *  phone cannot show one client another client's meals — and cannot count
 *  them into their macros, which is the part that would be acted on. */
const cacheKey = (uid: string) => `repple.food:${uid}`;

/**
 * The device's note that this account has logged a meal at some point.
 *
 * Written ONLY as a `'1'`, and only once we have seen a meal — either on this
 * device or on the server. The absence of the key is "nobody has told this
 * handset", never "no": a fresh install of a two-year member has no key and
 * asks the server, exactly as it should. That is what keeps this a cache of a
 * yes rather than a cache of an answer.
 *
 * Per-account for the same reason `cacheKey` is: a shared gym phone must not
 * hand one member another member's history.
 */
const everKey = (uid: string) => `repple.food.ever:${uid}`;

const startOfTodayISO = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const rowToEntry = (r: any): FoodEntry => ({
  id: String(r.id), at: String(r.at ?? r.logged_at ?? new Date().toISOString()),
  name: r.name, kcal: Math.round(r.kcal ?? 0),
  protein: Math.round(r.protein ?? 0), carbs: Math.round(r.carbs ?? 0), fat: Math.round(r.fat ?? 0),
  // `isLogVia`, not a literal array written out a fourth time. The four values
  // live in src/lib/foodLogging.ts beside the guard, because this column's
  // CHECK constraint has been violated twice by a caller who had no guard to
  // hand and reached for `as any` instead.
  via: (isLogVia(r.via) ? r.via : 'manual'),
  // Absent today: no query below selects it. See `FoodEntry.meal`. Null is the
  // true answer either way — nobody told us which meal it was.
  meal: readMealSlot(r.meal),
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
  /** Bumped by `reload`. A counter, so two pulls are two reads. */
  const [readTick, setReadTick] = useState(0);
  const reload = useCallback(() => setReadTick((n) => n + 1), []);
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
  // The same list, in state, because a ref changing re-renders nothing and both
  // the count and — since back-dating — the rows themselves are read by
  // screens. It holds the LIST rather than a count of it: this used to be
  // `owedCount`, a number kept beside the array it was the length of, which is
  // one fact in two places and the shape this file's own comments warn about.
  // `unsent` is derived from it below, so the two cannot drift.
  const [owed, setOwed] = useState<FoodEntry[]>([]);
  // Bumped when a row lands on a day that is not today, so `useFoodHistory`
  // re-reads rather than leaving a settled past total on screen without the
  // meal just added to it.
  const [pastRevision, setPastRevision] = useState(0);
  // Written only here, so every path that changes the owed queue updates the
  // one place it is read from.
  const publishOwed = () => setOwed([...owedRef.current]);
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

  /**
   * Push one entry belonging to a day that is not today.
   *
   * Yesterday's dinner logged in a basement, and — since back-dating — a meal
   * the member deliberately filed under an earlier day. Both are the same row
   * to the server and the same row to this queue.
   *
   * It never appears in `entries`, so it is dropped from `owedRef` on any
   * outcome that is not "still waiting":
   *
   *   'stored'  the server has it; the local copy would be a duplicate.
   *   'refused' the same row offered again gets the same answer, so retrying it
   *             forever is the "1 waiting to send" that outlives the install.
   *   'unsent'  KEPT, for as long as it takes. Nothing here expires a row for
   *             age — see the note at the top of this file. A meal is a record
   *             of something that happened and carries the day it happened on;
   *             it cannot go stale the way a plan for a day nobody can live any
   *             more goes stale.
   *
   * Returns the outcome so a caller that back-dated on purpose can tell the
   * member which of the three happened, and so the past-day re-read is bumped
   * once per flush rather than once per row.
   */
  const sendOwed = async (owner: string, e: FoodEntry): Promise<WriteOutcome> => {
    let out: WriteOutcome = 'unsent';
    try {
      const { data, error } = await supabase.from('food_logs')
        .insert({ client_id: owner, logged_at: e.at, name: e.name, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, via: e.via })
        .select('id');
      out = classifyWrite(error as any, data ? data.length : 0);
      if (out === 'refused') reportError('foodLog.owed', error);
    } catch { out = 'unsent'; }
    if (out === 'unsent') return out;
    owedRef.current = owedRef.current.filter((x) => x.id !== e.id);
    publishOwed();
    writeCache(owner);
    return out;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // No session is a true answer, not a failed check. Treating "nobody is
      // signed in" as an error latched this provider into 'error' on the first
      // tick — before anybody had signed in — where it stayed, because the
      // effect never ran a second time.
      //
      // The `catch` this replaces said "no local session; treated as signed out
      // below", and so did the discarded `error` beside the call: an auth
      // server that could not be reached produced `session: null`, `id` fell to
      // null, and the block below wiped the screen to an empty day under
      // 'ready'. That is the sentence "you have not logged anything today",
      // printed over an unread day — and it is worse than the usual shape of
      // that bug, because the same branch ALSO skips the device's own cache
      // (see below: a cache key needs an account). So the one condition where
      // the offline copy exists to be shown is the condition that threw it
      // away, and a client in a basement gym watched their morning disappear.
      const who = await sessionUid('foodLog.today');
      if (cancelled) return;

      cacheable.current = true;

      // Signed out, or a build with no backend: nothing is read from the cache,
      // because a cache key needs an account and there is no account. What is on
      // screen is authoritative and there is no absent server to misreport.
      if (who.fate === 'signed-out' || !USE_SUPABASE) {
        uidRef.current = null; setUid(null); owedRef.current = [];
        setEntries([], null); setStatus('ready'); return;
      }
      // Could not ask. Nothing is known about who this is, so the cache key
      // cannot be formed either — but the day already on screen is NOT cleared
      // and NOT called empty. 'error' is what this provider's own contract
      // (src/ui/loadStatus.ts) means by "the list you are looking at was not
      // confirmed", and it is what the reads below already set when the food
      // read itself fails. Same outcome for the same kind of failure, one call
      // earlier.
      if (who.fate !== null) { setStatus('error'); return; }
      const id = who.uid;
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
      publishOwed();
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
        // Once for the whole flush, not once per row: each bump is a re-read of
        // the fortnight, and a phone coming back from a week offline would
        // otherwise ask for it eight times in a row.
        let landed = false;
        for (const e of [...owedRef.current]) { if (cancelled) return; if ((await sendOwed(id, e)) === 'stored') landed = true; }
        if (landed) setPastRevision((n) => n + 1);
      } catch { if (!cancelled) setStatus('error'); /* offline: the cached day stands, and now says so */ }
    })();
    return () => { cancelled = true; };
  }, [authRev, readTick]);

  /* ── has this account ever logged a meal ─────────────────────────────────
   *
   * A separate, tiny read, and separate on purpose. The hydrate above is the
   * day, with a cache behind it, a queue to flush and a `status` four screens
   * gate their macros on; nothing here may touch any of that. A failure here
   * costs a dash on one checklist row and nothing else.
   *
   * ── why not `useFoodHistory(14)` ────────────────────────────────────────
   *
   * Because a fortnight is still a window, and the question is not "lately". A
   * member who logged for six months and then stopped for three weeks has
   * still logged a meal; answering off a fourteen-day read would un-tick their
   * row on the fifteenth morning, which is the same defect this replaces with
   * a slower clock. It is also much the bigger read — every row of a fortnight,
   * ordered, capped and summed — and neither screen that needs this mounts it.
   *
   * ── what it costs ───────────────────────────────────────────────────────
   *
   * At most one `select id … limit 1` per provider mount, and only when this
   * device has no latch. A member who has logged before writes the latch on
   * their first run and never asks again; a member who never has pays one
   * one-row query per launch, and they are the member the checklist is for.
   * Nothing is re-read on navigation — the provider is mounted once above the
   * whole client app, so the dashboard and Getting Started share this one
   * answer rather than asking twice.
   */
  const [everRead, setEverRead] = useState<boolean | null>(null);
  /** The account `everRead` is an answer ABOUT. A refresh keeps the answer it
   *  already has; signing in as somebody else throws it away. */
  const everForRef = useRef<string | null>(null);
  /** The account whose latch this session has already written, so a member
   *  eating six meals does not write the same key six times. */
  const everWroteForRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // No backend: the device is the whole record and the day above is
      // already 'ready'. There is no absent server to misreport, so this is an
      // answer rather than a silence — the same reading useFoodHistory gives.
      if (!USE_SUPABASE) { setEverRead(false); return; }
      const who = await sessionUid('foodLog.everLogged');
      if (cancelled) return;
      // Only a CHANGE of account discards what we know. Clearing on every
      // reload would flash a dash onto a settled tick each time somebody pulls
      // to refresh, which is churn dressed as honesty.
      if (everForRef.current !== who.uid) { everForRef.current = who.uid; setEverRead(null); }
      // Signed out is a true answer about an empty history, not a failed read.
      if (who.fate === 'signed-out') { setEverRead(false); return; }
      // An outage is not. `false` here is the flag that means "this person has
      // never logged a meal" and it is what the first-run prompt reads to
      // decide whether to offer somebody their first entry — so a dropped
      // connection greeted a client of two years with the empty-handed
      // welcome, over their own history, on the evidence of a read that never
      // happened. `null` is this hook's "not known", which is what it is, and
      // the line above has already cleared it for a changed account.
      if (who.fate !== null) { setEverRead(null); return; }
      const id = who.uid;
      try {
        const raw = await AsyncStorage.getItem(everKey(id));
        if (raw === '1') {
          // Already known, and known forever. No query at all on this launch.
          if (!cancelled) { everWroteForRef.current = id; setEverRead(true); }
          return;
        }
      } catch { /* no usable latch; the query below is the only source */ }
      if (cancelled) return;
      try {
        // No date floor, no order, one row. "Is there any at all" is the whole
        // question, and asking it this way is cheaper than asking for a day.
        const { data, error } = await supabase.from('food_logs')
          .select('id').eq('client_id', id).limit(1);
        if (cancelled) return;
        // `serverRows`, so a refused read is null and not an empty history.
        // Telling a member who has logged for a year that they have never
        // logged a meal is the one thing this row must not do — and under this
        // it does not say anything at all.
        const rows = serverRows<any>(error, data);
        setEverRead(rows === null ? null : rows.length > 0);
      } catch { if (!cancelled) setEverRead(null); }
    })();
    return () => { cancelled = true; };
  }, [authRev, readTick]);

  // A meal on this device is proof whatever any read did, so the latch is
  // written off the rows rather than off the query — a member who logs their
  // first breakfast in a basement with no signal is still somebody who has
  // logged a meal, and their next launch should not have to ask.
  //
  // Only ever a '1'. Nothing here writes a false, and nothing clears it: a
  // deleted row is a correction to what they ate, not a retraction of the day
  // they learned to use the screen.
  useEffect(() => {
    if (!USE_SUPABASE || !uid) return;
    if (everWroteForRef.current === uid) return;
    if (!(entries.length > 0 || owed.length > 0 || everRead === true)) return;
    everWroteForRef.current = uid;
    AsyncStorage.setItem(everKey(uid), '1').catch(() => { /* the query answers next launch */ });
  }, [uid, entries, owed, everRead]);

  /**
   * Send everything this device is holding that the server has never heard of.
   *
   * Both halves of it: today's pending entries and the ones OWED from earlier
   * days (see `staleForDay` — yesterday's unsent dinner is still real and still
   * has to go, it just must never be counted against today's calories).
   *
   * The same loop the hydrate runs, lifted out of it, because the hydrate was
   * the only thing that ran it: a meal logged in a gym cafe with no signal
   * waited for the next launch that also landed on this screen. It is now also
   * called on the reconnect edge and on returning to the foreground, through
   * src/lib/offlineQueue.ts · `flushAll`.
   */
  const flushQueue = async (): Promise<void> => {
    const owner = uidRef.current;
    if (!USE_SUPABASE || !owner) return;
    for (const e of listRef.current.filter((x) => isPending(x.id))) {
      // Stop at the first silence. Everything after it would meet the same
      // silence, and eight simultaneous timeouts on wifi that has just come
      // back is how half a day's log fails to land.
      if ((await send(owner, e)) === 'unsent') return;
    }
    let landed = false;
    for (const e of [...owedRef.current]) if ((await sendOwed(owner, e)) === 'stored') landed = true;
    // One re-read of the past fortnight for the whole flush, so a day whose
    // total was already on screen picks up the meals that have just reached it.
    if (landed) setPastRevision((n) => n + 1);
  };

  // Registered once: the closure reads refs, so it stays correct across
  // re-renders and across a change of account.
  useEffect(() => registerFlush('foodLog', flushQueue), []);

  const logFood: FoodLogValue['logFood'] = async (f, loggedAt) => {
    const entry: FoodEntry = { ...f, id: localId(), at: loggedAt ?? new Date().toISOString() };

    // ── the meal that belongs to another day ────────────────────────────────
    //
    // Judged from the entry's own instant against the day RIGHT NOW, not
    // against anything computed when this provider mounted. A provider is
    // mounted for as long as the app is; a member who opened the app yesterday
    // evening and logs breakfast this morning must not have it filed under
    // yesterday because a constant said so (src/ui/today.ts, and
    // scripts/check-frozen-day.mjs, on why this keeps happening).
    //
    // It does NOT go into `entries`. That list is what `consumed` sums and what
    // "calories remaining" is computed from, so a meal eaten on Tuesday counted
    // there would be eaten a second time on Wednesday — the one figure on this
    // screen that gets acted on. It goes into the owed queue instead, which is
    // cached, counted in `unsent`, retried on every launch and reconnect, and
    // never expired for age.
    if (dayOf(entry.at) !== todayKey()) {
      owedRef.current = [entry, ...owedRef.current];
      publishOwed();
      // Cached before the network is touched, exactly as today's path is: a
      // back-dated meal typed on a train has to survive the app being killed.
      writeCache(uidRef.current);
      // Signed out, or a build with no backend. It is on the phone and it is
      // counted as unsent, which is the honest answer — 'stored' would not be.
      if (!USE_SUPABASE || !uidRef.current) return 'unsent';
      const back = await sendOwed(uidRef.current, entry);
      // A past day that was already on screen has just changed. Re-read it
      // rather than leaving a settled total standing without the meal that has
      // been added to it.
      if (back === 'stored') setPastRevision((n) => n + 1);
      // 'refused' has already taken it back out of the queue inside `sendOwed`;
      // the caller says the meal was not logged.
      return back;
    }

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
      publishOwed();
      setEntries(listRef.current.filter((x) => x.id !== id), uidRef.current);
      return true;
    }
    if (!USE_SUPABASE) return false;
    // Whose row this is. Every insert in this hook writes `client_id: owner`
    // off the same ref, and nothing here ever addresses another person's meal —
    // `food_trainer_read` is FOR SELECT, so a coach cannot delete a client's
    // food log through this path or any other. So naming the owner narrows
    // nothing a caller is entitled to do.
    //
    // A null owner is not a delete with no owner clause: there is no signed-in
    // account to own the row, the read that fills `entries` never ran, and a
    // DELETE aimed by id alone from a session with nobody in it is precisely
    // the write this clause exists to make impossible. Returning false says the
    // row is still there, which is true.
    const owner = uidRef.current;
    if (!owner) return false;
    try {
      // The row leaves the screen only once the server says it has gone. It used
      // to leave first, which meant a refused delete took the meal's calories
      // out of the day's rings — the client ate against a total that was wrong
      // until the next launch put the food back with no explanation.
      //
      // Counting the returned rows, not just checking `error`: a DELETE that
      // matched nothing SUCCEEDS in PostgREST, having removed zero rows.
      //
      // `.eq('client_id', owner)` as well as the id, which this did not have.
      // RLS already scopes it — `food_owner` is `client_id = auth.uid()` FOR
      // ALL — so the clause changes nothing about what is permitted. It is here
      // for the reason `updateScan` and `deleteScan` in src/ui/clientData.tsx
      // carry the same clause and say so: a bug handing this an id from another
      // account must fail to MATCH rather than leave a row-level policy as the
      // only thing between one member and another member's record. That is not
      // hypothetical on this handset — `listRef` has been shown holding the
      // previous member's rows more than once in this codebase, and an id off a
      // stale list is exactly the input this clause refuses.
      const { data, error } = await supabase.from('food_logs').delete().eq('id', id).eq('client_id', owner).select('id');
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
      // Published, which it was not before. The owed rows used to be reduced to
      // a count, and a correction to one of them changes no count — so a
      // back-dated meal corrected before it had sent kept its old figures on
      // any screen reading the queue, while the row that eventually went up
      // carried the new ones.
      publishOwed();
      setEntries(listRef.current.map((x) => (x.id === id ? { ...x, ...next } : x)), uidRef.current);
      return true;
    }
    if (!USE_SUPABASE) return false;
    try {
      // Nothing is written to `entries` before this lands. The whole point of a
      // correction is that the figure on screen is the figure of record, and an
      // optimistic one would put the app straight back into the state this
      // codebase keeps being reported for: right on screen, wrong in the row.
      // The owner clause `removeFood` above now carries, for the same reason
      // and against the same input: an id off a list this provider has not
      // finished clearing is an id belonging to somebody else, and a correction
      // to another member's meal is the same class of write as a deletion of
      // one. A null owner refuses rather than sending an unqualified UPDATE.
      const owner = uidRef.current;
      if (!owner) return false;
      const { data, error } = await supabase.from('food_logs')
        .update({ name: next.name, kcal: next.kcal, protein: next.protein, carbs: next.carbs, fat: next.fat })
        .eq('id', id)
        .eq('client_id', owner)
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
    () => entries.filter((e) => isPending(e.id)).length + owed.length,
    [entries, owed],
  );

  // Re-run this read when the signal comes back, without the member having
  // to know the app is stuck and think to pull down. src/lib/readRefresh.ts.
  useRecoverRead('foodLog', status, reload);
  // ── Why the implementations below are handed out through a ref ────────────
  //
  // This provider used to publish an inline object literal, so `useFoodLog`
  // returned a different value on every render — and every function on it was a
  // different function again. The consumer that writes the obvious thing,
  // `useFocusEffect(useCallback(() => { x.addFood(); }, [x]))`, then builds a
  // machine that cannot stop: the effect re-runs when its callback's identity
  // changes, the call re-runs the fetch, the fetch ends in a setState, the
  // provider re-renders, and both identities are new again. src/ui/roster.tsx
  // documents that at length and is the pattern this follows.
  //
  // The wrappers are created once and read the current implementations out of a
  // ref, so they are stable for the life of the provider while still closing
  // over this render's state. Freezing the implementations themselves in a
  // `useCallback` would freeze that state with them, which is the same bug one
  // level down.
  const impl = useRef({ addFood, logFood, removeFood, updateFood });
  impl.current = { addFood, logFood, removeFood, updateFood };
  const addFoodStable = useCallback((...a: Parameters<typeof addFood>) => impl.current.addFood(...a), []);
  const logFoodStable = useCallback((...a: Parameters<typeof logFood>) => impl.current.logFood(...a), []);
  const removeFoodStable = useCallback((...a: Parameters<typeof removeFood>) => impl.current.removeFood(...a), []);
  const updateFoodStable = useCallback((...a: Parameters<typeof updateFood>) => impl.current.updateFood(...a), []);
  const value = useMemo<FoodLogValue>(() => ({ entries, consumed, status, addFood: addFoodStable, logFood: logFoodStable, removeFood: removeFoodStable, updateFood: updateFoodStable, unsent, owed, pastRevision, everLogged: everRead, reload }), [entries, consumed, status, addFoodStable, logFoodStable, removeFoodStable, updateFoodStable, unsent, owed, pastRevision, everRead, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFoodLog(): FoodLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFoodLog must be used inside <FoodLogProvider>');
  return v;
}

/* ── yesterday, and the fortnight before it ────────────────────────────────
 *
 * The provider above reads ONE DAY, deliberately: everything it holds feeds
 * "calories remaining", and a meal from Tuesday counted into Wednesday's
 * remaining calories is the single worst thing this file could do. That
 * constraint is right and stays.
 *
 * What followed from it was that the app had no yesterday at all. A member
 * could log a fortnight of meals and had no way to look at any of it — no date
 * picker, no week, no average — so the food log was a thing you wrote into and
 * could never read. The one screen that answered "how much do I actually eat"
 * did not exist.
 *
 * So the history is a SEPARATE read with a separate status, which is what keeps
 * the two apart: nothing below can reach `entries`, `consumed` or the day's
 * macros, and a failed history read cannot make today's figures wrong.
 */

/** One day of eating. `kcal` and the macros are sums over `entries`, so a day
 *  that could not be read whole has no day object at all rather than a short
 *  one — see `useFoodHistory`. */
export interface FoodDay {
  /** Local calendar day, 'YYYY-MM-DD'. */
  day: string;
  entries: FoodEntry[];
  kcal: number; protein: number; carbs: number; fat: number;
}

export interface FoodHistory {
  /** Newest day first. Days with nothing logged are ABSENT rather than present
   *  with zeros: nobody eats nothing, so a zero day is a day nobody wrote in,
   *  and charting it as a zero would drag every average down towards a fast
   *  that did not happen. */
  days: FoodDay[];
  status: LoadStatus;
  /** Mean intake across the days that were actually logged, or null when the
   *  read is not whole or there is nothing to average. `overDays` is how many
   *  days it is a mean of, and it is not optional — "1,900 kcal a day" over two
   *  logged days out of fourteen is a different sentence from the same figure
   *  over fourteen, and the reader has to be given both. */
  average: { kcal: number; protein: number; carbs: number; fat: number; overDays: number } | null;
  reload: () => void;
}

const dayKeyOf = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The last `days` calendar days of eating, today included.
 *
 * Today's rows come from the provider rather than from this query, so a meal
 * logged in a basement with no signal appears in the week view exactly as it
 * appears in the day view. Without that the history would quietly contradict
 * the screen above it for anybody eating offline.
 */
export function useFoodHistory(days: number = 14): FoodHistory {
  const authRev = useAuthRevision();
  const today = useFoodLog();
  const [rows, setRows] = useState<FoodEntry[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!USE_SUPABASE) { setRows([]); setStatus('ready'); return; }
      setStatus('loading');
      const who = await sessionUid('foodLog.history');
      if (cancelled) return;
      // Signed out is a true answer about an empty history, not a failed read.
      if (who.fate === 'signed-out') { setRows([]); setStatus('ready'); return; }
      // An outage is neither. `rows: []` under 'ready' is a fortnight of meals
      // reported as a fortnight of none — and this hook's own comment two
      // screens down says why that cannot be papered over with today's cache:
      // "inventing one from today's would show a week made of one day". The
      // same refusal belongs at the auth read, which is the earlier of the two
      // places this list can come back unknown.
      if (who.fate !== null) { setRows([]); setStatus('error'); return; }
      const id = who.uid;
      const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (Math.max(1, days) - 1));
      try {
        const { data, error } = await supabase.from('food_logs')
          .select('id, logged_at, name, kcal, protein, carbs, fat, via')
          .eq('client_id', id).gte('logged_at', from.toISOString())
          .order('logged_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled) return;
        const got = serverRows<any>(error, data);
        // The cached day is not reused here. There is no cache of a fortnight,
        // and inventing one from today's would show a week made of one day.
        if (got === null) { setStatus('error'); return; }
        const page = capped(got);
        setRows(page.rows.map(rowToEntry));
        // 'partial', not 'ready'. Every figure below is a sum or a mean, and
        // src/ui/loadStatus.ts is explicit that those may not be computed over
        // a truncated read — a fortnight cut off at its row limit loses whole
        // days off the far end and the average would be of the days that fit.
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
    // `today.pastRevision` is in here because a back-dated meal changes a day
    // this hook has ALREADY put a total on screen for. Without it, a member who
    // adds Tuesday's forgotten dinner goes on reading Tuesday's old total, and
    // the fortnight's average is taken over a set that is missing the row they
    // have just been told was saved. That is the "settled figure quietly moving
    // underneath somebody" failure, arriving through the one reader that shows
    // a past day. The effect re-runs, the query runs again, and `status` goes
    // back through 'loading' to whatever the server says this time.
  }, [authRev, days, tick, today.pastRevision]);

  const todayKeyNow = todayKey();
  const value = useMemo<FoodHistory>(() => {
    // Today from the provider, every earlier day from the query. Dropping the
    // query's own today rows rather than merging them: the provider's list
    // already holds them plus anything unsent, and a merge on id would leave a
    // meal logged offline showing twice the moment it was accepted.
    //
    // `today.owed` is the third source and it is not optional. Those are meals
    // belonging to earlier days that this phone is holding and the server has
    // never seen — yesterday's dinner logged in a basement, and anything the
    // member back-dated while offline. Leaving them out would show a day total
    // short by exactly the rows this device knows about, on the screen the
    // member opened to check that the meal they just added had landed. They are
    // filtered to days other than today for the same reason the query's rows
    // are: `today.entries` is the authority on today, and the owed queue never
    // holds a row for today anyway.
    const all = [
      ...today.entries,
      ...today.owed.filter((r) => dayKeyOf(r.at) !== todayKeyNow),
      ...rows.filter((r) => dayKeyOf(r.at) !== todayKeyNow),
    ];
    const byDay = new Map<string, FoodEntry[]>();
    for (const e of all) {
      const k = dayKeyOf(e.at);
      if (!k) continue;
      const list = byDay.get(k);
      if (list) list.push(e); else byDay.set(k, [e]);
    }
    const out: FoodDay[] = [...byDay.entries()]
      .map(([day, list]) => {
        const sorted = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        return {
          day,
          entries: sorted,
          kcal: sorted.reduce((a, e) => a + e.kcal, 0),
          protein: sorted.reduce((a, e) => a + e.protein, 0),
          carbs: sorted.reduce((a, e) => a + e.carbs, 0),
          fat: sorted.reduce((a, e) => a + e.fat, 0),
        };
      })
      .sort((a, b) => b.day.localeCompare(a.day));

    // The whole history is only as trustworthy as its worst half, and today
    // comes from a different read than the rest of it.
    const combined = worstStatus(status, today.status);
    const average = (isWhole(combined) && out.length)
      ? {
        kcal: Math.round(out.reduce((a, d) => a + d.kcal, 0) / out.length),
        protein: Math.round(out.reduce((a, d) => a + d.protein, 0) / out.length),
        carbs: Math.round(out.reduce((a, d) => a + d.carbs, 0) / out.length),
        fat: Math.round(out.reduce((a, d) => a + d.fat, 0) / out.length),
        overDays: out.length,
      }
      : null;
    return { days: out, status: combined, average, reload: () => setTick((n) => n + 1) };
  }, [rows, today.entries, today.owed, today.status, status, todayKeyNow]);

  return value;
}
