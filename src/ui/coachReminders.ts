// Coach · arming and disarming the coach's own reminders.
//
// The I/O half of src/lib/coachReminders.ts, which holds the rules and is
// tested without a phone. Everything here touches AsyncStorage, expo-
// notifications and supabase, and so is not.
//
// ── What this mounts on, and why it is a hook and not a provider ──────────
//
// One screen wants it — app/(trainer)/calendar.tsx, which is already reading
// the coach's sessions for the grid — and it holds nothing anybody else needs.
// A provider would put a session read behind every screen in the coach app for
// the sake of two notifications.
//
// ── THE THING THIS FILE MUST GET RIGHT ────────────────────────────────────
//
// A local notification survives the app being closed. Arming one is therefore a
// promise the handset keeps whatever happens next, and the failure mode is not
// a missing banner — it is a banner for a session that was cancelled three days
// ago, telling a coach at half past five to go somewhere nobody is waiting.
//
// So every pass does BOTH halves: arm what is new, and cancel what the diary no
// longer contains. `staleReminders` decides the second, and it is deliberately
// conservative about what it will cancel — an arming for a session outside the
// window this read asked about is left alone rather than dropped on the
// strength of a query that never looked at it.
//
// ── The map is written after the platform answers, never before ───────────
//
// `scheduleLocal` returns the notification id or null — null when the category
// is off, when the instant has passed, or when the notifications module is not
// there at all. A map entry written for a banner that was never scheduled is an
// entry `staleReminders` will later try to cancel, and a cancel of an id the
// platform never issued does nothing quietly. Worse, it makes the map claim a
// reminder is armed when none is, and `toArm` then refuses to arm it again.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { scheduleLocal, cancelReminders } from './pushNotifications';
import { weekKey } from '../lib/nudge';
import {
  toArm, staleReminders, expiredReminders, remindAt, reminderBody,
  backlogDue, backlogBody, BACKLOG_PROMPT_KEY,
  type ArmedMap, type RemindableSession,
} from '../lib/coachReminders';

/** Per account, and that is not tidiness. A gym's front-desk handset is signed
 *  in and out all day, and a shared map would leave one trainer holding
 *  another's reminders — with the other trainer's clients' names in them. The
 *  same argument `floorQueueKey` makes in src/lib/floorQueue.ts. */
const armedKey = (uid: string) => `repple.coachReminders:${uid}`;

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
    // An unreadable map is treated as empty, and that direction is chosen
    // deliberately. The cost is that some already-armed banners cannot be
    // cancelled and one duplicate may be armed; the cost of the other direction
    // — refusing to arm anything until somebody clears storage — is a coach who
    // silently stops being reminded and never finds out why.
    return {};
  }
}

/**
 * Bring the handset's reminders into line with the diary it was just shown.
 *
 * Returns the number armed and the number cancelled, for a caller that wants to
 * say something. Nothing here throws: a reminder is a convenience and must
 * never be able to take a screen down with it.
 */
export async function syncCoachReminders(
  uid: string | null,
  sessions: readonly RemindableSession[],
  windowFrom: number,
  windowTo: number,
  now: number = Date.now(),
): Promise<{ armed: number; cancelled: number }> {
  if (!uid) return { armed: 0, cancelled: 0 };
  try {
    const armed = await readArmed(uid);

    // 1 · cancel what no longer describes anything. First, so a session that
    //     moved has its old banner taken back before the new one is armed —
    //     the other order leaves a window in which both exist, and a crash
    //     inside it leaves the coach with two.
    const stale = staleReminders(armed, sessions, windowFrom, windowTo);
    if (stale.length) {
      await cancelReminders(stale.map((s) => s.notifId));
      for (const s of stale) delete armed[s.sessionId];
    }

    // 2 · forget what has already fired. Not cancelled — the platform has
    //     delivered or dropped it and a cancel of a delivered id does nothing —
    //     but removed, or the map grows for the life of the install.
    for (const id of expiredReminders(armed, now)) delete armed[id];

    // 3 · arm what is new.
    let armedCount = 0;
    for (const s of toArm(sessions, armed, now)) {
      const at = remindAt(s.startsAt, now);
      if (!at) continue;
      // 'sessions' is `local: true, quietable: false` in src/lib/notifyPrefs.ts,
      // and both halves are right here: this app schedules it, and a 6:30am
      // session is a thing the coach agreed to at a time they chose — shifting
      // its warning out of quiet hours would make them late for it.
      const notifId = await scheduleLocal(
        'Session in 1 hour', reminderBody(s), at,
        { route: '/(trainer)/calendar' }, 'sessions',
      );
      // Only on a real id. See the header: a map entry for a banner that was
      // never scheduled makes `toArm` refuse to arm it ever again.
      if (notifId) { armed[s.id] = { notifId, startsAt: s.startsAt }; armedCount++; }
    }

    await AsyncStorage.setItem(armedKey(uid), JSON.stringify(armed));
    return { armed: armedCount, cancelled: stale.length };
  } catch (e) {
    reportError('coachReminders.sync', e);
    return { armed: 0, cancelled: 0 };
  }
}

/**
 * The weekly prompt about sessions nobody has marked.
 *
 * `unmarked` is null when the read did not answer, and null never prompts —
 * `backlogDue` enforces it, and this is the one caller that could get it wrong
 * by coercing. A banner about a coach's own business built out of a failed
 * query is how somebody learns to ignore the next one.
 *
 * Fired as a local notification a minute out rather than shown on a screen,
 * because the whole point of the item is that a coach who has not opened the
 * app is the one whose queue is longest. It is `reminders`, which IS quietable:
 * unlike a session warning this is the app's own idea and can wait for morning.
 */
export async function promptUnmarkedBacklog(
  unmarked: number | null,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    let seen: string | null = null;
    try { seen = await AsyncStorage.getItem(BACKLOG_PROMPT_KEY); } catch { seen = null; }
    if (!backlogDue(unmarked, seen, now)) return false;
    const n = unmarked as number;
    const id = await scheduleLocal(
      'Sessions waiting on an outcome', backlogBody(n),
      new Date(now + 60_000), { route: '/(trainer)/sessions' }, 'reminders',
    );
    // The week is recorded whether or not the banner was scheduled. A coach who
    // has muted the `reminders` category has said they do not want this, and
    // re-trying it on every launch would burn a scheduling call a hundred times
    // a week to be refused a hundred times.
    await AsyncStorage.setItem(BACKLOG_PROMPT_KEY, weekKey(now));
    return !!id;
  } catch (e) {
    reportError('coachReminders.backlog', e);
    return false;
  }
}

/**
 * Keep the handset's reminders in step with a screen's own session read.
 *
 * `sessions` null means the read has not landed or did not answer, and NOTHING
 * happens on a null — not an arm and, more importantly, not a cancel. Cancelling
 * every armed reminder because one query failed would leave a coach with a
 * silent phone and no way to know it.
 */
export function useCoachReminders(
  uid: string | null,
  sessions: readonly RemindableSession[] | null,
  windowFrom: number,
  windowTo: number,
): { armed: number; cancelled: number } | null {
  const [result, setResult] = useState<{ armed: number; cancelled: number } | null>(null);
  // The set of ids and their starts, so a re-render that changed nothing does
  // not re-walk the diary and re-write storage. Same reasoning as `rosterKey`
  // in src/ui/nudges.ts.
  const key = sessions
    ? sessions.map((s) => `${s.id}:${s.startsAt}:${s.status}:${s.outcome ?? ''}`).join(',')
    : null;
  const last = useRef<string | null>(null);

  const run = useCallback(async () => {
    if (!USE_SUPABASE || !uid || sessions == null) return;
    const r = await syncCoachReminders(uid, sessions, windowFrom, windowTo);
    setResult(r);
  }, [uid, key, windowFrom, windowTo]);

  useEffect(() => {
    if (key == null || key === last.current) return;
    last.current = key;
    void run();
  }, [key, run]);

  return result;
}
