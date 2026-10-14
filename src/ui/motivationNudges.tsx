// Arming the training nudges, once per launch, from wherever the member is.
//
// ── What this replaces ─────────────────────────────────────────────────────
//
// A "remind me tonight" button on the home screen. The member had to be inside
// the app, on that screen, on the day it mattered, having already noticed the
// thing it was about to remind them of — which is a reminder for people who do
// not need reminding. It was also the ONLY motivational notification in the
// app: every other push this repository sends is a booking, a message, a
// notice, an invoice or an injury.
//
// ── What it still cannot do, said plainly ─────────────────────────────────
//
// Reach somebody who has not opened the app. These are local notifications, so
// they are armed while the app is open and fire later on this phone — which
// covers the member who opened the app this morning and forgot by evening, and
// does not cover the member who has not opened it for a week. That second case
// is exactly what a re-engagement push is for and it needs a server: a
// scheduled function reading the training log and sending through send-push.
// Nothing here is armed beyond today, so nothing here can drift into pretending
// otherwise — see HORIZON_DAYS in src/lib/motivationNudge.ts.
//
// ── Why it re-arms rather than accumulating ───────────────────────────────
//
// Every launch cancels what it armed last time before arming again. Without
// that, a member who opens the app four times on a Tuesday gets four identical
// banners at 7pm — and the fastest way to have motivational notifications
// turned off is to send four of them.
//
// The member's own switch and their quiet hours are applied inside
// `scheduleLocal`, which is where the category gate lives so that a caller
// cannot skip it.
import { useEffect, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWorkoutLog } from './workoutLog';
import { isWhole } from './loadStatus';
import { cancelReminders, pushAvailable, scheduleLocal } from './pushNotifications';
import { useNotifyPrefs } from './notifyPrefs';
import { shownStreak } from '../lib/streaks';
import { motivationNudges } from '../lib/motivationNudge';

/** The ids armed last time, so this launch can take them back. */
const ARMED_KEY = 'repple.motivation.armed';

/** The hour a nudge lands. Seven in the evening: late enough that the day is
 *  probably decided, early enough that a session is still possible. */
const EVENING_HOUR = 19;

export function MotivationNudgeProvider({ children }: { children: ReactNode }) {
  const { log, status } = useWorkoutLog();
  const { loaded } = useNotifyPrefs();
  /**
   * The log this provider last armed against, not a boolean "have we armed".
   *
   * ── the notification that had stopped being true ──────────────────────
   *
   * Reported from a real handset on 14 Oct 2026, at 19:00: "It has been a
   * week — Nothing logged for 17 days." The member had a cycling session
   * recorded that same day, and `public.workouts` has it. The sentence was
   * correct when it was armed — the session before it was 18 days earlier —
   * and had become false by the time it was delivered.
   *
   * `done` was a `useRef(false)` latched on the first whole read, so the
   * `log` already in this effect's dependencies could change all it liked and
   * nothing re-planned. That is the case here twice over: the session was
   * written by the member's COACH, server-side, so it arrived in this log
   * through a refresh rather than through anything the member did.
   *
   * Keyed on the log's own shape, so a re-plan happens when, and only when,
   * the thing the plan was computed from has moved. The async block below
   * already cancels the ids it wrote before arming new ones, so running again
   * is what it was built for.
   *
   * ── what this does NOT fix, stated plainly ────────────────────────────
   *
   * An app that is never opened between the session and the fire time still
   * delivers the stale banner, because a local notification cannot re-read
   * anything at fire time. That is the limit this file's header already names,
   * and closing it needs the nudge to be sent from a server that reads the log
   * at send time. This narrows the window to "the app was not opened"; it does
   * not remove it.
   */
  const armedFor = useRef<string | null>(null);
  const signature = `${log.length}:${log.reduce((a2, e) => Math.max(a2, Date.parse(e.t) || 0), 0)}`;

  useEffect(() => {
    if (armedFor.current === signature) return;
    // The preferences have to have seeded the latch first, or a member who
    // turned these off would be armed once on every launch before the store
    // answered.
    if (!loaded) return;
    // Nothing in this build can schedule anything, so there is nothing to arm
    // and nothing to cancel.
    if (!pushAvailable()) return;
    // ONLY A WHOLE READ. Under 'error' the log is empty, which looks exactly
    // like a member who has never trained — and the nudge that follows from
    // that tells somebody with a live streak they have nothing to protect, or
    // tells somebody who trained this morning that it has been a week. The pure
    // module refuses a null, and this is where the null comes from.
    if (!isWhole(status)) return;
    armedFor.current = signature;

    void (async () => {
      // Cancel first, by the ids this provider wrote. Never a blanket cancel:
      // a booked session's one-hour warning, a class reminder and every daily
      // reminder are scheduled elsewhere and must survive.
      try {
        const raw = await AsyncStorage.getItem(ARMED_KEY);
        const old = raw ? JSON.parse(raw) : [];
        if (Array.isArray(old) && old.length) await cancelReminders(old.filter((x) => typeof x === 'string'));
      } catch { /* a stale id costs one duplicate banner, not a wrong one */ }

      const now = Date.now();
      const today = new Date(now); today.setHours(0, 0, 0, 0);
      const trainedToday = log.some((e) => Date.parse(e.t) >= today.getTime());
      // Infinity for a member who has never logged anything, which the pure
      // module treats as "not a quiet week" rather than as a very long one.
      const last = log.reduce((a, e) => Math.max(a, Date.parse(e.t) || 0), 0);
      const daysSinceLastSession = last > 0 ? (now - last) / 86400000 : Infinity;

      const plan = motivationNudges({
        now,
        // The same figure the app shows. A nudge naming a streak the member's
        // own Home screen does not recognise is a nudge about somebody else.
        streak: shownStreak(log, now),
        trainedToday,
        daysSinceLastSession,
        eveningHour: EVENING_HOUR,
      });

      const ids: string[] = [];
      for (const p of plan) {
        // The id is recorded, which is the whole of the re-arm: the next launch
        // cancels exactly these and nothing else. `scheduleLocal` returns null
        // when the member has this category switched off, when the date has
        // already gone, or when the module is not in the build — none of which
        // is an id, and none of which is an error worth stopping for.
        const id = await scheduleLocal(p.title, p.body, p.at, { route: p.route }, 'motivation');
        if (id) ids.push(id);
      }
      try { await AsyncStorage.setItem(ARMED_KEY, JSON.stringify(ids)); } catch { /* best effort */ }
    })();
  }, [loaded, status, log, signature]);

  return <>{children}</>;
}
