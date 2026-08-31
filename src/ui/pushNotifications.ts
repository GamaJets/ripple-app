// Push + local notifications. Native modules (expo-notifications / expo-device)
// only exist in a build that included them, so every access is defensively
// wrapped — on the current build (before the notifications rebuild) this file
// no-ops instead of crashing, and lights up automatically once rebuilt.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { inboxDecision } from '../lib/notifyInbox';

let Notifications: any = null;
let Device: any = null;
try { Notifications = require('expo-notifications'); } catch { /* not in this build yet */ }
try { Device = require('expo-device'); } catch { /* optional */ }

export const pushAvailable = () => !!Notifications;

/**
 * Write the notification down as well as sending it.
 *
 * ── Why this is here and not at the eleven call sites ─────────────────────
 *
 * A push is fire-and-forget. It exists for as long as a banner is on screen,
 * it is gone when it is swiped, and on the CURRENT binary it does not exist at
 * all — expo-notifications is not in this build, so everything above this line
 * no-ops and every "Session cancelled" this product has ever sent reached
 * nobody. `notifications` has been in the schema since part 01 with one writer
 * (the notify-message edge function) and no reader anywhere.
 *
 * So the two send functions below now also record a row, which reaches every
 * existing call site at once and, more importantly, reaches the next one
 * without anybody remembering to. src/lib/notifyInbox.ts decides which sends
 * are worth a row: chat is excluded because the `messages` trigger already
 * writes one, and an inbox that duplicated every conversation would be worse
 * than no inbox.
 *
 * ── Why an RPC and not an insert ──────────────────────────────────────────
 *
 * `notif_self` is `for all using (user_id = auth.uid())`, and Postgres uses a
 * FOR ALL policy's USING expression as its insert check when no WITH CHECK is
 * given. So an authenticated account may write to its OWN inbox and nobody
 * else's — which is backwards for every notification worth having, since all of
 * them are addressed to the other party. `notify_users()` (part 122) is a
 * SECURITY DEFINER function that checks the coach/client/owner relationship per
 * recipient and skips the ones the caller may not reach; it returns how many
 * rows it actually wrote, which is the only honest answer to "did that land".
 *
 * Returns that count. 0 covers "not worth recording", "signed out", "refused"
 * and "nobody eligible" — callers that need to distinguish should look at
 * `sendPushChecked`, which reports the send separately.
 */
export async function recordInbox(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<number> {
  if (!USE_SUPABASE) return 0;
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length) return 0;
  const route = typeof data?.route === 'string' ? data.route : null;
  const decision = inboxDecision(title, body, route);
  if (!decision.record) return 0;
  try {
    const { data: n, error } = await supabase.rpc('notify_users', {
      p_user_ids: ids,
      p_title: title,
      p_body: body,
      p_icon: decision.icon,
      p_route: route,
    });
    // `error` is read rather than the count being trusted on its own: an
    // undeployed function and a function that wrote nothing both hand back a
    // falsy `data`, and reporting the first as "recorded 0" would be true by
    // accident rather than by measurement.
    if (error) return 0;
    const count = Number(n ?? 0);
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch { return 0; }
}

/** Fire a remote push to specific users via the send-push edge function.
 *  Best-effort and safe to call today: no tokens / undeployed function → silent
 *  no-op. Recipients receive it once they're on a push-enabled build.
 *
 *  Also records an inbox row where one is warranted — deliberately not awaited
 *  here, because this function's whole contract is that it does not make the
 *  caller wait and does not report. A caller that needs to know used
 *  sendPushChecked() already. */
export async function sendPush(userIds: string[], title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  if (!USE_SUPABASE) return;
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length) return;
  void recordInbox(ids, title, body, data).catch(() => { /* best-effort, like the send */ });
  try { supabase.functions.invoke('send-push', { body: { user_ids: ids, title, body, data: data || {} } }).then(() => {}, () => {}); } catch { /* best-effort */ }
}

/** Same send, but awaited and reporting what happened. Use this anywhere the UI
 *  is about to tell someone a message was delivered — sendPush() above discards
 *  both outcomes, so a screen built on it can only ever claim success.
 *
 *  `recorded` is how many inbox rows were written, which is a DIFFERENT
 *  question from whether the push went out and can succeed when the push fails
 *  (and vice versa: chat is pushed and deliberately not recorded). It is added
 *  rather than folded into `ok` so that no existing caller's meaning changes —
 *  `ok` still means exactly what it meant, which is "the send-push function
 *  accepted this". A screen that wants to say "they will see it next time they
 *  open the app" now has something true to say it on. */
export async function sendPushChecked(userIds: string[], title: string, body: string, data?: Record<string, unknown>): Promise<{ ok: boolean; error?: string; recorded: number }> {
  if (!USE_SUPABASE) return { ok: false, error: 'Not connected to the server.', recorded: 0 };
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length) return { ok: false, error: 'Nobody to send to.', recorded: 0 };
  // Awaited, and BEFORE the send. The row is the durable half of this — a push
  // is gone the moment it is dismissed and does not exist at all on a build
  // without expo-notifications — so if only one of the two can happen, it
  // should be the one that survives.
  const recorded = await recordInbox(ids, title, body, data);
  try {
    const { error } = await supabase.functions.invoke('send-push', { body: { user_ids: ids, title, body, data: data || {} } });
    if (error) return { ok: false, error: error.message, recorded };
    return { ok: true, recorded };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not reach the server.', recorded };
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
