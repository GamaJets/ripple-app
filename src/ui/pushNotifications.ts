// Push + local notifications. Native modules (expo-notifications / expo-device)
// only exist in a build that included them, so every access is defensively
// wrapped — on the current build (before the notifications rebuild) this file
// no-ops instead of crashing, and lights up automatically once rebuilt.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { inboxDecision, safeRoute } from '../lib/notifyInbox';
import { pushConsent } from '../lib/pushConsent';
import { VARIANT, type AppVariant } from '../lib/variant';

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

/**
 * The last token this handset actually put into `push_tokens`.
 *
 * ── Why the token has to be written down ───────────────────────────────────
 *
 * Revoking is a delete keyed on the token, because `push_tokens` is keyed on
 * the token and a member may be signed in on a second handset whose own answer
 * is yes — deleting by user_id would silence a phone whose owner never asked
 * for that. But getExpoPushTokenAsync() only answers while the OS permission is
 * granted, and the commonest way to end up with a row that should not exist is
 * exactly the case where it is NOT: somebody registered, then turned
 * notifications off for this app in the phone's own Settings, and only later
 * turned the switch off in here. At that moment the OS will not name the token,
 * the row is still in the table, and a revoke that could not identify it would
 * report success over a row that goes on being a delivery address the day they
 * re-enable the OS permission.
 *
 * So the token is remembered on the device the moment it is registered, and
 * forgotten only when its row is confirmed gone.
 */
const LAST_TOKEN_KEY = 'repple.pushToken';

async function rememberToken(token: string): Promise<void> {
  try { await AsyncStorage.setItem(LAST_TOKEN_KEY, token); } catch { /* the delete falls back to the OS token */ }
}

/** Called only once the row is confirmed gone — see revokePushToken. */
export async function forgetRegisteredToken(): Promise<void> {
  try { await AsyncStorage.removeItem(LAST_TOKEN_KEY); } catch { /* harmless: a stale note causes one extra delete */ }
}

/**
 * Every token that could still name a row belonging to THIS handset, without
 * asking the OS for anything.
 *
 * Deliberately never calls requestPermissionsAsync. This is the reader the
 * revoke path uses, and raising a permission prompt at somebody in the act of
 * turning notifications OFF would be absurd as well as wrong — the prompt is
 * shown once per install and cannot be taken back.
 *
 * Returns both the live token and the remembered one when they differ. Expo can
 * mint a new token for the same handset (a reinstall, a restored backup), and
 * the old row does not disappear when it does; a revoke that removed only one
 * of the two would leave the member reachable and be told it had succeeded.
 */
export async function handsetPushTokens(): Promise<string[]> {
  const found: string[] = [];
  try {
    const remembered = await AsyncStorage.getItem(LAST_TOKEN_KEY);
    if (remembered) found.push(remembered);
  } catch { /* fall through to whatever the OS will tell us */ }
  if (Notifications) {
    try {
      if (!(Device && Device.isDevice === false)) {
        const status = (await Notifications.getPermissionsAsync())?.status;
        // Not granted means the OS will not mint a token, and asking it to is
        // the one thing this function must not do.
        if (status === 'granted') {
          const live = (await Notifications.getExpoPushTokenAsync())?.data ?? null;
          if (live && !found.includes(live)) found.push(live);
        }
      }
    } catch { /* the remembered token is still worth deleting */ }
  }
  return found;
}

/**
 * Request permission, get the Expo push token, and save it for this user.
 *
 * ── The consent gate, and why it is HERE ───────────────────────────────────
 *
 * This function does two irreversible-ish things: it raises the OS notification
 * prompt (shown once per install) and it writes a deliverable address into
 * `push_tokens`, which is the table send-push resolves recipients from. Neither
 * may happen to somebody whose stored answer is no.
 *
 * The gate is inside the function rather than at its call sites because there
 * were three call sites, one of them in src/ui/auth.tsx firing on EVERY sign-in
 * with no idea what the member had chosen — and the next call site added would
 * have been the fourth chance to forget. A gate a caller cannot skip cannot be
 * forgotten. `pushConsent()` is read synchronously, so there is no window
 * between checking and acting.
 *
 * 'unknown' returns null and asks the OS for nothing. That is the launch-time
 * window before the stored preference has been read back, and the rule for it
 * is written out in src/lib/pushConsent.ts: registering one launch later costs
 * a launch, while prompting somebody who said no cannot be undone. The provider
 * in src/ui/settings.tsx calls this again the moment the answer is known, so
 * "later" is milliseconds, not a launch, on all but a failed read.
 */
export async function registerForPush(): Promise<string | null> {
  // Not `!== 'no'`. 'unknown' is not permission either — see above.
  if (pushConsent() !== 'yes') return null;
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
        if (uid) {
          await supabase.from('push_tokens').upsert({ user_id: uid, token, platform: 'expo' }, { onConflict: 'token' });
          // After the upsert, not before: the note is a record of what is in
          // the table, and a note written for a row that was never inserted
          // would send the revoke hunting for something that never existed.
          await rememberToken(token);
        }
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

/** This build's own inbox, written out in full — see the same table in
 *  src/ui/notifications.tsx: a route assembled from the group at runtime is
 *  invisible to scripts/check-reachable.mjs. */
const INBOX_ROUTE: Record<AppVariant, string> = {
  client: '/(client)/notifications',
  trainer: '/(trainer)/notifications',
  owner: '/(owner)/notifications',
};

/**
 * Route when a notification is tapped (content.data.route). Handles both a tap
 * while running and the tap that cold-launches the app. Returns an unsubscribe.
 *
 * ── Why the route is checked here and not by the caller ────────────────────
 *
 * `data.route` arrives from OUTSIDE the app. It is whatever the send-push edge
 * function was handed, and notify_users() next door caps the length of the
 * stored copy and checks nothing else about it, on purpose — the database is
 * not where this app's list of screens belongs. The caller is app/_layout.tsx,
 * which does `router.push(route as any)`: an external URL, a traversal, or a
 * route naming a group this binary does not contain all reach expo-router
 * unexamined. The inbox already refuses those on the way out of the table
 * (safeRoute, src/lib/notifyInbox.ts); the push path is the same untrusted
 * string arriving by the other door, and it was not being checked at all.
 *
 * ── Where an unusable route goes ───────────────────────────────────────────
 *
 * To this build's inbox, not to nowhere and not to the front door. These are
 * three binaries from one tree and each contains only its own route group, so
 * the commonest unusable route is not an attack — it is a coach's
 * '/(trainer)/calendar' notification read on a phone running the client app
 * after a role change or on a shared account. The thing the person tapped is a
 * notification, the notification is recorded in the inbox, and the inbox is a
 * screen this build definitely has. What is NOT invented is a destination for
 * the notification's SUBJECT: the inbox row itself says "Nothing to open" when
 * its route is one this app will not follow.
 */
export function addNotificationTapListener(onRoute: (route: string) => void): () => void {
  if (!Notifications?.addNotificationResponseReceivedListener) return () => {};
  const handle = (resp: any) => {
    const r = resp?.notification?.request?.content?.data?.route;
    if (!r) return;
    onRoute(safeRoute(String(r), VARIANT) ?? INBOX_ROUTE[VARIANT]);
  };
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  try { Notifications.getLastNotificationResponseAsync?.().then((resp: any) => { if (resp) handle(resp); }); } catch { /* ignore */ }
  return () => { try { sub?.remove?.(); } catch { /* ignore */ } };
}
