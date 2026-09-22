// The device's outbox: one place that holds the writes which are allowed to
// wait, and sends them when the app can reach the server again.
//
// src/lib/outbox.ts is the whole of the policy — which kinds may wait, what a
// lapsed intent is, why the cap refuses rather than evicts, and why a booking
// is NOT in here. This file is the state: the AsyncStorage key, the handler
// registry, and the flush that src/lib/offlineQueue.ts calls.
//
// ── Why the handlers are registered rather than imported ──────────────────
//
// The obvious build has this file import `supabase` and know how to insert a
// message, a measurement and an injury note. That puts three surfaces' write
// rules in a fourth place, where they drift from the provider that owns them —
// and the message insert in particular is not one line: it is an ordered pair
// of writes with an attachment rule and a push notification hanging off it.
//
// So each provider hands this file a function that performs ITS write, and gets
// back the same `WriteOutcome` vocabulary every other queue in this app speaks.
// The provider stays the only place that knows how its rows are shaped, and
// this file stays the only place that knows when anything is tried.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { registerFlush, type WriteOutcome } from '../lib/offlineQueue';
import {
  addItem, bumpTry, dropItem, inOrder, mergeLapsed, newItem, ofKind, outboxKey, outboxLapsedKey,
  partitionLapsed, readOutbox,
  type OutboxItem, type OutboxKind,
} from '../lib/outbox';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

/** What a provider registers: perform this one intent's write, and say what
 *  became of it in the same three words the rest of the app uses. */
export type OutboxHandler = (item: OutboxItem) => Promise<WriteOutcome>;

/** What became of an attempt to put something in the outbox. */
export type EnqueueResult =
  /** On the device and counted. It goes up when there is signal. */
  | 'queued'
  /** The phone is already holding as much as it will hold. Nothing was kept and
   *  the caller has to say so — see src/lib/outbox.ts on why this refuses
   *  rather than evicting somebody's older write. */
  | 'full'
  /** There is no account to key an outbox by, or this device's outbox could not
   *  be read and writing over it would destroy what is in there. Nothing was
   *  kept. */
  | 'unavailable';

interface OutboxValue {
  /** Everything waiting, oldest first. */
  pending: OutboxItem[];
  /**
   * Whether `pending` is everything this device is holding.
   *
   * 'partial' when the stored outbox could not be read — and the rule is the
   * one src/ui/loadStatus.ts states: an unread queue is not an empty queue, so
   * a screen must not say "everything has been sent" off a zero it did not
   * confirm. 'ready' once the device's file has been read, including when it
   * turns out to be empty.
   */
  status: LoadStatus;
  /** How many of one kind are waiting. Derived from `pending` every time rather
   *  than kept alongside it, for the reason wellness.tsx gives: a count stored
   *  beside the thing it counts is a second answer that drifts. */
  countOf: (kind: OutboxKind) => number;
  /**
   * Keep this write for later.
   *
   * See `EnqueueResult` — two of the three answers mean nothing was kept, and
   * the caller must not tell the member it was.
   *
   * `id` comes back so a screen can key its optimistic row on the SAME id the
   * outbox holds. That is not a convenience: without it the queued intent and
   * the optimistic bubble are two objects describing one message, and the
   * thread draws the member's unsent message twice — once from state and once
   * from the outbox — for as long as the screen stays open. Null whenever
   * nothing was kept.
   */
  enqueue: (kind: OutboxKind, payload: unknown, opts?: { at?: string; expiresAt?: string | null }) => Promise<{ result: EnqueueResult; id: string | null }>;
  /** Register the function that performs one kind's write. Returns an
   *  unregister. Call from an effect. */
  registerHandler: (kind: OutboxKind, fn: OutboxHandler) => () => void;
  /**
   * Intents that sat past the moment they were about, and were taken out
   * without being sent.
   *
   * Surfaced rather than swallowed, because the member believes the thing
   * happened. src/lib/outbox.ts · `lapsedNote` is the sentence.
   *
   * One per kind, and held on the DEVICE rather than in this component's state
   * — see `outboxLapsedKey`. The intent is out of the outbox the instant it
   * lapses, so a notice that lived only in memory was a member being told only
   * if they happened to look before the process next ended.
   */
  lapsed: OutboxItem[];
  /** The member has been told, and the notice comes off the device with it.
   *  Until this is called every launch draws it again, which is the point:
   *  nothing else will ever raise it. */
  clearLapsed: () => void;
  /** Try everything now. Also wired to the app's reconnect and foreground
   *  triggers through src/lib/offlineQueue.ts · `flushAll`. */
  flush: () => Promise<void>;
}

const Ctx = createContext<OutboxValue | null>(null);

export function OutboxProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [pending, setPendingState] = useState<OutboxItem[]>([]);
  const [lapsed, setLapsed] = useState<OutboxItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const listRef = useRef<OutboxItem[]>([]);
  const lapsedRef = useRef<OutboxItem[]>([]);
  const uidRef = useRef<string | null>(null);
  const handlers = useRef(new Map<OutboxKind, OutboxHandler>());
  /**
   * False once this device's outbox could not be read.
   *
   * The same latch, for the same reason, as src/ui/workoutLog.tsx: if we do not
   * know what is in the file, the very next write serialises a list that cannot
   * contain those intents straight over the top of them. One unreadable file
   * would take every unsent message on the phone with it, permanently and
   * silently.
   */
  const writable = useRef(true);

  const persist = (list: OutboxItem[]) => {
    const uid = uidRef.current;
    if (!uid || !writable.current) return;
    AsyncStorage.setItem(outboxKey(uid), JSON.stringify(list))
      .catch(() => { /* the session is correct this run either way */ });
  };

  /**
   * The notices, on the device.
   *
   * Written under their own key and NOT behind `writable`. That latch guards
   * the outbox because writing over an outbox we could not read destroys work
   * that could still be sent; this file holds nothing that can be sent, and a
   * lapse notice the member has not seen is worth more than whatever unreadable
   * bytes are under it. It is also the only list that can be written while
   * `writable` is false, which is precisely the launch that needs it: the
   * intents were still lapsing.
   */
  const persistLapsed = (list: OutboxItem[]) => {
    const uid = uidRef.current;
    if (!uid) return;
    AsyncStorage.setItem(outboxLapsedKey(uid), JSON.stringify(list))
      .catch(() => { /* the member is told this run either way */ });
  };

  const setPending = (list: OutboxItem[]) => {
    listRef.current = list;
    setPendingState(list);
    persist(list);
  };

  /**
   * Take these out of the queue and keep the sentence about them.
   *
   * One function rather than the two call sites it replaces, because the two
   * halves must not be able to drift apart: an intent leaves `outboxKey` the
   * moment it lapses, so if the notice is not written in the same breath there
   * is a window in which no record of it exists anywhere. `mergeLapsed` folds
   * it to one per kind, which is what the home screen draws.
   */
  const setLapsedList = (list: OutboxItem[]) => {
    // Through a ref and a plain `setLapsed`, never a functional updater with the
    // write inside it. React double-invokes updaters in development, so a cache
    // write placed in one fires twice — the shape src/ui/workoutLog.tsx says
    // this codebase has already had to unpick.
    lapsedRef.current = list;
    setLapsed(list);
    persistLapsed(list);
  };

  const noteLapsed = (items: OutboxItem[]) => {
    if (!items.length) return;
    setLapsedList(mergeLapsed(lapsedRef.current, items));
  };

  /* ── read the device ─────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let uid: string | null = null;
      try {
        // getSession() and not getUser(): a rejection from getUser() is a
        // signed-out person, and reading that as a failure is what latched
        // sibling providers in this folder into 'error' before anybody had
        // signed in.
        const { data: sess } = await supabase.auth.getSession();
        uid = sess?.session?.user?.id ?? null;
      } catch { /* treated as signed out */ }
      if (cancelled) return;
      uidRef.current = uid;
      writable.current = true;
      // No account, or no backend. There is no outbox to key and nothing is
      // hidden, so this is a settled empty rather than an unread one. The
      // notices go with it: they are this account's, and the next account must
      // not be shown them.
      if (!uid || !USE_SUPABASE) {
        setPending([]);
        lapsedRef.current = [];
        setLapsed([]);
        setStatus('ready');
        return;
      }
      // What this account was still owed a sentence about from a previous run.
      // Read BEFORE the outbox, so a lapse detected below merges into it rather
      // than replacing it — a member who has not yet acknowledged Tuesday's
      // planned day must not lose that notice because a goal lapsed today.
      let held: OutboxItem[] = [];
      try { held = readOutbox(await AsyncStorage.getItem(outboxLapsedKey(uid))).items; } catch { /* nothing held */ }
      if (cancelled) return;
      let read = true;
      let items: OutboxItem[] = [];
      try {
        const got = readOutbox(await AsyncStorage.getItem(outboxKey(uid)));
        items = got.items;
        read = got.read;
      } catch { read = false; }
      if (cancelled) return;
      if (!read) writable.current = false;
      const split = partitionLapsed(items);
      setPending(inOrder(split.live));
      // Assigned rather than merged through `noteLapsed`, because this is the
      // first read of the run and `lapsedRef` is whatever the last account left
      // in it. Written back straight away: the intents in `split.lapsed` have
      // just been taken out of the outbox above, so the notice is the only
      // record of them from this line onwards.
      setLapsedList(mergeLapsed(held, split.lapsed));
      setStatus(read ? 'ready' : 'partial');
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  /* ── put something in ────────────────────────────────────────────────── */

  const enqueue: OutboxValue['enqueue'] = async (kind, payload, opts) => {
    if (!uidRef.current || !USE_SUPABASE) return { result: 'unavailable', id: null };
    // An outbox we could not read is one we must not write. The caller gets an
    // honest "nothing was kept" rather than a queue entry that will be erased
    // by the next launch that CAN read the file.
    if (!writable.current) return { result: 'unavailable', id: null };
    const item = newItem(kind, payload, opts);
    const res = addItem(listRef.current, item);
    if (!res.added) return { result: 'full', id: null };
    setPending(res.list);
    return { result: 'queued', id: item.id };
  };

  const registerHandler: OutboxValue['registerHandler'] = useCallback((kind, fn) => {
    handlers.current.set(kind, fn);
    return () => { if (handlers.current.get(kind) === fn) handlers.current.delete(kind); };
  }, []);

  /* ── send what is waiting ────────────────────────────────────────────── */

  const flush = useCallback(async () => {
    if (!uidRef.current || !USE_SUPABASE) return;
    // Lapsed first, and before anything is sent: an intent whose moment has
    // passed must not go up just because the flush reached it before the check.
    const split = partitionLapsed(listRef.current);
    if (split.lapsed.length) {
      setPending(split.live);
      noteLapsed(split.lapsed);
    }
    // Oldest first across every kind. A thread replayed newest-first is a
    // different conversation, and a measurement out of order is a different
    // trend.
    for (const item of inOrder(listRef.current)) {
      const fn = handlers.current.get(item.kind);
      // No handler registered for this kind — the screen that owns it is not
      // mounted. Left alone: it is still the member's write, and the next
      // flush with that provider mounted will take it.
      if (!fn) continue;
      // Re-check membership each time round. The list is rewritten after every
      // item, and an item removed by a concurrent enqueue or by the lapse pass
      // above must not be sent from a stale slice.
      if (!listRef.current.some((i) => i.id === item.id)) continue;
      let out: WriteOutcome;
      try { out = await fn(item); } catch { out = 'unsent'; }
      if (out === 'stored' || out === 'refused') {
        // Both come out. A refusal offered again gets the same refusal — the
        // argument is in src/lib/offlineQueue.ts and it is the difference
        // between a queue that drains and one that shows "3 waiting to send"
        // for the life of the install.
        setPending(dropItem(listRef.current, item.id));
      } else {
        setPending(bumpTry(listRef.current, item.id));
        // Nobody answered. Everything after this one would meet the same
        // silence, and hammering a dead connection is how a returning wifi
        // signal gets eight simultaneous timeouts instead of one success.
        break;
      }
    }
  }, []);

  // The app's reconnect and foreground triggers reach every queue through this
  // one registry (src/lib/offlineQueue.ts · `flushAll`). Registered by key, so
  // an effect re-run replaces rather than accumulating.
  useEffect(() => registerFlush('outbox', flush), [flush]);

  const countOf = useCallback((kind: OutboxKind) => ofKind(pending, kind).length, [pending]);
  // The member has read it. Cleared from the device too — until this is
  // pressed the notice is owed, and a launch that redrew it would be right to.
  const clearLapsed = useCallback(() => { setLapsedList([]); }, []);

  // provider-deps-ok: `enqueue` reads refs only — uidRef, writable, listRef —
  // so an older copy of it behaves identically to this render's, and listing
  // it would give every consumer a new context value on every queued write.
  const value = useMemo<OutboxValue>(
    () => ({ pending, status, countOf, enqueue, registerHandler, lapsed, clearLapsed, flush }),
    // `enqueue` closes over refs only, so it is stable in everything that
    // matters; it is left out of the dependency list deliberately rather than
    // wrapped, because a new identity on every pending change would re-run
    // every consumer's effect on every queued write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, status, countOf, registerHandler, lapsed, clearLapsed, flush],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The outbox, or null when there is no provider above this screen.
 *
 * Null rather than a throw, and this is deliberate: the outbox is an
 * enhancement to a write path, not a precondition for one. The three apps
 * share these providers and a screen that finds no outbox must still be able to
 * attempt its write and report honestly that nothing was kept — which is
 * exactly what every one of these call sites did before this file existed.
 */
export function useOutbox(): OutboxValue | null {
  return useContext(Ctx);
}
