// The floor queue on the device, and the three senders that empty it.
//
// src/lib/floorQueue.ts holds every decision this makes and is tested under
// plain node. What is here is the part that cannot be: AsyncStorage, the
// Supabase writes, and one piece of shared state so the three screens see one
// queue and one count rather than three.
//
// ── Why a module singleton and not a provider ──────────────────────────────
//
// The obvious shape is a `<FloorQueueProvider>` in app/_layout.tsx, and it is
// the wrong one here for a boring reason: mounting it means editing the root
// layout, which every app in this repo shares. The queue is read once per
// account and its contents are the same on all three screens whichever way it
// is held, so the state lives at module scope and each screen subscribes. The
// cost is that it is not reset by React — `resetFor` does that on a change of
// account, which is the one thing a provider would have given for free and is
// the one thing that MUST NOT be got wrong on a shared gym phone.
//
// ── The two rules, and where each is enforced ──────────────────────────────
//
// 1. A queued write is never reported as saved. `send` below returns the
//    `WriteOutcome` unchanged and the screens branch on all three arms.
// 2. A queue that has not been read is not an empty queue. `readable` latches
//    false when `readFloorQueue` says `read: false`, and `persist` refuses to
//    write while it is false — otherwise the first enqueue after an unreadable
//    read overwrites a phone full of somebody's morning with one entry.
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { classifyWrite, registerFlush, type WriteOutcome } from '../lib/offlineQueue';
import { entryToRow } from '../lib/workoutRow';
import type { WorkoutEntry } from '../lib/mockData';
import {
  dropSent, enqueueAct, floorQueueKey, readFloorQueue,
  type FloorAct, type QueuedAct,
} from '../lib/floorQueue';

/* ── the shared state ───────────────────────────────────────────────────── */

let acts: QueuedAct[] = [];
/** False once the stored queue could not be understood. While it is false
 *  NOTHING is written to disk: we do not know what is in there, and the next
 *  write would be the thing that deleted it. */
let readable = true;
/** Whose queue is in memory. A change of account throws it away rather than
 *  flushing one trainer's attendance under the next trainer's name. */
let owner: string | null = null;
/** Whether the device has been read for `owner` yet. */
let loaded = false;

const listeners = new Set<() => void>();
const announce = () => { for (const l of listeners) l(); };

let SEQ = 0;
/** A local id, in the `local:` shape src/lib/wellnessSync.ts uses for the same
 *  purpose everywhere else in this app: an id that cannot be mistaken for one
 *  the server issued. */
const localId = () => `local:floor:${Date.now()}:${SEQ++}`;

async function persist(): Promise<void> {
  if (!owner || !readable) return;
  try {
    await AsyncStorage.setItem(floorQueueKey(owner), JSON.stringify(acts));
  } catch (e) {
    // The queue is correct in memory for this session either way, and the
    // screens are already showing it. Reported because a device that cannot be
    // written to will lose the queue on the next launch, which is exactly the
    // failure this whole module exists to prevent.
    reportError('floorQueue.persist', e);
  }
}

/** Read this account's queue off the device. Idempotent per account. */
export async function loadFloorQueue(uid: string | null): Promise<void> {
  if (!uid) { owner = null; acts = []; readable = true; loaded = true; announce(); return; }
  if (owner === uid && loaded) return;
  owner = uid;
  loaded = false;
  acts = [];
  readable = true;
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(floorQueueKey(uid));
  } catch (e) {
    // A THROW is not an empty queue. This is the latch: `readable` goes false,
    // persist() stops writing, and whatever is on the device survives until a
    // launch that can read it.
    reportError('floorQueue.read', e);
    readable = false;
    loaded = true;
    announce();
    return;
  }
  const r = readFloorQueue(raw);
  acts = r.acts;
  readable = r.read;
  loaded = true;
  announce();
}

/* ── the three senders ──────────────────────────────────────────────────── */

/**
 * Send one act, and say what became of it.
 *
 * Every arm counts the rows it wrote. A write PostgREST narrows to zero rows
 * under RLS does not fail — it succeeds having done nothing — and
 * `classifyWrite` reads `rows <= 0` as a refusal, which is what stops a tick
 * nobody was entitled to make being reported as saved.
 *
 * `rows: null` is the offline case and the only one that queues.
 */
async function send(a: FloorAct, uid: string): Promise<WriteOutcome> {
  if (!USE_SUPABASE) return 'unsent';
  try {
    switch (a.kind) {
      case 'session-log': {
        // `logged_by` is the SIGNED-IN coach at the moment of flushing, not one
        // stored with the act. The insert policy is `is_my_client(user_id) and
        // logged_by = auth.uid()`, so a queue flushed by a different account
        // must be refused rather than filed under the wrong name — and it is,
        // by the database, which is the only place that cannot be bypassed.
        const rows = (a.entries as WorkoutEntry[]).map((e) => ({ ...entryToRow(a.clientId, e), logged_by: uid }));
        const { data, error } = await supabase.from('workouts').insert(rows).select('id');
        const out = classifyWrite(error as never, data ? data.length : 0);
        // A partial insert is not a success. `logForClient` says the same thing
        // and for the same reason: some of an hour's training landing is worse
        // than none of it, because nobody can tell which half.
        if (out === 'stored' && (!data || data.length !== rows.length)) return 'refused';
        return out;
      }
      case 'class-attendance': {
        // An RPC, so there are no rows to count — the function either ran or it
        // did not. `rows: 1` tells classifyWrite to judge on the error alone.
        const { error } = await supabase.rpc('set_class_attendance',
          { p_class: a.classId, p_user: a.userId, p_present: a.present });
        return classifyWrite(error as never, 1);
      }
      case 'session-outcome': {
        const patch: Record<string, unknown> = { outcome: a.outcome };
        // `undefined` means "do not touch the rate", which is not null, which
        // clears it. A coach with no rate set must not have a zero written in —
        // `markMyOutcome` draws the same distinction and this must not flatten
        // it on the way through a queue.
        if (a.rateCents !== undefined) patch.rate_cents = a.rateCents;
        const { data, error } = await supabase.from('sessions').update(patch)
          .eq('id', a.sessionId).eq('trainer_id', uid).select('id');
        return classifyWrite(error as never, data ? data.length : 0);
      }
    }
  } catch (e) {
    // A throw out of the fetch is nobody answering, never a refusal. Not
    // reported: an offline gym would file one of these per tap.
    void e;
    return 'unsent';
  }
}

/** Send everything queued for this account. Returns what happened, so a screen
 *  can say "3 went up" rather than refreshing silently. */
async function flushAll(uid: string): Promise<{ sent: number; refused: number; kept: number }> {
  if (!owner || owner !== uid) return { sent: 0, refused: 0, kept: 0 };
  let sent = 0, refused = 0, kept = 0;
  // Snapshotted, because a tap during the flush appends to `acts` and iterating
  // the live array would try to send something the coach is still typing.
  for (const q of [...acts]) {
    const out = await send(q.act, uid);
    if (out === 'stored') { acts = dropSent(acts, q.id); sent++; continue; }
    if (out === 'refused') {
      // Dropped rather than kept. The same bytes will be refused every time
      // they are offered, so keeping it means retrying forever and counting it
      // as "waiting to send" for the life of the install.
      acts = dropSent(acts, q.id); refused++; continue;
    }
    kept++;
  }
  await persist();
  announce();
  return { sent, refused, kept };
}

/* ── joining the app's one flush ────────────────────────────────────────── */

// Every other queue in this app is emptied by src/ui/offlineFlush.tsx on the
// two moments worth flushing on — the signal coming back, and the app coming
// back to the foreground. This one was not, and it holds the three writes a gym
// is paid on: attendance ticks, session outcomes and logged sessions. Before
// this line the only thing that emptied it was a coach happening to reopen one
// of the three screens that own it, which is the exact defect offlineFlush.tsx
// was built to end, one portal later.
//
// Registered at MODULE scope rather than from an effect, and that is the whole
// point. The six client queues register from providers mounted at the root, so
// their registration lives as long as the app does; these three are screens a
// coach navigates away from. A registration torn down on unmount would leave
// the queue unreachable again the moment the coach closed the register — which
// is precisely when they put the phone in their pocket and walk upstairs into
// signal.
//
// The flusher closes over NOTHING. It reads the module's `owner` at the moment
// it runs, so a change of account cannot leave one trainer's attendance being
// flushed under the next trainer's name — the same rule `resetFor` holds for
// the state itself.
registerFlush('floorQueue', () => (owner && loaded ? flushAll(owner) : undefined));

/**
 * Read this coach's queue off the device, so a cold launch can flush it.
 *
 * Renders nothing. Mounted in app/(trainer)/_layout.tsx, because the module
 * above cannot flush a queue it has never read, and the read happens inside
 * `useFloorQueue` — on three screens the coach may not open for hours. With
 * this mounted, entering the coach app at all is enough: the device is read
 * once, `owner` is set, and last night's attendance is on the server before
 * the coach has chosen a tab.
 *
 * Deliberately NOT `useFloorQueue`: this has no UI to keep in step, and
 * subscribing the tab bar to every queue change would re-render the whole
 * portal on each tick a coach makes in a basement.
 */
export function FloorQueueSync({ uid }: { uid: string | null }): null {
  useEffect(() => {
    let live = true;
    void loadFloorQueue(uid).then(() => {
      if (!live || !uid) return;
      void flushAll(uid);
    });
    return () => { live = false; };
  }, [uid]);
  return null;
}

/* ── the hook the three screens use ─────────────────────────────────────── */

export interface FloorQueue {
  /** What is on this phone and nowhere else. */
  pending: QueuedAct[];
  /** How many. Derived from the list rather than counted separately — a count
   *  kept beside the thing it counts is a second answer that drifts. */
  unsent: number;
  /**
   * False when the device's queue could not be read.
   *
   * NOT the same as an empty queue, and the screens say so: with this false,
   * "nothing waiting" is unknown rather than true, and nothing is written to
   * the device until a launch that can read it.
   */
  queueRead: boolean;
  /** Whether the device has been read for this account yet. */
  ready: boolean;
  /**
   * Try the write; keep it only if nobody answered.
   *
   * Returns the outcome unchanged, because the caller has to say which of the
   * three happened. 'unsent' means it is on the phone and the coach must be
   * told that and not told it saved.
   */
  attempt: (act: FloorAct) => Promise<WriteOutcome>;
  /** Send everything waiting. */
  flush: () => Promise<{ sent: number; refused: number; kept: number }>;
}

export function useFloorQueue(uid: string | null): FloorQueue {
  const [, bump] = useState(0);

  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  useEffect(() => {
    let live = true;
    void loadFloorQueue(uid).then(() => {
      if (!live || !uid) return;
      // Anything written on a previous visit goes up as soon as a screen that
      // uses this queue is opened with signal. Failing here is neither fatal
      // nor silent: the act keeps its place, stays counted, and is tried again.
      void flushAll(uid);
    });
    return () => { live = false; };
  }, [uid]);

  const attempt = useCallback(async (act: FloorAct): Promise<WriteOutcome> => {
    if (!uid) return 'unsent';
    const out = await send(act, uid);
    if (out !== 'unsent') return out;
    acts = enqueueAct(acts, { id: localId(), at: new Date().toISOString(), act });
    await persist();
    announce();
    return 'unsent';
  }, [uid]);

  const flush = useCallback(() => (uid ? flushAll(uid) : Promise.resolve({ sent: 0, refused: 0, kept: 0 })), [uid]);

  const mine = owner === uid ? acts : [];
  return {
    pending: mine,
    unsent: mine.length,
    queueRead: readable,
    ready: loaded && owner === uid,
    attempt,
    flush,
  };
}
