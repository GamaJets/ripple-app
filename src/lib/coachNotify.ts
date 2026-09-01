// Which notifications a COACH wants, and the one place the answer can be
// honoured.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// app/(trainer)/settings.tsx has one switch: "Push Notifications". It does not
// filter sends — it takes this handset's row OUT of `push_tokens`, which is the
// table the send-push edge function resolves recipients from — so it is
// all-or-nothing by construction. `notifyInbox.ts` catalogues roughly a dozen
// coach-directed triggers behind it: a client's chat message, a booking, a
// cancellation, a coaching request, an accepted document, an intake coming
// back, a subscription starting, a subscription payment FAILING, a package
// bought, a review, a signed release.
//
// So a coach who mutes to stop 11pm chat pings also stops hearing that a
// client's card was declined and that somebody booked tomorrow morning. They
// will not turn it back on, because turning it back on brings back the 11pm
// pings, and the app has no way to know it has stopped telling them their
// subscriptions are failing.
//
// ── Why this cannot work the way the member's version works ───────────────
//
// src/lib/notifyPrefs.ts is the member's per-category control and it is
// scrupulous about its own limits: it offers switches ONLY for notifications
// this app schedules locally, and says plainly that the remote ones follow the
// single switch. `CategoryDef.local` is that line.
//
// Every coach-directed notification is remote. Every single one. Some are sent
// by another person's handset (a client's chat message, a client's booking) and
// the rest are written server-side by a trigger or an edge function. There is
// no local half at all, so a device-local preference would be a switch that
// reads "off" while the banner keeps arriving — the exact shape of the bug
// src/lib/pushConsent.ts was written for.
//
// The preference therefore lives on the SERVER, in `notify_channel_prefs`, and
// is applied where the recipients are resolved: supabase/functions/send-push
// and supabase/functions/notify-message. That is the same argument the master
// switch makes about `push_tokens` — the gate goes at the token, not at the two
// dozen call sites, because a call-site check is a check somebody forgets at
// the next one.
//
// ── What a muted channel does and does not do ─────────────────────────────
//
// It stops the PUSH. It does not stop the inbox row: `notify_users()` still
// writes it, the bell still shows it, and app/(trainer)/notifications.tsx still
// lists it. Muting is "do not buzz my phone about this", not "do not tell me" —
// and the difference matters most for the money channel, where a coach who
// muted the noise must still be able to find out that a payment failed.
// `CHANNEL_STILL_RECORDED` says so on the screen.
//
// ── An unread preference is not "opted in" ────────────────────────────────
//
// `ChannelState` has four values for the same reason `PushConsent` has three:
// the read is asynchronous and there is a real window in which nobody in this
// process knows the answer. A switch rendered ON during that window is the app
// telling a coach something about their own settings that it has not looked up
// — and a coach who then taps it has just written the value it was guessing.
// So 'unknown' renders as neither position, the switch does not move, and the
// row says why.
//
// Pure. The reads and writes are in src/ui/coachNotify.ts.
import type { LoadStatus } from '../ui/loadStatus';

/**
 * The channels a coach can mute independently.
 *
 * Five, and the grouping is by WHAT THE COACH WOULD DO ABOUT IT rather than by
 * which table the row came from. A coach silencing chat is silencing a
 * conversation; a coach silencing money is deciding they will look at Payments
 * themselves. Grouping by source would have put "a subscription payment failed"
 * next to "a package was bought" for no reason a coach cares about, and split
 * the two booking notifications across two switches because one is sent by a
 * handset and the other by a trigger.
 */
export type CoachChannel = 'chat' | 'bookings' | 'money' | 'clients' | 'admin';

export interface CoachChannelDef {
  key: CoachChannel;
  /** Title Case — a switch label. */
  title: string;
  /** Sentence case prose under it, naming what actually stops. */
  note: string;
  /**
   * Whether muting this is a decision the coach may come to regret quietly.
   *
   * True for `money`, and it is the only one. A missed chat message is visible
   * the next time they open the app; a failed subscription payment is a client
   * who has silently stopped paying, and the coach finds out at the end of the
   * month. `CHANNEL_QUIET_COST` is the sentence and it is shown under this
   * switch and no other, so it means something when it appears.
   */
  quietCost: boolean;
}

export const COACH_CHANNELS: readonly CoachChannelDef[] = [
  {
    key: 'chat', title: 'Client Messages', quietCost: false,
    note: 'A message from a client. This is the one that arrives at 11pm.',
  },
  {
    key: 'bookings', title: 'Bookings And Cancellations', quietCost: false,
    note: 'A client booking a session, cancelling one, or a slot re-opening.',
  },
  {
    key: 'money', title: 'Money', quietCost: true,
    note: 'A package bought, a subscription starting or ending, and a subscription payment failing.',
  },
  {
    key: 'clients', title: 'Joining And Leaving', quietCost: false,
    note: 'Somebody asking to be coached by you, and somebody ending their coaching.',
  },
  {
    key: 'admin', title: 'Paperwork', quietCost: false,
    note: 'An intake coming back, a document accepted, a release signed, and a review left.',
  },
];

/** The definition, or null for a channel this build does not know. */
export function channelDef(key: string): CoachChannelDef | null {
  return COACH_CHANNELS.find((c) => c.key === key) ?? null;
}

/**
 * What this process knows about one switch.
 *
 *   'on'      the coach's stored answer is on, or they have never answered and
 *             the product default is on.
 *   'off'     the coach turned it off.
 *   'unknown' nobody has read the answer yet, or the read failed. NOT "on".
 */
export type ChannelState = 'on' | 'off' | 'unknown';

/** Every channel the coach has explicitly turned off. A channel absent from the
 *  set has not been answered, which the product default reads as on — see
 *  `channelState`. */
export type MutedChannels = ReadonlySet<CoachChannel>;

/**
 * The rows as the table stores them → the muted set.
 *
 * Only an explicit `false` counts as off. A row holding a string, a null or
 * anything else is not an answer about somebody's notifications and reading it
 * as one would silence a channel they never touched. A channel name this build
 * does not recognise is dropped rather than kept, so a newer build's channel
 * cannot mute anything here by accident.
 */
export function mutedFromRows(rows: readonly { channel: string; enabled: unknown }[] | null | undefined): MutedChannels {
  const out = new Set<CoachChannel>();
  for (const r of rows ?? []) {
    if (r?.enabled !== false) continue;
    const def = channelDef(String(r.channel ?? ''));
    if (def) out.add(def.key);
  }
  return out;
}

/**
 * What the switch should read.
 *
 * `status` first, and it is not a formality: under 'loading' and 'error' the
 * muted set is empty, and an empty muted set means "everything on". Returning
 * 'on' there would render five switches in the on position over a read that has
 * not happened — the app stating five facts about somebody's settings that it
 * has not looked up, on the screen they went to in order to control them.
 *
 * 'partial' is 'unknown' too. A page of preferences is not a set of them, and
 * the one that did not arrive is the one being misreported.
 */
export function channelState(key: CoachChannel, muted: MutedChannels, status: LoadStatus): ChannelState {
  if (status !== 'ready') return 'unknown';
  return muted.has(key) ? 'off' : 'on';
}

/**
 * Whether a push on this channel may be sent, given what is known.
 *
 * The DEVICE never decides this — the server does, where the recipients are
 * resolved — and this function exists for the screen's own preview and for the
 * test. It defaults an unanswered channel to ON, which is the product default
 * and is what the server does too; the two must agree, because a screen showing
 * a switch on while the server suppressed the push would be the master switch's
 * original bug pointing the other way.
 */
export function channelAllows(key: CoachChannel, muted: MutedChannels): boolean {
  return !muted.has(key);
}

/**
 * What to say under the list when the preferences are not known.
 *
 * Null when they are, because a permanent explanatory paragraph under five
 * working switches is furniture.
 */
export function channelsNote(status: LoadStatus): string | null {
  if (status === 'loading') return 'Reading which of these you have turned off…';
  if (status === 'partial') return 'Only part of your notification settings came back, so none of these switches is showing a confirmed position. Turning one now would save over whatever is actually stored.';
  if (status === 'error') {
    return 'Your notification settings could not be read, so these switches are not showing your answers — they are showing nothing. That is a read that failed rather than everything being on. Turning one now would save over what is stored, so open this again once you have signal.';
  }
  return null;
}

/** What a switch in the unknown position says instead of on or off. */
export const CHANNEL_UNKNOWN_LABEL = 'Not read';

/**
 * That the master switch outranks all of these.
 *
 * Said on the screen because the relationship is not guessable: this handset's
 * row leaving `push_tokens` stops everything, whatever these five say, and a
 * coach who has the master switch off and then turns a channel on here would
 * otherwise expect a push that cannot arrive.
 */
export const CHANNEL_MASTER_NOTE =
  'These only matter while Push Notifications above is on. That switch takes this phone off the list entirely, so with it off nothing arrives whatever is set here.';

/**
 * That muting stops the buzz and not the record.
 *
 * The distinction that makes muting safe to offer at all, and the one a coach
 * would otherwise have to discover.
 */
export const CHANNEL_STILL_RECORDED =
  'Muting a category stops your phone buzzing about it. Every one of them is still written into your notifications list, so nothing is lost — you find out when you open the app rather than as it happens.';

/**
 * The cost of muting money, shown under that switch alone.
 *
 * Specific rather than reassuring, in the same way `WITHHELD_NOTE` is: the
 * consequence that matters is a client who has silently stopped paying, and a
 * coach needs that in front of them before they choose.
 */
export const CHANNEL_QUIET_COST =
  'A failed subscription payment is a client who has quietly stopped paying you. With this off you find out when you next open Payments, which for most coaches is the end of the month.';

/** Applies to every device on the account, and says so — the master switch is
 *  per handset and this is not, which is exactly the sort of difference that
 *  gets discovered by accident. */
export const CHANNEL_ACCOUNT_WIDE =
  'This is set on your account rather than on this phone, so it applies wherever you are signed in. The Push Notifications switch above is the opposite: it is about this handset alone.';
