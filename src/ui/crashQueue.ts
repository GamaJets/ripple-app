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
import { uidFromSession } from '../lib/sessionUidRead';
import type { UidRead } from '../lib/authedUid';
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
    //
    // ── and `error`, which decides whether this pass runs at all ───────────
    //
    // `getSession()` does not reject when the auth server cannot be reached. It
    // RESOLVES with `{ data: { session: null }, error }` — the same shape it
    // resolves with on a handset nobody has ever signed in on — so the `error`
    // discarded here read an outage as a sign-out, and what followed was not a
    // wrong sentence on a screen but two irreversible things in a row:
    //
    //   · every report in the queue went up with `user_id` null, which
    //     `app_errors_insert` accepts, so the attribution of a crash that
    //     belonged to a signed-in member was written away as a fact. A
    //     correction would have to be a second recorded fact and there is
    //     nothing here that could write one — the local row is dropped on the
    //     line after the insert.
    //   · the failed refresh that produced that `error` also leaves the
    //     PostgREST request carrying a token the server will not take. A 401
    //     carries a `status`, and `isRefusal` reads `status` before it reads
    //     `code`, so that answer classifies 'refused' — and 'refused' CONTINUES
    //     the pass and DROPS the report. A crash nobody can get back, discarded
    //     because a token could not be refreshed.
    //
    // So the two fates are told apart, and 'unreadable' sends nothing at all.
    // Nothing is lost by waiting: the queue is durable, `registerFlush` brings
    // `flushAll` back on the next reconnect, and in the ordinary case — the
    // phone is simply offline — the first insert would have come back 'unsent'
    // and broken this loop on the very next line anyway.
    //
    // `uidFromSession` and not `sessionUid`, which is what every other caller
    // in this app uses. The header above says why: this module is imported by
    // src/ui/ErrorBoundary.tsx and by `reportError` itself, and anything it
    // touches must be something that cannot itself throw. `sessionUid` records
    // its faults through `reportError`, which imports this file — a crash
    // reporter reporting its own failures through itself. `uidFromSession` is
    // pure and imports neither.
    let who: UidRead;
    try {
      const { data, error } = await supabase.auth.getSession();
      who = uidFromSession({ data, error });
    } catch { who = { uid: null, fate: 'unreadable' }; }
    // Told apart by `fate`, never by `!who.uid`: the union's two members are
    // discriminated by fate, and `string` includes '' — see sessionUid.ts.
    if (who.fate === 'unreadable') return;
    // Null only where the auth server actually said so. Nobody is signed in on
    // this handset is a true statement and a uid the insert policy accepts.
    const signedInAs: string | null = who.uid;
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
