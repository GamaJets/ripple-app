// Re-scheduling the member's reminders from what they saved.
//
// ── The defect this closes, in the screen's own words ─────────────────────
//
// app/(client)/reminders.tsx carried this admission about itself:
//
//   "reminders are scheduled HERE, at the moment Save is pressed, and nothing
//    anywhere re-schedules them from the saved payload later. `useEffect` on
//    mount reads the settings into state and stops."
//
// Three consequences, all silent:
//
//   · A member who set reminders on a build without expo-notifications got
//     nothing after the build that had it, for as long as they never went back
//     to that screen — while the alert they had been shown promised the
//     opposite.
//   · A member who declined the OS notification permission and later granted it
//     in the phone's own Settings got nothing, ever, from reminders that were
//     saved and looked set.
//   · A reinstall restored nothing, because the ids are per-install and the
//     settings blob is per-device.
//
// A reminder that does not arrive is indistinguishable from a reminder that was
// never set, so none of that would ever be reported as a bug — it would be
// reported as "the reminders don't work", once, and then not again.
//
// ── Why it is safe to reschedule on every launch ──────────────────────────
//
// Because it CANCELS FIRST, by the exact ids the last scheduling wrote down,
// and then writes the new ids back. Without the cancel this would add a
// duplicate set of notifications at every launch, which is the fastest way
// anybody has ever had their notifications turned off.
//
// It also does nothing at all when there is nothing to schedule, so a member
// with no reminders never touches the notification system — and, importantly,
// it never REQUESTS the OS permission: `scheduleWeeklyReminders` asks and
// returns empty if it was not already granted. A launch is not a moment
// somebody has asked for notifications, and the system prompt is shown once per
// install and cannot be taken back.
import { useEffect, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { plannedReminders, savedFromStored } from '../lib/reminderPlan';
import { cancelReminders, pushAvailable, scheduleWeeklyReminders } from './pushNotifications';
import { useNotifyPrefs } from './notifyPrefs';

/** The key the reminders screen writes. One string, one owner. */
export const REMINDERS_KEY = 'repple.reminders';

/**
 * Schedule everything in the saved payload, cancelling what was scheduled last
 * time, and write the new ids back.
 *
 * Exported so the reminders screen's own Save uses the identical path. Two
 * copies of "cancel, schedule, record" is how the screen's reported count and
 * the notifications that actually exist drift apart.
 *
 * Returns what happened, because the screen has to say it: how many rows were
 * wanted and how many notifications were actually accepted are different
 * numbers, and the screen used to announce "Reminders set" over a permission
 * that had been refused.
 */
export async function rescheduleReminders(): Promise<{ rows: number; scheduled: number }> {
  let raw: string | null = null;
  try { raw = await AsyncStorage.getItem(REMINDERS_KEY); } catch { raw = null; }
  // Nothing ever saved. Not the same as an empty plan: there is no id list to
  // cancel either, so the notification system is not touched at all.
  if (raw == null) return { rows: 0, scheduled: 0 };

  const saved = savedFromStored(raw);
  // By id, so this only ever removes reminders this app scheduled — a booked
  // session's one-hour warning and a rest-timer alert are scheduled by other
  // code and must survive.
  await cancelReminders(saved.ids);

  const plan = plannedReminders(saved);
  const ids: string[] = [];
  for (const p of plan) {
    // Category 'reminders', so the member's own switch and their quiet hours
    // are applied inside pushNotifications.ts where a caller cannot skip them.
    const got = await scheduleWeeklyReminders(p.title, p.body, p.days, p.hour, p.minute, { route: p.route }, 'reminders');
    ids.push(...got);
  }

  try {
    await AsyncStorage.setItem(REMINDERS_KEY, JSON.stringify({ ...saved, ids }));
  } catch {
    // The reminders ARE scheduled; only the note of their ids failed. The next
    // reschedule will not be able to cancel them and may duplicate the set, so
    // this is the one failure here worth a second thought — and it is still
    // better than rolling back reminders that are now live.
  }
  return { rows: plan.length, scheduled: ids.length };
}

/**
 * Runs the reschedule once per launch.
 *
 * Renders nothing. Keyed on the notification preferences having LOADED, not
 * merely on mount: quiet hours and the daily-reminders switch are applied
 * inside the scheduler from a synchronous latch, and scheduling before the
 * stored preferences have seeded that latch would set reminders at hours the
 * member asked to be left alone in — and then not fix them until the next
 * launch, when the same race could happen again.
 */
export function ReminderSyncProvider({ children }: { children: ReactNode }) {
  const { loaded } = useNotifyPrefs();
  const done = useRef(false);

  useEffect(() => {
    if (!loaded || done.current) return;
    // Nothing in this build can schedule anything, so there is nothing to do
    // and nothing to cancel. Checked rather than left to the no-ops inside
    // pushNotifications, because `cancelReminders` on a build with no module
    // would clear the saved ids' meaning without clearing the notifications.
    if (!pushAvailable()) return;
    done.current = true;
    void rescheduleReminders().catch(() => {
      // Best effort. A failed reschedule leaves whatever was already scheduled
      // in place, which is the state the app was in a moment ago — and the
      // reminders screen still reschedules on Save.
    });
  }, [loaded]);

  return <>{children}</>;
}
