// Push + local notifications. Native modules (expo-notifications / expo-device)
// only exist in a build that included them, so every access is defensively
// wrapped — on the current build (before the notifications rebuild) this file
// no-ops instead of crashing, and lights up automatically once rebuilt.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { inboxDecision, safeRoute } from '../lib/notifyInbox';
import { pushConsent } from '../lib/pushConsent';
import { allows, categoryForRoute, timeToDeliver, whenToDeliver, type NotifyCategory } from '../lib/notifyPrefs';
import { notifyPrefs } from '../lib/notifyPrefsLatch';
import { VARIANT, type AppVariant } from '../lib/variant';
import type { CoachChannel } from '../lib/coachNotify';

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
 * Returns that count, and whether it is a COUNT or a FLOOR — see
 * `NOTIFY_USERS_CAP`. 0 covers "not worth recording", "signed out", "refused"
 * and "nobody eligible" — callers that need to distinguish should look at
 * `sendPushChecked`, which reports the send separately.
 */
/**
 * The ceiling inside `notify_users()`.
 *
 * ── Why this number is written down twice ─────────────────────────────────
 *
 * supabase/parts/122 ends its recipient CTE with `limit 2000`. That is a
 * ceiling the CLIENT CANNOT SEE. src/lib/rowCap.ts's whole mechanism is asking
 * for one row more than you will accept — `capLimit()` — and it is useless
 * here, because a `.limit()` written inside a `create function` body can only
 * ever be narrowed by the caller, never exceeded. So `capped()` is blind to it,
 * and this function's return value stopped being a count at two thousand and
 * one recipients without anything saying so.
 *
 * What that did: a gym owner announcing a closure to 2,400 members was told
 * "2,000 people have it in their notifications", which is a true number about
 * a set that is not the one they addressed. Four hundred people were neither
 * notified nor counted, and the sentence they were counted out of read as a
 * complete answer. It is the same defect send-push had at a thousand HANDSETS
 * (see `readAllFor` there), one layer up and one table over.
 *
 * The cap is not raised here, and deliberately: two thousand notification rows
 * in one statement is already a large write, and moving the ceiling moves the
 * cliff without removing it — the argument src/lib/rowCap.ts makes about
 * `.limit(5000)`. What changes is that the caller can now tell the difference
 * between a count and a floor, and say "at least".
 *
 * Paired with the SQL by scripts/check-sql-caps.mjs, which reads both numbers
 * and fails by name the moment they disagree.
 */
export const NOTIFY_USERS_CAP = 2000;

/** What `recordInbox` managed, and whether that is the whole of it. */
export interface InboxRecord {
  /** Rows `notify_users()` wrote. */
  recorded: number;
  /**
   * More people were addressed than `notify_users()` will consider in one
   * call, so `recorded` is a FLOOR and the people past the ceiling were
   * neither written to nor counted.
   *
   * Decided from the length of the request rather than from the answer, and
   * that is what makes it knowable at all: the server returns a number with no
   * indication of what it stopped at, but the caller knows exactly how many
   * people it asked about.
   */
  atCap: boolean;
  /**
   * Whether an inbox row was EVEN MEANT to be written.
   *
   * False is `inboxDecision` refusing this kind — a chat message whose row the
   * `messages` trigger writes, a class-off whose row part 493 writes, or a
   * race for a slot that is over before an inbox is opened. `recorded` is then
   * 0 BY POLICY and is not evidence of anything.
   *
   * Nothing could tell those two zeroes apart, and one caller was reporting
   * the wrong one out loud: app/(trainer)/calendar.tsx re-offers a freed slot
   * with the title 'A slot just opened', which `notifyInbox` deliberately does
   * not keep, so `recorded` came back 0 every single time and
   * `reofferConfirmation` told the coach "the server recorded the notification
   * for nobody — so none of your N clients has it in their notifications.
   * Message them yourself, or try again." on a send that had gone out
   * perfectly. A screen cannot measure a row that was never going to exist.
   */
  kept: boolean;
}

export async function recordInbox(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<InboxRecord> {
  if (!USE_SUPABASE) return { recorded: 0, atCap: false, kept: false };
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length) return { recorded: 0, atCap: false, kept: false };
  const route = typeof data?.route === 'string' ? data.route : null;
  const decision = inboxDecision(title, body, route);
  if (!decision.record) return { recorded: 0, atCap: false, kept: false };
  // Stated whatever happens below, including on a refusal: "we asked about more
  // people than this call can hold" is true of the request and does not depend
  // on the answer.
  const atCap = ids.length > NOTIFY_USERS_CAP;
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
    if (error) return { recorded: 0, atCap, kept: true };
    const count = Number(n ?? 0);
    return { recorded: Number.isFinite(count) && count > 0 ? count : 0, atCap, kept: true };
  } catch { return { recorded: 0, atCap, kept: true }; }
}

/**
 * Which category of coach notification this send belongs to.
 *
 * OPTIONAL, and the optionality is the compatibility story: a send with no
 * channel is not filtered by the edge function at all, so every existing call
 * site keeps working unchanged and nothing is suppressed by a preference the
 * recipient was never shown a switch for.
 *
 * Passed straight through to send-push and applied THERE, where the recipients
 * are resolved — not here, and not at the call sites. Same argument the master
 * switch makes about `push_tokens`: a check at the call site is a check
 * somebody forgets at the next one, and the gate has to be somewhere a sender
 * cannot route around. See src/lib/coachNotify.ts.
 *
 * It suppresses the PUSH and never the inbox row: `recordInbox` below runs
 * regardless, so a muted category is still in the coach's notifications list.
 */
export type PushChannel = CoachChannel;

/** Fire a remote push to specific users via the send-push edge function.
 *  Best-effort and safe to call today: no tokens / undeployed function → silent
 *  no-op. Recipients receive it once they're on a push-enabled build.
 *
 *  Also records an inbox row where one is warranted — deliberately not awaited
 *  here, because this function's whole contract is that it does not make the
 *  caller wait and does not report. A caller that needs to know used
 *  sendPushChecked() already. */
export async function sendPush(userIds: string[], title: string, body: string, data?: Record<string, unknown>, channel?: PushChannel): Promise<void> {
  if (!USE_SUPABASE) return;
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length) return;
  void recordInbox(ids, title, body, data).catch(() => { /* best-effort, like the send */ });
  try { supabase.functions.invoke('send-push', { body: { user_ids: ids, title, body, data: data || {}, ...(channel ? { channel } : {}) } }).then(() => {}, () => {}); } catch { /* best-effort */ }
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
 *  open the app" now has something true to say it on.
 *
 *  ── `partial`, and the floor that was being read as a total ──────────────
 *
 *  send-push used to truncate a broadcast at the first PostgREST page — a
 *  thousand handsets — and return `sent: 1000` for a gym of four hundred
 *  members with a phone and a tablet each. It now pages, and it reports
 *  `partial: true` when a chunk failed or ran off its page ceiling, so `sent`
 *  is a floor rather than the total.
 *
 *  Nothing read that flag. `invoke` hands the function's JSON back as `data`
 *  and this function discarded it, so every caller in this repository was still
 *  taking `ok: true` for "it went to everybody" — the same defect one layer
 *  further out, and the reason `ok` alone was never enough. It is surfaced here
 *  rather than at the seven call sites for the reason the channel filter gives:
 *  a caller that has to remember is a caller that forgets.
 *
 *  It is a THIRD fact, not a flavour of `ok`. The send was accepted; some of
 *  the recipient list could not be read. A screen that says nothing about it
 *  keeps exactly the meaning it had.
 *
 *  ── `inboxKept`, and the zero that was never a measurement ───────────────
 *
 *  `recorded: 0` had two causes and no way to tell them apart: `notify_users`
 *  wrote nothing, or `notifyInbox` refused to keep this kind of notification
 *  at all. See `InboxRecord.kept` — a caller that reports the second as the
 *  first tells a coach nobody was told over a send that worked. */
export async function sendPushChecked(userIds: string[], title: string, body: string, data?: Record<string, unknown>, channel?: PushChannel): Promise<{ ok: boolean; error?: string; recorded: number; recordedAtCap?: boolean; inboxKept?: boolean; partial?: boolean }> {
  if (!USE_SUPABASE) return { ok: false, error: 'Not connected to the server.', recorded: 0, inboxKept: false };
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length) return { ok: false, error: 'Nobody to send to.', recorded: 0, inboxKept: false };
  // Awaited, and BEFORE the send. The row is the durable half of this — a push
  // is gone the moment it is dismissed and does not exist at all on a build
  // without expo-notifications — so if only one of the two can happen, it
  // should be the one that survives.
  //
  // `atCap` rides out with the count for the same reason `partial` does below:
  // both are the difference between a number and a floor, and a caller that
  // cannot see them can only ever report the floor as the total.
  const { recorded, atCap, kept } = await recordInbox(ids, title, body, data);
  try {
    const { data: res, error } = await supabase.functions.invoke('send-push', { body: { user_ids: ids, title, body, data: data || {}, ...(channel ? { channel } : {}) } });
    if (error) return { ok: false, error: error.message, recorded, recordedAtCap: atCap, inboxKept: kept };
    // Only an explicit `true` counts. An older deployment of send-push omits
    // the field entirely, and reading a missing flag as "incomplete" would put
    // a warning under every announcement on a server where nothing is wrong.
    return { ok: true, recorded, recordedAtCap: atCap, inboxKept: kept, partial: (res as any)?.partial === true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not reach the server.', recorded, recordedAtCap: atCap, inboxKept: kept };
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
          // `error` is READ, and the two lines below say exactly why it has to
          // be. supabase-js does not reject on a database error — it resolves,
          // with `error` set — so `await` returning here proved nothing at all,
          // and this file shipped the invariant in its own comment broken by
          // the missing line the comment never thought to ask for.
          //
          // Two things went wrong when the upsert was refused. The note was
          // written for a row that does not exist, which is precisely what
          // sends `revokePushToken` hunting for something that was never there
          // — and it reported success over it. And this function returned the
          // token, so src/ui/settings.tsx drew the switch ON for a handset with
          // no delivery address in the table: a member turning notifications on
          // was shown that they were on and would never receive one.
          const { error: tokErr } = await supabase.from('push_tokens')
            .upsert({ user_id: uid, token, platform: 'expo' }, { onConflict: 'token' });
          if (tokErr) {
            reportError('pushNotifications.register', tokErr, { uid });
            // Not remembered, and not returned. Null here is what the settings
            // screen already renders as 'os-refused' — the honest reading of
            // "we could not make this handset reachable", whether the OS or the
            // database is what refused.
            return null;
          }
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

/**
 * Schedule a local reminder (e.g. a booked session) at a future date.
 *
 * ── Why the category gate is HERE ──────────────────────────────────────────
 *
 * Every local notification this app sends goes through this function or
 * `scheduleDailyReminder` below — session reminders, class reminders, the
 * streak nudge, badge unlocks, hydration, supplements. The member's
 * per-category switches and quiet hours are therefore applied in these two
 * places rather than at the six call sites, for the reason `registerForPush`
 * gives one screen up: a gate a caller cannot skip cannot be forgotten, and the
 * next call site added would have been the seventh chance to forget it.
 *
 * `category` is optional and an omitted one is always delivered. Existing
 * callers that predate the categories keep working unchanged, and a
 * notification nobody has categorised is sent rather than silently dropped —
 * the safe direction, because the failure of a missed gate is a banner somebody
 * did not want, and the failure of a default-deny is a session reminder that
 * never arrives.
 *
 * Quiet hours SHIFT rather than suppress: see `whenToDeliver`. A reminder that
 * never arrives is indistinguishable from a broken one.
 */
export async function scheduleLocal(title: string, body: string, date: Date, data?: Record<string, unknown>, category?: NotifyCategory): Promise<string | null> {
  if (!Notifications) return null;
  try {
    const prefs = notifyPrefs();
    // ── the omitted category, filled from the route ──────────────────────
    //
    // `if (category && …)` means an omitted category is no gate at all, and
    // exactly one caller in the three apps omits it: src/ui/badgeWatch.tsx,
    // which schedules the badge banner with a route and no category. So a
    // member who turned OFF 'Streaks And Badges' — a switch whose own label
    // says "when you unlock a badge" — went on being congratulated, and one
    // with quiet hours got the congratulation at midnight, because
    // `motivation` is quietable and nothing asked.
    //
    // Filled here rather than at that call site for the reason `registerForPush`
    // gives about the consent gate two screens up: a gate a caller can skip is
    // a gate the next caller skips, and the one that skipped it is the one
    // whose switch stopped working. `categoryForRoute` is the decision and it
    // is in src/lib/notifyPrefs.ts under test; an explicit category always
    // wins, and a route nobody has classified is still delivered ungated.
    const cat = category ?? categoryForRoute(typeof data?.route === 'string' ? data.route : null) ?? undefined;
    if (cat && !allows(cat, prefs)) return null;
    const at = cat ? whenToDeliver(date, cat, prefs) : date;
    if (at.getTime() <= Date.now()) return null;
    // The id, returned rather than discarded. It used to resolve to void, so
    // nothing that scheduled a one-off could ever take it back — which is fine
    // for a booking's warning (it is armed once) and wrong for anything armed
    // repeatedly, because a member who opens the app four times on a Tuesday
    // would collect four identical banners for 7pm. Every existing caller
    // ignores the return and is unaffected.
    return (await Notifications.scheduleNotificationAsync({ content: { title, body, data: data || {} }, trigger: { type: 'date', date: at } })) ?? null;
  } catch { return null; }
}

/** Schedule a reminder that repeats every day at hour:minute. Returns the
 *  notification id so it can be cancelled individually (leaving other
 *  scheduled notifications, e.g. booked sessions, untouched). No-ops until the
 *  notifications-enabled build. */
export async function scheduleDailyReminder(title: string, body: string, hour: number, minute: number, data?: Record<string, unknown>, category?: NotifyCategory): Promise<string | null> {
  if (!Notifications) return null;
  try {
    const prefs = notifyPrefs();
    if (category && !allows(category, prefs)) return null;
    // A repeating trigger has an hour and no date, so quiet hours move the TIME
    // rather than pushing an instant forward. Same rule, stated separately in
    // notifyPrefs.ts so that a daily trigger cannot be accidentally pinned to
    // today's calendar on the way through.
    //
    // Hour AND minute. `hourToDeliver` answered with an hour, so everything
    // moved out of quiet hours landed on the top of it — a 22:00 and a 23:00
    // nudge both at 07:00:00.000, where the OS collapses them into one banner
    // and the member loses the rest.
    const when = category ? timeToDeliver(hour, minute, category, prefs) : { hour, minute };
    if (Notifications.getPermissionsAsync) {
      let status = (await Notifications.getPermissionsAsync())?.status;
      if (status !== 'granted') status = (await Notifications.requestPermissionsAsync())?.status;
      if (status !== 'granted') return null;
    }
    return await Notifications.scheduleNotificationAsync({ content: { title, body, data: data || {} }, trigger: { type: 'daily', hour: when.hour, minute: when.minute } });
  } catch { return null; }
}

/**
 * The same daily reminder, but on chosen weekdays only.
 *
 * ── Why this could not be done at the call site ───────────────────────────
 *
 * `scheduleDailyReminder` takes no weekday and expo-notifications has no
 * "these days" trigger — it has `weekly`, which fires on ONE weekday. So a
 * reminder for Monday, Wednesday and Friday is three scheduled notifications,
 * not one, and this returns the list of ids they were given so
 * `cancelReminders` can take them all back together. A caller assembling that
 * by hand would eventually cancel two of three and leave one firing forever
 * with nothing on any screen to explain it.
 *
 * `weekdays` are 1–7 with 1 = Sunday, which is expo-notifications' own
 * convention and NOT JavaScript's 0–6. The two differ by one and nothing warns
 * about it, so the conversion is done once, here, by the only function that
 * takes weekdays at all.
 *
 * An empty list schedules nothing and returns nothing — a reminder on no days
 * is a reminder that does not exist, and inventing "every day" from it would be
 * answering a question the member did not answer.
 */
export async function scheduleWeeklyReminders(
  title: string, body: string, weekdays: readonly number[], hour: number, minute: number,
  data?: Record<string, unknown>, category?: NotifyCategory,
): Promise<string[]> {
  if (!Notifications || !weekdays.length) return [];
  const prefs = notifyPrefs();
  if (category && !allows(category, prefs)) return [];
  // Hour and minute together — see `scheduleDailyReminder` above for what
  // moving only the hour did to a window full of reminders.
  const when = category ? timeToDeliver(hour, minute, category, prefs) : { hour, minute };
  try {
    if (Notifications.getPermissionsAsync) {
      let status = (await Notifications.getPermissionsAsync())?.status;
      if (status !== 'granted') status = (await Notifications.requestPermissionsAsync())?.status;
      if (status !== 'granted') return [];
    }
  } catch { return []; }
  const ids: string[] = [];
  for (const w of weekdays) {
    if (!Number.isInteger(w) || w < 1 || w > 7) continue;
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: { title, body, data: data || {} },
        trigger: { type: 'weekly', weekday: w, hour: when.hour, minute: when.minute },
      });
      if (id) ids.push(id);
    } catch {
      // One weekday failing does not cancel the others. The caller counts what
      // came back and says how many were actually set, which is the only honest
      // figure — see the "Reminders set" alert on the reminders screen.
    }
  }
  return ids;
}

/**
 * Tell somebody their rest is over when the app is not on screen.
 *
 * ── Why this exists next to the sound ──────────────────────────────────────
 *
 * src/ui/sounds.ts makes a noise when the runner is in front of the member. It
 * cannot make one from a pocket: the audio session is deliberately `.ambient`
 * so it obeys the mute switch, which rules out background playback, and iOS
 * suspends a backgrounded app's JavaScript anyway — the interval that would
 * call playSound() is not running. A rest timer whose whole reason for storing
 * a wall-clock end instant is that the phone goes in a pocket cannot then be
 * silent in exactly that case, so the OS is asked to say it instead.
 *
 * ── What it will NOT do ────────────────────────────────────────────────────
 *
 * It never requests the notification permission. scheduleDailyReminder above
 * does, because a member setting a daily reminder has asked for notifications
 * by doing so; a member logging a set has not, and raising the system prompt
 * over a live workout — a prompt iOS shows once per install, ever — to deliver
 * a rest cue would spend the app's one chance on the least important
 * notification it sends. If permission is not already granted this returns null
 * and the rest timer is simply visual and haptic, which is what it was before.
 *
 * Returns the id so the caller can cancel it with `cancelReminders` — a member
 * who skips the rest, moves to the next exercise or ends the session must not
 * get an alert about a rest that is no longer happening.
 */
export async function scheduleRestOverAlert(date: Date, title: string, body: string): Promise<string | null> {
  if (!Notifications) return null;
  try {
    if (date.getTime() <= Date.now()) return null;
    // Asked, never requested. See above.
    const status = (await Notifications.getPermissionsAsync?.())?.status;
    if (status !== 'granted') return null;
    return await Notifications.scheduleNotificationAsync({
      // No `data.route`. Every other notification in this app routes somewhere
      // on tap; this one is about the screen the member is already on, and
      // pushing the runner's own route on top of a live session is how the
      // component holding an hour of unsaved sets gets remounted.
      content: { title, body, sound: true },
      trigger: { type: 'date', date },
    });
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
