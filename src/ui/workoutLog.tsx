// Shared, reactive workout log. Persists to Supabase per signed-in user
// (hydrate on mount + optimistic insert on log), and — since this file was
// brought onto src/lib/offlineQueue.ts — to this device, so a session logged
// with no signal is still there tomorrow. Starts empty: a new account has no
// workout history until the user logs one. Never seeds sample data.
//
// ── Why this hook reports a status, and why the writes return a boolean ────
//
// `log: []` used to be the answer to two completely different questions. One is
// "you have not logged anything yet", which is true of every new account. The
// other is "the read came back with an error and we swallowed it" — a refused
// RLS policy, a dropped connection on a gym's wifi, an auth session that had not
// finished restoring. The hydrate below returned early in both cases and the
// state stayed at its initial `[]`, so Train, the streak counter, the challenge
// leaderboard and the coach's adherence figures all reported an empty history as
// the user's actual history. A client who had trained every day for a month
// could be shown a zero streak and told to start one.
//
// The same hole existed on the way out. The insert's result was never inspected
// for `error` — supabase-js resolves with `{ data, error }` rather than throwing,
// so a rejected write looked exactly like a successful one that returned no
// rows. The entry stayed in local state, the screen said it was logged, and it
// existed on that phone and nowhere else until the next launch cleared it.
//
// ── The half that was still missing: the write was never KEPT ──────────────
//
// Three stores in this app already queue a write that did not land — the food
// log, the check-in, the habit tick — and all three go through
// src/lib/offlineQueue.ts. This one did not import a line of it, and it is the
// busiest write path in the product: one row per SET, typed in a basement gym,
// a steel-framed studio, a room full of machines. Exactly the place a phone has
// no signal, and exactly the moment somebody has just done the work.
//
// What happened was: `persist` returned false, the entries sat in a useState
// with no id, and the next launch's hydrate replaced the whole list with the
// server's answer. A member finished a session, saw their sets on screen, and
// they were gone by morning. The one affordance against it was "Try again" on
// the finish screen, which needs the app still open and the signal back.
//
// So an entry that nobody answered is now written to this device under a
// `local:` id (src/lib/wellnessSync.ts), stays in `log`, is counted in `unsent`,
// and goes up on the next launch that reaches a server. Nothing here invents the
// distinction: `classifyWrite` decides what is worth keeping, and it decides it
// the same way for a set as it does for a meal.
//
// ── The two things that must not be got wrong ──────────────────────────────
//
// 1. A QUEUED SET IS NOT A SAVED SET. `addWorkout`/`addWorkouts` still resolve
//    true only for 'stored', because four screens are built on that boolean and
//    "is it on the server" is the honest one-bit answer. `logWorkouts` is the
//    same write with the outcome it actually had, for callers that need to say
//    three different things. The session runner already has the sentence this
//    has to agree with, about its own on-device draft: "They have not reached
//    your log yet — finishing the session is what saves them." Nothing in this
//    file or above it may put a queued set on the far side of that line.
//
// 2. A QUEUE THAT HAS NOT BEEN READ IS NOT AN EMPTY QUEUE. The device's queue
//    is read with the same rule src/ui/loadStatus.ts states for a server read: a
//    read that FAILED tells us nothing, and reporting nothing as "none" is the
//    bug. A failed queue read therefore leaves `status` at 'partial' — the rows
//    on screen are real and there may be more of them — and, critically, latches
//    `cacheable` off so the next write cannot overwrite an unread queue with an
//    empty one. That single line is the difference between a corrupt cache
//    costing a session and a corrupt cache costing every session on the phone.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WorkoutEntry } from '../lib/mockData';
import { rowToEntry, entryToRow } from '../lib/workoutRow';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { worstStatus, type LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { isPending, localId } from '../lib/wellnessSync';
import { classifyWrite, registerFlush, serverRows, unsentCount, type WriteOutcome } from '../lib/offlineQueue';
// The queue's own rules, out here where a test can hold both ends of each —
// src/lib/workoutRow.ts makes that argument at length about the row converters
// it took out of this same file, having found two fields that had never once
// reached the database.
import {
  adoptIds, byNewest, dropRefused, isQueued, queueCacheKey, queuedSessions,
  readQueue, serverId, sessionKey, toQueueRows, withoutStored,
} from '../lib/workoutQueue';
import { useAuthRevision } from './authRevision';

interface WorkoutLogValue {
  log: WorkoutEntry[];
  /** Whether `log` is what the server holds. Under 'error' an empty `log` means
   *  the history could not be read, NOT that there is no history. Under
   *  'partial' the entries are real but there are more of them than came back —
   *  either the row cap cut the read short, or this device's queue could not be
   *  read and some of this person's own sets may be missing from the list. */
  status: LoadStatus;
  /**
   * How many entries are on this phone and nowhere else.
   *
   * Derived from `log` every time rather than kept in its own state, for the
   * reason wellness.tsx gives: a count stored alongside the thing it counts is
   * a second answer to the same question, and the two drift.
   *
   * Zero is only trustworthy when `status` is 'ready'. Under 'partial' the
   * queue may not have been read, and a queue that has not been read is not an
   * empty queue — src/lib/offlineQueue.ts · `unsentNote` is the wording for a
   * non-zero count, and no screen should print "everything is saved" off a zero
   * it did not confirm.
   */
  unsent: number;
  /** Resolves true only once the row is on the server. False no longer means
   *  the entry is lost — it is on this device, in `log`, counted in `unsent`,
   *  and it goes up on the next launch that reaches a server. `logWorkouts`
   *  says which of the two kinds of false it was, and a caller that tells the
   *  member anything must use that instead. */
  addWorkout: (entry: WorkoutEntry) => Promise<boolean>;
  addWorkouts: (entries: WorkoutEntry[]) => Promise<boolean>;
  /**
   * The same write, with the outcome it actually had.
   *
   * 'stored'  the server holds the rows.
   * 'unsent'  nobody answered. They are on the phone, they are in `log`, they
   *           are counted in `unsent`, and they go up on the next launch that
   *           reaches a server. The member has NOT lost the session and must
   *           not be told they have — but it is not in their log either, and
   *           must not be called saved.
   * 'refused' the server read the rows and declined them — a policy, a
   *           constraint. They are NOT kept, because the same bytes offered to
   *           the same constraint get the same answer every time, and a refusal
   *           in the queue is a row retried on every launch for the life of the
   *           install while the member is shown "3 waiting to send" forever.
   *           The caller has to say the session was not logged.
   *
   * An empty list resolves 'refused'. Nothing was written and nothing is
   * waiting, so that is the one answer of the three that cannot become a false
   * "saved" or a false "waiting"; callers guard on emptiness before saying
   * anything at all, because "0 exercises were rejected" is not a sentence.
   */
  logWorkouts: (entries: WorkoutEntry[]) => Promise<WriteOutcome>;
  /**
   * Send entries that are ALREADY in `log` to the server again.
   *
   * `addWorkouts` puts its entries into `log` before it asks the server, which
   * is right — the sets are on screen the instant they are typed. But it makes
   * a second attempt at the same session impossible without duplicating them
   * locally: retrying through `addWorkouts` prepends a second copy of every
   * exercise, so a client on gym wifi who taps "Try again" watches their
   * workout appear twice and cannot tell which one is real.
   *
   * This is the insert on its own, and it now works on the QUEUED COPIES rather
   * than on the objects it was handed. That is not a refinement: since the
   * first attempt keeps what it wrote, the caller's objects and the entries in
   * `log` are two different objects describing one session, and inserting the
   * caller's would put the session on the server while leaving the queued copy
   * behind to be sent again on the next launch — one workout, two rows, a day
   * apart, and no way to tell which is real. The entries passed in are used
   * only to LOOK UP what is still waiting, matched on (timestamp, exercise),
   * which is unique within a session because one session writes every exercise
   * under the same `performed_at`.
   *
   * Resolves true only once the rows are on the server. Nothing is added to
   * `log`, because the caller's entries are in there already.
   */
  retryWorkouts: (entries: WorkoutEntry[]) => Promise<boolean>;
  /** `retryWorkouts` with the outcome it actually had, for the same reason
   *  `logWorkouts` exists: a retry that nobody answered leaves the session
   *  safe and waiting, and a retry the server refused does not. */
  flushWorkouts: (entries: WorkoutEntry[]) => Promise<WriteOutcome>;
  /** Correct an entry that is already logged. Resolves true only once the
   *  server holds the correction, and `log` is left untouched when it does not
   *  — so the screen never shows a figure the row disagrees with. An entry that
   *  is still QUEUED exists on this phone and nowhere else, so editing it here
   *  IS the whole edit and resolves true: the queue holds the entry, not the
   *  write, so it is the corrected figures that go up. */
  updateWorkout: (target: WorkoutEntry, next: Partial<WorkoutEntry>) => Promise<boolean>;
  /** Resolves true only when the row was actually deleted. The entry stays in
   *  `log` on false, rather than vanishing and returning at the next launch. A
   *  queued entry never reached the server, so dropping it here is the entire
   *  deletion and resolves true. */
  removeWorkout: (entry: WorkoutEntry) => Promise<boolean>;
  /** Re-run the hydrate. Useful behind a "couldn't load — retry" affordance. */
  reload: () => void;
  /** State how long a whole session ran, or clear it back to unknown.
   *  Session-scoped: see the comment on the implementation. Resolves true only
   *  once the server has the number — a length that never saved is what decides
   *  whether the session can be written to Apple Health. */
  setSessionMins: (t: string, mins: number | null) => Promise<boolean>;
}

const Ctx = createContext<WorkoutLogValue | null>(null);

/** Narrow a query to one row: by primary key when we have a server one. A
 *  queued entry has none the server would recognise, so it falls back to the
 *  triple that identifies it — and `serverId` is what refuses to put a `local:`
 *  id into the filter, where it would match nothing and be reported as a
 *  success. */
const matchRow = (q: any, uid: string, e: WorkoutEntry) => {
  const id = serverId(e);
  return id ? q.eq('id', id) : q.eq('user_id', uid).eq('performed_at', e.t).eq('exercise', e.exercise);
};

export function WorkoutLogProvider({ children }: { children: React.ReactNode }) {
  const authRev = useAuthRevision();
  const [log, setLogState] = useState<WorkoutEntry[]>([]);
  // Two statuses, folded into one on the way out. A truncated server read and an
  // unreadable device queue are different holes and each has to be able to be
  // open on its own — the same argument habits.tsx makes for keeping
  // `waterStatus` apart from `status`. What screens read is the worse of the
  // two, because a list is only as complete as its worst source.
  const [serverStatus, setServerStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [queueStatus, setQueueStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [reloadTick, setReloadTick] = useState(0);

  // The list as it stands right now, for the async paths. Every mutation goes
  // through `setLog`, which writes the ref, the state and the device's queue
  // together, so an insert resolving three seconds from now merges into what is
  // actually on screen. The alternative — a functional updater — is the shape
  // this codebase has twice had to unpick: React double-invokes updaters in
  // development, so a network call or a cache write placed inside one fires
  // twice.
  const listRef = useRef<WorkoutEntry[]>([]);
  const uidRef = useRef<string | null>(null);
  // False once the device's queue could not be read, or once a server read came
  // back truncated.
  //
  // This is the latch that stops a bad read becoming a permanent loss. If the
  // queue could not be read we do not know what is in it, and the very next
  // write would serialise `log` — which is missing those entries — straight over
  // the top of it. A truncated server read is the same argument availability.ts
  // gives for not caching a short week: a temporary gap must not become this
  // device's idea of what the member did.
  const cacheable = useRef(true);

  /** What goes on the device: the queued entries and nothing else.
   *
   *  Not the history. The server holds that, the read above is capped at a
   *  thousand rows, and a second copy of it here would be a large write on
   *  every set logged for no gain — the thing that has to survive a relaunch is
   *  the work the server has never heard of. Stored through `entryToRow`, so
   *  the cache round-trips through the same tested converter as the database
   *  and cannot grow a third opinion about the column names; the local id is
   *  added back on top because `entryToRow` deliberately drops `id`. */
  const writeQueue = (owner: string | null, list: WorkoutEntry[]) => {
    if (!owner || !cacheable.current) return;
    AsyncStorage.setItem(queueCacheKey(owner), JSON.stringify(toQueueRows(owner, list)))
      .catch(() => { /* the session is correct this run either way */ });
  };

  const setLog = (next: WorkoutEntry[], owner: string | null) => {
    listRef.current = next;
    setLogState(next);
    writeQueue(owner, next);
  };

  // Hydrate from Supabase — never throws, never seeds, and now never claims an
  // empty history it did not actually read.
  useEffect(() => {
    // With no backend the in-memory log IS the record, and there is no absent
    // server to misreport. Nothing is read and nothing is cached: a cache key
    // needs an account and there is no account. Returning BEFORE touching `log`
    // is load-bearing — `reload()` bumps this effect, and clearing the list here
    // would wipe the only copy of everything logged this run.
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        // The auth call has an error channel of its own. Failing to establish
        // WHO the user is is not the same as their having no workouts, and it is
        // the likelier failure on a cold launch with bad signal.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        // No session means no log to read, not a log we failed to read. This is
        // the provider behind "We couldn't read your training log" on Home. The
        // queue is left alone rather than read: it is keyed by account, and
        // there is no account to key it by.
        if (!sess?.session) { uidRef.current = null; setServerStatus('ready'); setQueueStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { reportError('workoutLog.hydrate.auth', authErr); setServerStatus('error'); return; }
        const id = auth?.user?.id;
        // Genuinely signed out: there is no history to fetch, and saying so is
        // accurate rather than a swallowed failure.
        if (!id) { uidRef.current = null; setServerStatus('ready'); setQueueStatus('ready'); return; }
        uidRef.current = id;
        cacheable.current = true;

        // ── the device's queue, first and fast ────────────────────────────
        //
        // Before the network is even attempted, because this is what a member
        // in a basement gym is entitled to see: the sets they logged last night
        // that never went up.
        let queued: WorkoutEntry[] = [];
        let queueRead = true;
        try {
          // null is a real answer — nothing has ever been queued for this
          // account — and it is the ordinary case. `readQueue` is what keeps it
          // apart from bytes nobody could parse; a THROW out of AsyncStorage
          // itself is the third way of learning nothing and lands in the catch.
          const q = readQueue(await AsyncStorage.getItem(queueCacheKey(id)));
          queued = q.entries;
          queueRead = q.read;
        } catch { queueRead = false; }
        if (cancelled) return;
        // The latch, and the sentence it enforces: a queue that has not been
        // read is not an empty queue. `cacheable` off means every write below
        // leaves the unread bytes on disk for the next launch to try again,
        // rather than replacing them with a list that cannot contain them.
        if (!queueRead) cacheable.current = false;
        setQueueStatus(queueRead ? 'ready' : 'partial');
        if (queued.length) setLog([...queued, ...listRef.current].sort(byNewest), id);

        // One row per set, not per session, so this is the fastest-growing read
        // a single client has: four sessions a week at twenty sets apiece passes
        // a thousand rows inside three months. It was unbounded, and the whole
        // of Home is computed from it — the streak, the personal records, the
        // week's volume. Every one of those would have gone quietly wrong.
        //
        // Newest-first was already the order and is the right one to cap on: the
        // screens that read this care about now. What a capped page cannot
        // support is `longestStreak` or a lifetime total, which is what 'partial'
        // exists to tell them.
        const { data, error } = await supabase
          .from('workouts').select('*').eq('user_id', id)
          .order('performed_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled) return;
        // `serverRows` is the whole distinction: null when the read failed, []
        // when this account genuinely has no history. Collapsing the two is what
        // reported a month of training as a zero streak — and now it would also
        // discard the queue, because the line below rebuilds the list from the
        // server's answer.
        const rows = serverRows<any>(error, data);
        if (rows === null) { reportError('workoutLog.hydrate', error); setServerStatus('error'); return; }
        const page = capped(rows);
        if (page.truncated) cacheable.current = false;
        // The server's rows, plus whatever is still waiting to go up. Taken from
        // `listRef` rather than from `queued` because a member can log a set
        // while this read is in flight — it is the first thing somebody does on
        // opening the app — and rebuilding from the older list would delete it
        // between the tap and the render.
        const server = page.rows.map(rowToEntry);
        // …minus anything the server turns out to hold already. An insert whose
        // rows landed but whose response was lost comes back as 'unsent' and
        // stays queued, and without this the session appears twice and is then
        // sent a third time. See `withoutStored`.
        const stillQueued = withoutStored(listRef.current.filter(isQueued), server);
        setLog([...server, ...stillQueued].sort(byNewest), id);
        setServerStatus(page.truncated ? 'partial' : 'ready');

        // Anything logged while offline goes up now. A failure here is neither
        // fatal nor silent: the entries keep their local ids, stay in `log`,
        // stay counted in `unsent`, and are tried again on the next launch.
        //
        // Sent as one insert per session, not one per entry. A session is the
        // unit a member thinks in, and eight round trips on the wifi that just
        // came back is eight chances for half a push day to land.
        for (const t of queuedSessions(stillQueued)) {
          if (cancelled) return;
          // Re-read from `listRef` each time round: the send before this one
          // rewrote the list with the ids it adopted, and a stale slice would
          // offer a row the server has just taken.
          await send(id, listRef.current.filter((e) => isQueued(e) && e.t === t));
        }
      } catch (e) { reportError('workoutLog.hydrate', e); if (!cancelled) setServerStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [reloadTick, authRev]);

  /**
   * Insert entries and adopt the ids the server assigns, so they can be edited
   * straight away rather than only after the next reload.
   *
   * The returned rows are COUNTED, not just checked for `error`. That is the
   * line the first rewrite of this file was for — `error` was never read, so a
   * policy refusal and a successful write were the same event — and counting is
   * the half that came after: a write PostgREST narrows to zero rows under RLS
   * does not fail, it succeeds having done nothing, and `classifyWrite` is where
   * that stops looking like success.
   *
   * `classifyWrite` is also what decides whether a failure is worth keeping, and
   * it is not asked twice: a refusal is dropped here, on the one path where the
   * caller can still say so.
   */
  const send = async (owner: string, entries: WorkoutEntry[]): Promise<WriteOutcome> => {
    if (!entries.length) return 'refused';
    try {
      const { data, error } = await supabase
        .from('workouts').insert(entries.map((e) => entryToRow(owner, e))).select();
      const rows = data ?? [];
      const out = classifyWrite(error as any, rows.length);
      if (out !== 'stored') {
        if (out === 'refused') {
          reportError('workoutLog.persist', error);
          // A refused row will be refused again forever. It comes off the
          // screen and out of the queue rather than sitting in `unsent` for the
          // life of the install, and the caller says the session was not saved.
          //
          setLog(dropRefused(listRef.current, entries), owner);
        }
        return out;
      }
      // Only the id is adopted, deliberately. The server's `performed_at` is the
      // same instant written back in the database's own rendering of it, and a
      // session is grouped, drafted and timed by that exact string everywhere
      // above this file — `setSessionMins` matches on it — so taking the
      // server's spelling of it would re-cut the session the member is looking
      // at. The id is the one field this device could not know.
      setLog(adoptIds(listRef.current, rows), owner);
      return 'stored';
    } catch {
      // No answer at all. The entries stay exactly where they are — in `log`,
      // in the queue on disk, counted — which is the whole reason this file now
      // imports offlineQueue.
      return 'unsent';
    }
  };

  /**
   * Send every session on this device that the server has never heard of.
   *
   * The same loop the hydrate runs, lifted out of it — because the hydrate was
   * the ONLY thing that ran it. That made the honest answer to "when does a set
   * logged in a basement go up" the next launch that also happened to mount
   * this provider, which for somebody who trains at seven and does not open the
   * app again is the following morning, from inside the same basement.
   *
   * It is now also called on the reconnect edge and on returning to the
   * foreground, through src/lib/offlineQueue.ts · `flushAll`.
   *
   * One insert per SESSION, not per set: a session is the unit a member thinks
   * in, and eight round trips on wifi that has just come back is eight chances
   * for half a push day to land. And it STOPS at the first 'unsent' — every
   * session after it would meet the same silence, and hammering a returning
   * connection is how one success becomes eight timeouts.
   */
  const flushQueue = async (): Promise<void> => {
    const owner = uidRef.current;
    if (!USE_SUPABASE || !owner) return;
    for (const t of queuedSessions(listRef.current.filter(isQueued))) {
      // Re-read from `listRef` each time round: the send before this one
      // rewrote the list with the ids it adopted, and a stale slice would offer
      // a row the server has just taken.
      const batch = listRef.current.filter((e) => isQueued(e) && e.t === t);
      if (!batch.length) continue;
      if ((await send(owner, batch)) === 'unsent') return;
    }
  };

  // Registered once. The closure reads `uidRef` and `listRef`, so it stays
  // correct across every re-render and across a change of account without
  // needing to be re-registered — and re-registering on every render would
  // churn the map for no gain.
  useEffect(() => registerFlush('workoutLog', flushQueue), []);

  const logWorkouts: WorkoutLogValue['logWorkouts'] = async (entries) => {
    // Nothing to write. See the contract: 'refused' is the only one of the
    // three that cannot become a false "saved" or a false "waiting to send".
    if (!entries.length) return 'refused';
    // Every entry gets a local id up front, and it is what makes the entry
    // survivable. Without one there is nothing to key the queue on, nothing for
    // React to key the row on, and no way to tell an entry the server has from
    // one it has never heard of — which is how a retry used to produce a second
    // copy of a session.
    //
    // An entry that arrives already carrying a SERVER id keeps it and is
    // inserted again, which is what this function has always done with one and
    // is a caller asking for a duplicate. Every caller in the app builds fresh
    // entries; `flushWorkouts` is the way to send one that is already in `log`.
    const queued = entries.map((e) => ({ ...e, id: e.id ?? localId() }));
    // Optimistic, and written to the device immediately — a set typed on a rack
    // has to survive the app being killed before the network ever comes back.
    setLog([...queued, ...listRef.current].sort(byNewest), uidRef.current);
    if (!USE_SUPABASE || !uidRef.current) return 'unsent';
    return send(uidRef.current, queued);
  };

  const addWorkouts: WorkoutLogValue['addWorkouts'] = async (entries) =>
    (await logWorkouts(entries)) === 'stored';
  const addWorkout: WorkoutLogValue['addWorkout'] = async (entry) =>
    (await logWorkouts([entry])) === 'stored';

  const flushWorkouts: WorkoutLogValue['flushWorkouts'] = async (entries) => {
    if (!USE_SUPABASE || !uidRef.current) return 'unsent';
    // The queued copies, looked up rather than trusted — see the contract on
    // `retryWorkouts`. Re-inserting the caller's own objects is how one session
    // becomes two rows a day apart.
    const want = new Set(entries.map(sessionKey));
    const waiting = listRef.current.filter((e) => isQueued(e) && want.has(sessionKey(e)));
    // Nothing waiting. Either they are already on the server — the common case,
    // when a retry crosses with a hydrate that has just pushed them — or they
    // were never added. Neither is a write, and neither is a save.
    if (!waiting.length) return 'refused';
    return send(uidRef.current, waiting);
  };

  const retryWorkouts: WorkoutLogValue['retryWorkouts'] = async (entries) =>
    (await flushWorkouts(entries)) === 'stored';

  const updateWorkout = async (target: WorkoutEntry, next: Partial<WorkoutEntry>): Promise<boolean> => {
    const apply = () => setLog(
      listRef.current.map((e) => (e === target || (target.id && e.id === target.id) ? { ...e, ...next } : e)),
      uidRef.current,
    );
    // A queued entry exists on this phone and nowhere else, so editing it here
    // IS the whole edit — and it is the corrected figures that get sent when
    // signal returns, because the queue holds the ENTRY rather than the write.
    // True, honestly: there is no server copy left disagreeing with the screen,
    // which is the only thing this boolean has ever been about.
    if (isQueued(target)) { apply(); return true; }
    // With no backend the in-memory log is the whole record, so applying it here
    // is the entire write — and still `false`, because it will not survive the
    // relaunch and the caller must not say "saved".
    if (!USE_SUPABASE || !uidRef.current) { apply(); return false; }
    const patch: Record<string, unknown> = {};
    if ('exercise' in next) patch.exercise = next.exercise;
    if ('t' in next) patch.performed_at = next.t;
    if ('sets' in next) patch.sets = next.sets ?? null;
    // `bw` and `timed` are aligned to `sets` and had no key here at all, so an
    // edit that changed the sets left the flags on the server describing the
    // OLD ones — and an edit sheet that could not write them could not offer
    // them either. Both columns exist (supabase/parts/162 and 204); undefined
    // is sent as null so clearing the last bodyweight set really clears it.
    if ('bw' in next) patch.bw = next.bw ?? null;
    if ('timed' in next) patch.timed = next.timed ?? null;
    if ('feel' in next) patch.feel = next.feel ?? null;
    if ('cardio' in next) patch.cardio = next.cardio ?? null;
    if ('kcal' in next) patch.kcal = next.kcal ?? null;
    if ('zones' in next) patch.zones = next.zones ?? null;
    if ('sessionMins' in next) patch.session_mins = next.sessionMins ?? null;
    // Nothing to send is not a failure — the row already says what was asked.
    if (!Object.keys(patch).length) return true;
    try {
      // `.select('id')` and a row count, not just `error`. This is the same hole
      // the header describes, on the correction path: an UPDATE whose filter
      // matches nothing SUCCEEDS in PostgREST, having changed zero rows — so an
      // entry the client no longer owns, or one whose id never made it back from
      // the insert, reported a clean save and reverted at the next launch. See
      // `setClientMode` in src/ui/roster.tsx, which is where this was found.
      const { data, error } = await matchRow(supabase.from('workouts').update(patch), uidRef.current, target).select('id');
      if (error || !data || !data.length) { reportError('workoutLog.update', error); return false; }
      // Applied only now. The calendar's volume, sets and kcal columns are
      // derived from `log`, so they follow the correction the moment it is real
      // — and stay on the old figures, correctly, when it is not.
      apply();
      return true;
    } catch (e) { reportError('workoutLog.update', e); return false; }
  };

  /**
   * How long a session ran.
   *
   * Scoped to the session, not the row. One session writes all of its exercises
   * with the same `performed_at` (see `WorkoutEntry.id`), so its length is a
   * fact about the group: every row in it carries the same number and they are
   * set together, in ONE statement matched on (user_id, performed_at), rather
   * than eight round trips for an eight-exercise push day.
   *
   * `null` clears it back to unknown. That state has to stay reachable —
   * "nobody has said how long this was" is a real answer and is what stops a
   * session being written to Apple Health, so a mistyped 5 must be erasable
   * rather than only correctable to another number.
   *
   * A non-positive or unparseable value is rejected, not coerced: 0 minutes is
   * an unfinished form, and Health would take it as a real event lasting no
   * time at all.
   *
   * Returns whether the server took it. It was fire-and-forget, which put it in
   * the same bracket as everything else in this provider: the length sat on
   * screen, never reached the row, and came back blank at the next launch with
   * the Apple Health write silently unavailable and nothing saying why.
   *
   * A session that is still QUEUED has no server rows to match, so there is
   * nothing to ask and nothing to report: the number goes onto the entries,
   * travels up with them inside `session_mins`, and this returns false — which
   * is what it has always meant, "the server does not have this yet".
   */
  const setSessionMins = async (t: string, mins: number | null): Promise<boolean> => {
    const v = mins == null ? null : Math.round(mins);
    if (v != null && (!Number.isFinite(v) || v <= 0)) return false;
    setLog(
      listRef.current.map((e) => (e.t === t ? { ...e, sessionMins: v ?? undefined } : e)),
      uidRef.current,
    );
    if (!USE_SUPABASE || !uidRef.current) return false;
    // No stored rows under this timestamp: the whole session is still waiting to
    // go up, and the UPDATE below would match nothing and be reported as a
    // failure of the server rather than as a session the server has not seen.
    if (!listRef.current.some((e) => e.t === t && !isQueued(e))) return false;
    try {
      // Row count again: matching on (user_id, performed_at) is how a session's
      // rows are found, and a `t` that no longer exists on the server matches
      // none of them without raising anything.
      const { data, error } = await supabase.from('workouts').update({ session_mins: v })
        .eq('user_id', uidRef.current).eq('performed_at', t).select('id');
      if (error || !data || !data.length) { reportError('workoutLog.setSessionMins', error); return false; }
      return true;
    } catch (e) { reportError('workoutLog.setSessionMins', e); return false; }
  };

  const removeWorkout = async (entry: WorkoutEntry): Promise<boolean> => {
    const drop = () => {
      const p = listRef.current;
      const i = p.indexOf(entry);
      setLog(
        i >= 0 ? [...p.slice(0, i), ...p.slice(i + 1)] : p.filter((e) => !(e.t === entry.t && e.exercise === entry.exercise)),
        uidRef.current,
      );
    };
    // A queued entry never reached the server, so dropping it locally — and out
    // of the queue on disk, which `setLog` does — is the entire removal. It used
    // to fall through to a DELETE that matched nothing, report false, and leave
    // the entry on screen for the member to try to delete again.
    if (isQueued(entry)) { drop(); return true; }
    if (!USE_SUPABASE || !uidRef.current) { drop(); return false; }
    try {
      // A delete that was refused leaves the row on the server while the screen
      // shows it gone; it reappears on the next launch with no explanation. So
      // the entry now leaves `log` only once the server confirms — and a DELETE
      // matching nothing is not an error in PostgREST, it succeeds having
      // removed zero rows, so the returned rows are what proves it happened.
      const { data, error } = await matchRow(supabase.from('workouts').delete(), uidRef.current, entry).select('id');
      if (error || !data || !data.length) { reportError('workoutLog.remove', error); return false; }
      drop();
      return true;
    } catch (e) { reportError('workoutLog.remove', e); return false; }
  };

  const reload = () => { setServerStatus('loading'); setReloadTick((n) => n + 1); };

  // Counted through offlineQueue's own helper rather than with a filter, so the
  // three stores that show a member "n waiting to send" are all counting the
  // same thing. An entry with no id at all counts: nothing has stored it.
  const unsent = useMemo(
    () => unsentCount(log.map((e) => e.id ?? ''), (id) => id === '' || isPending(id)),
    [log],
  );

  // The worse of the two reads. A screen fed by this is only as complete as the
  // weaker of "what the server said" and "what this device was holding".
  const status = worstStatus(serverStatus, queueStatus);

  return (
    <Ctx.Provider value={{
      log, status, unsent, addWorkout, addWorkouts, logWorkouts,
      retryWorkouts, flushWorkouts, updateWorkout, removeWorkout, setSessionMins, reload,
    }}>{children}</Ctx.Provider>
  );
}

export function useWorkoutLog(): WorkoutLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkoutLog must be used inside <WorkoutLogProvider>');
  return v;
}
