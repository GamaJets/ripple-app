// Push + local notifications. Native modules (expo-notifications / expo-device)
// only exist in a build that included them, so every access is defensively
// wrapped — on the current build (before the notifications rebuild) this file
// no-ops instead of crashing, and lights up automatically once rebuilt.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

let Notifications: any = null;
let Device: any = null;
try { Notifications = require('expo-notifications'); } catch { /* not in this build yet */ }
try { Device = require('expo-device'); } catch { /* optional */ }

export const pushAvailable = () => !!Notifications;

/** Fire a remote push to specific users via the send-push edge function.
 *  Best-effort and safe to call today: no tokens / undeployed function → silent
 *  no-op. Recipients receive it once they're on a push-enabled build. */
export async function sendPush(userIds: string[], title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  if (!USE_SUPABASE) return;
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length) return;
  try { supabase.functions.invoke('send-push', { body: { user_ids: ids, title, body, data: data || {} } }).then(() => {}, () => {}); } catch { /* best-effort */ }
}

/** Same send, but awaited and reporting what happened. Use this anywhere the UI
 *  is about to tell someone a message was delivered — sendPush() above discards
 *  both outcomes, so a screen built on it can only ever claim success. */
export async function sendPushChecked(userIds: string[], title: string, body: string, data?: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!USE_SUPABASE) return { ok: false, error: 'Not connected to the server.' };
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length) return { ok: false, error: 'Nobody to send to.' };
  try {
    const { error } = await supabase.functions.invoke('send-push', { body: { user_ids: ids, title, body, data: data || {} } });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not reach the server.' };
  }
}

if (Notifications?.setNotificationHandler) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
        shouldShowBanner: true, shouldShowList: true,
      }),
    });
  } catch { /* ignore */ }
}

/** Request permission, get the Expo push token, and save it for this user. */
export async function registerForPush(): Promise<string | null> {
  if (!Notifications) return null;
  try {
    if (Device && Device.isDevice === false) return null;
    let status = (await Notifications.getPermissionsAsync())?.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync())?.status;
    if (status !== 'granted') return null;
    const token = (await Notifications.getExpoPushTokenAsync())?.data ?? null;
    if (token && USE_SUPABASE) {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (uid) await supabase.from('push_tokens').upsert({ user_id: uid, token, platform: 'expo' }, { onConflict: 'token' });
      } catch { /* best-effort */ }
    }
    return token;
  } catch { return null; }
}

/** Schedule a local reminder (e.g. a booked session) at a future date. */
export async function scheduleLocal(title: string, body: string, date: Date, data?: Record<string, unknown>): Promise<void> {
  if (!Notifications) return;
  try {
    if (date.getTime() <= Date.now()) return;
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: data || {} }, trigger: { type: 'date', date } });
  } catch { /* ignore */ }
}

/** Schedule a reminder that repeats every day at hour:minute. Returns the
 *  notification id so it can be cancelled individually (leaving other
 *  scheduled notifications, e.g. booked sessions, untouched). No-ops until the
 *  notifications-enabled build. */
export async function scheduleDailyReminder(title: string, body: string, hour: number, minute: number, data?: Record<string, unknown>): Promise<string | null> {
  if (!Notifications) return null;
  try {
    if (Notifications.getPermissionsAsync) {
      let status = (await Notifications.getPermissionsAsync())?.status;
      if (status !== 'granted') status = (await Notifications.requestPermissionsAsync())?.status;
      if (status !== 'granted') return null;
    }
    return await Notifications.scheduleNotificationAsync({ content: { title, body, data: data || {} }, trigger: { type: 'daily', hour, minute } });
  } catch { return null; }
}

/** Cancel specific scheduled reminders by id (from scheduleDailyReminder). */
export async function cancelReminders(ids: string[]): Promise<void> {
  if (!Notifications || !ids || !ids.length) return;
  for (const id of ids) { try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* ignore */ } }
}

/** Route when a notification is tapped (content.data.route). Handles both a tap
 *  while running and the tap that cold-launches the app. Returns an unsubscribe. */
export function addNotificationTapListener(onRoute: (route: string) => void): () => void {
  if (!Notifications?.addNotificationResponseReceivedListener) return () => {};
  const handle = (resp: any) => {
    const r = resp?.notification?.request?.content?.data?.route;
    if (r) onRoute(String(r));
  };
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  try { Notifications.getLastNotificationResponseAsync?.().then((resp: any) => { if (resp) handle(resp); }); } catch { /* ignore */ }
  return () => { try { sub?.remove?.(); } catch { /* ignore */ } };
}
