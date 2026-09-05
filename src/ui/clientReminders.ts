// Client · arming and disarming the member's own "Session in 1 hour".
//
// The I/O half of src/lib/clientReminders.ts, which holds the rules and is
// tested without a phone. Everything here touches AsyncStorage and
// expo-notifications and so is not.
//
// It is the mirror of src/ui/coachReminders.ts, deliberately down to the shape
// of the pass — cancel first, prune, then arm — because the failure it is about
// is the same one that file's header names: a banner that survives the app
// being closed is a promise the handset keeps whatever happens next, and a
// banner for a session that has moved is worse than no banner at all.
//
// ── Why the arming moved out of `bookSession` ─────────────────────────────
//
// It used to live inside `bookSession` in src/ui/sessions.tsx: one
// `scheduleLocal` at the moment of the tap, id discarded. That is the only
// moment in a member's whole relationship with a session at which the handset
// was involved, and every other moment — cancelling it, moving it, having it
// handed to them off a waitlist, having their coach book them in, having the
// nightly job materialise their standing Tuesday — happens on a server. So the
// one gesture that armed a reminder was also the only one that could, and none
// of the gestures that INVALIDATE one could take it back.
//
// A pass over the diary has none of those blind spots: it is driven by what the
// member's calendar actually says, whoever changed it and wherever from.
//
// ── Two screens, one map ──────────────────────────────────────────────────
//
// Both app/(client)/calendar.tsx and app/(client)/bookings.tsx hold the
// member's diary and either may be the one they open. Both run this, and
// `inFlight` is what stops two passes interleaving over the same AsyncStorage
// key — read, read, write, write, with the second write losing the first's
// arming and leaving a scheduled banner nothing remembers and nothing can ever
// cancel.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { scheduleLocal, cancelReminders } from './pushNotifications';
import {
  toArm, staleReminders, expiredReminders, remindAt,
  type ArmedMap, type RemindableSession,
} from '../lib/coachReminders';
import { CLIENT_ARM_AHEAD_DAYS, clientReminderBody, myRemindable, readWindow } from '../lib/clientReminders';
import type { LoadStatus } from './loadStatus';

/** Per account, for src/ui/coachReminders.ts's reason: a shared handset signed
 *  in and out would otherwise leave one member holding another's reminders. */
const armedKey = (uid: string) => `repple.clientReminders:${uid}`;

async function readArmed(uid: string): Promise<ArmedMap> {
  try {
    const raw = await AsyncStorage.getItem(armedKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ArmedMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const e = v as { notifId?: unknown; startsAt?: unknown };
      if (typeof e?.notifId === 'string' && typeof e?.startsAt === 'string') {
        out[k] = { notifId: e.notifId, startsAt: e.startsAt };
      }
    }
    return out;
  } catch {
    // Empty, for the same trade the coach's copy makes: an unreadable map costs
    // at worst one duplicate banner, and the other direction — refusing to arm
    // anything — is a member who silently stops being reminded.
    return {};
  }
}

/** One pass at a time per account, across both screens that run this. */
const inFlight = new Map<string, Promise<{ armed: number; cancelled: number }>>();

/**
 * Bring the handset's reminders into line with the diary it was just shown.
 *
 * `status` is the sessions read's own, and it decides what this is allowed to
 * say — see `readWindow`. Under 'loading' and 'error' nothing happens at all:
 * a cancellation pass over a list that is empty for want of a read would disarm
 * every reminder the member has because one query failed.
 *
 * Nothing here throws. A reminder is a convenience and must never be able to
 * take a screen down with it.
 */
export async function syncClientReminders(
  uid: string | null,
  sessions: readonly { id: string; clientId: string | null; startsAt: string; status: string; outcome?: string | null }[],
  status: LoadStatus,
  coachName: string | null,
  now: number = Date.now(),
): Promise<{ armed: number; cancelled: number }> {
  if (!uid) return { armed: 0, cancelled: 0 };
  const running = inFlight.get(uid);
  if (running) return running;
  const pass = (async () => {
    try {
      const mine = myRemindable(sessions, uid);
      const window = readWindow(status, mine.map((s) => s.startsAt));
      if (!window) return { armed: 0, cancelled: 0 };
      const armed = await readArmed(uid);

      // 1 · cancel what no longer describes anything, BEFORE arming. The other
      //     order leaves a window in which both the old and the new banner
      //     exist, and a crash inside it leaves the member with two.
      const stale = staleReminders(armed, mine, window.from, window.to);
      if (stale.length) {
        await cancelReminders(stale.map((s) => s.notifId));
        for (const s of stale) delete armed[s.sessionId];
      }

      // 2 · forget what has already fired. Not cancelled — the platform has
      //     delivered or dropped it — but removed, or the map grows for the
      //     life of the install.
      for (const id of expiredReminders(armed, now)) delete armed[id];

      // 3 · arm what is new.
      let armedCount = 0;
      for (const s of toArm(mine, armed, now, CLIENT_ARM_AHEAD_DAYS)) {
        const at = remindAt(s.startsAt, now);
        if (!at) continue;
        // 'sessions' is `local: true, quietable: false` in src/lib/notifyPrefs.ts.
        // Quiet hours deliberately do not move this one: they booked a 6:30am
        // session and the warning has to reach them before the session does.
        const notifId = await scheduleLocal(
          'Session in 1 hour', clientReminderBody(s.startsAt, coachName),
          at, { route: '/(client)/calendar' }, 'sessions',
        );
        // Only on a real id. A map entry for a banner that was never scheduled
        // is one `toArm` would read as armed and never arm again.
        if (notifId) { armed[s.id] = { notifId, startsAt: s.startsAt }; armedCount++; }
      }

      await AsyncStorage.setItem(armedKey(uid), JSON.stringify(armed));
      return { armed: armedCount, cancelled: stale.length };
    } catch (e) {
      reportError('clientReminders.sync', e);
      return { armed: 0, cancelled: 0 };
    }
  })();
  inFlight.set(uid, pass);
  try { return await pass; } finally { inFlight.delete(uid); }
}

/**
 * Keep the handset's reminders in step with a screen's own session read.
 *
 * Keyed on the ids, their start times and their states, so a re-render that
 * changed nothing does not re-walk the diary and re-write storage — the same
 * arrangement `useCoachReminders` uses, and for the same reason. The status is
 * in the key too: a read that goes from 'error' to 'ready' has changed what
 * this is allowed to say even when the rows are identical.
 */
export function useClientReminders(
  uid: string | null,
  sessions: readonly { id: string; clientId: string | null; startsAt: string; status: string; outcome?: string | null }[],
  status: LoadStatus,
  coachName: string | null,
): { armed: number; cancelled: number } | null {
  const [result, setResult] = useState<{ armed: number; cancelled: number } | null>(null);
  const key = uid
    ? `${status}|${coachName ?? ''}|` + sessions
      .filter((s) => s.clientId === uid)
      .map((s) => `${s.id}:${s.startsAt}:${s.status}:${s.outcome ?? ''}`)
      .join(',')
    : null;
  const last = useRef<string | null>(null);

  const run = useCallback(async () => {
    if (!USE_SUPABASE || !uid) return;
    setResult(await syncClientReminders(uid, sessions, status, coachName));
    // `key` and not `sessions`: the array identity changes on every render of
    // the provider, and depending on it would re-walk the diary on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key]);

  useEffect(() => {
    if (key == null || key === last.current) return;
    last.current = key;
    void run();
  }, [key, run]);

  return result;
}
