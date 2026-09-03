// The disk-and-network half of src/lib/crashQueue.ts.
//
// Split exactly as src/lib/outbox.ts splits from src/ui/outbox.tsx: everything
// with an opinion is in the lib file, which is plain TypeScript with a test,
// and what is here is AsyncStorage, Supabase and a registration.
//
// ── Why this is a module and not a provider ────────────────────────────────
//
// `src/ui/ErrorBoundary.tsx` is a class component that renders AFTER a crash.
// It cannot call a hook, and it deliberately imports no theme provider and no
// kit "because this renders after a crash" — anything it touches must be
// something that cannot itself throw. So the queue it writes to has to be
// reachable without React, which a context is not.
//
// It also has to work when the provider tree is gone. `app/_layout.tsx` mounts
// the flush OUTSIDE ErrorBoundary "because a crash in a screen must not take
// the app's ability to send a queued session with it"; the same reasoning
// applies to the crash itself, and a module-level registration survives
// whatever the tree is doing.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { classifyWrite, registerFlush } from '../lib/offlineQueue';
import {
  CRASH_KEY, addCrash, crashRow, dropCrash, inCrashOrder, newCrash, readCrashQueue,
  type CrashReport,
} from '../lib/crashQueue';

let APP_VERSION = 'unknown';
try { APP_VERSION = require('expo-constants').default?.expoConfig?.version ?? 'unknown'; } catch { /* not available */ }

let SEQ = 0;

/**
 * False once the file could not be read.
 *
 * The same latch, for the same reason, as `src/ui/outbox.tsx` and
 * `src/ui/workoutLog.tsx`: if we do not know what is in the file, the very next
 * write serialises a list that cannot contain those reports straight over the
 * top of them. One unreadable file would otherwise take every queued crash on
 * the phone with it.
 */
let writable = true;

async function load(): Promise<CrashReport[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CRASH_KEY);
    const { items, read } = readCrashQueue(raw);
    if (!read) { writable = false; return null; }
    return items;
  } catch {
    writable = false;
    return null;
  }
}

async function save(list: CrashReport[]): Promise<void> {
  if (!writable) return;
  try { await AsyncStorage.setItem(CRASH_KEY, JSON.stringify(list)); } catch { /* nothing to do about it */ }
}

/**
 * Keep a crash that could not be sent.
 *
 * Never throws and never resolves to anything a caller acts on: both callers
 * are inside a `catch` whose whole job is not to make the situation worse.
 */
export async function queueCrash(input: {
  message: string;
  stack?: string | null;
  userId?: string | null;
  at?: string;
}): Promise<void> {
  try {
    if (!USE_SUPABASE) return;
    const list = await load();
    if (list == null) return;
    const item = newCrash({
      id: `crash-${Date.now()}-${SEQ++}`,
      at: input.at ?? new Date().toISOString(),
      message: input.message,
      stack: input.stack ?? null,
      platform: Platform.OS,
      appVersion: APP_VERSION,
      userId: input.userId ?? null,
    });
    const { list: next, result } = addCrash(list, item);
    if (result !== 'added') return;
    await save(next);
  } catch { /* a failed crash report must never become a second crash */ }
}

/**
 * Send whatever is waiting.
 *
 * One at a time and oldest first, removing each only once the server has
 * ANSWERED about it — a row dropped on the strength of a request that was never
 * answered is the failure this file exists to stop.
 *
 * ── The two answers, which used to be one ─────────────────────────────────
 *
 * This read `if (error) break;` and kept the report either way, which is the
 * bug src/lib/offlineQueue.ts opens by describing: a refusal offered again gets
 * the same refusal. And unlike every other queue in this app, the consequence
 * here was not one stuck row but the whole queue — a report the server declines
 * sits at the head of an oldest-first pass and every crash behind it is blocked
 * for the life of the install. `addCrash` then refuses at `CRASH_CAP`, so the
 * device stops reporting crashes altogether, permanently and silently, which is
 * the exact failure this file was written to end.
 *
 * It is not a hypothetical refusal. The queue is deliberately not per account
 * (see the header), `app_errors_insert` requires `user_id = auth.uid() or
 * user_id is null`, and a shared gym phone signs in and out all day —
 * `attributableTo` is the other half of this fix, and stops most of these
 * being refused at all.
 *
 * So: `classifyWrite`, and the same three words the rest of the app uses.
 * 'refused' comes out and the pass CONTINUES, because the next report is a
 * different row and may be perfectly writable. 'unsent' stops the pass, because
 * nobody answered and nobody will answer the next one either; `flushAll` will
 * be along again on the next reconnect.
 *
 * `rows: 1` because there is nothing to count: the insert asks for nothing
 * back, so the error is the whole of the answer.
 */
export async function flushCrashes(): Promise<void> {
  try {
    if (!USE_SUPABASE) return;
    const list = await load();
    if (list == null || list.length === 0) return;
    // Who the app is signed in as NOW, which is not necessarily who it was
    // signed in as when the crash happened. Read once for the pass rather than
    // per report: it cannot change while this loop is running, and a network
    // call per queued crash is the opposite of what a phone that has just got
    // its signal back needs. `getSession()` and not `getUser()`, for the reason
    // every other flush in this app gives — the second goes to the network and
    // resolves null offline, which would drop the attribution of every report
    // sent on a bad connection.
    let signedInAs: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      signedInAs = data?.session?.user?.id ?? null;
    } catch { /* treated as signed out, which is a uid the policy accepts */ }
    let remaining = list;
    for (const c of inCrashOrder(list)) {
      const { error } = await supabase.from('app_errors').insert(crashRow(c, signedInAs));
      if (error && classifyWrite(error as never, 1) === 'unsent') break;
      remaining = dropCrash(remaining, c.id);
      await save(remaining);
    }
  } catch { /* still queued; the next reconnect tries again */ }
}

// Registered at import rather than from an effect, because the two files that
// import this one are the two that run when there is no tree to mount into.
// `registerFlush` keys by name and replaces rather than accumulates, so a hot
// reload cannot leave two of these behind.
registerFlush('crash-reports', flushCrashes);
