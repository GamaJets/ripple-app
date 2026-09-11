// The workout clock on the lock screen, as far as JavaScript is concerned.
//
// ── Everything here is allowed to do nothing ──────────────────────────────
//
// iOS below 16.2, a member who has turned Live Activities off, a system with
// no slots left — all of them reach these calls and all of them must leave the
// SESSION untouched. A workout is a health record; a decoration on the lock
// screen is not, and it does not get to fail one.
//
// So every function is best-effort and none of them throws. The runner calls
// them and never branches on the result, which is the property that keeps a
// missing Live Activity from becoming a missing workout.
//
// ── And on Android it is absent, not broken ──────────────────────────────
//
// There is no ActivityKit outside Apple. `requireOptionalNativeModule` returns
// null rather than throwing, so an Android build and a phone running an older
// OTA over an older binary both land in the same quiet no-op.
import { requireOptionalNativeModule } from 'expo-modules-core';

interface Native {
  isSupported(): boolean;
  start(activity: string, startedAtSec: number, pausedMs: number): Promise<boolean>;
  update(startedAtSec: number, pausedMs: number, paused: boolean): Promise<void>;
  end(): Promise<void>;
}

const native = requireOptionalNativeModule<Native>('WorkoutActivity');

/** Whether the lock-screen clock can appear at all. False on Android, on iOS
 *  below 16.2, and for a member who has switched Live Activities off. */
export function liveActivitySupported(): boolean {
  try { return native?.isSupported() ?? false; } catch { return false; }
}

/** Put the clock on the lock screen. `startedAt` is the session's own wall
 *  clock in MILLISECONDS — the same figure the runner counts from — converted
 *  here because ActivityKit speaks seconds. */
export async function startLiveActivity(activity: string, startedAtMs: number, pausedMs = 0): Promise<void> {
  try { await native?.start(activity, startedAtMs / 1000, pausedMs); } catch { /* the workout carries on */ }
}

/** Tell it the session paused or resumed. NOT called on a tick: the widget
 *  counts from a date by itself, so a per-second update would wake the app
 *  once a second to redraw a figure the system is already drawing. */
export async function updateLiveActivity(startedAtMs: number, pausedMs: number, paused: boolean): Promise<void> {
  try { await native?.update(startedAtMs / 1000, pausedMs, paused); } catch { /* ignore */ }
}

/** Take it off. Called at every door out of a session — finish, close,
 *  discard — for the same reason the persisted record is cleared there. */
export async function endLiveActivity(): Promise<void> {
  try { await native?.end(); } catch { /* ignore */ }
}
