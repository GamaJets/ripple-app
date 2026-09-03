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
import { BACKLOG_FLOOR, backlogBody } from './coachReminders';

/**
 * What muting the money channel costs, shown under that switch alone.
 *
 * Specific rather than reassuring, in the same way `WITHHELD_NOTE` is: the
 * consequence that matters is a client who has silently stopped paying, and a
 * coach needs that in front of them before they choose.
 */
export const CHANNEL_QUIET_COST_MONEY =
  'A failed subscription payment is a client who has quietly stopped paying you. With this off you find out when you next open Payments, which for most coaches is the end of the month.';

/**
 * What muting the coach's own book costs.
 *
 * The unmarked queue is the sharp end of it. Until a session carries an
 * outcome it is counted as neither delivered nor missed, `settlementBlocker` in
 * src/lib/gymSessions.ts refuses to settle a period containing one, and the
 * statement, the payroll figure and the revenue line are all short by exactly
 * those sessions — so this is not a reminder about tidiness, it is the only
 * thing that tells a coach their own money is sitting still.
 */
export const CHANNEL_QUIET_COST_BOOK =
  'The sessions waiting on an outcome are counted as neither delivered nor missed, so your statement and your revenue figure stay short until you mark them — and nothing else in the app will tell you. With this off you find out when you next open Mark What Happened.';

/**
 * The channels a coach can mute independently.
 *
 * The grouping is by WHAT THE COACH WOULD DO ABOUT IT rather than by which
 * table the row came from. A coach silencing chat is silencing a conversation;
 * a coach silencing money is deciding they will look at Payments themselves.
 * Grouping by source would have put "a subscription payment failed" next to "a
 * package was bought" for no reason a coach cares about, and split the two
 * booking notifications across two switches because one is sent by a handset
 * and the other by a trigger.
 *
 * ── The sixth, and why there were five ────────────────────────────────────
 *
 * Every one of the first five is somebody ELSE doing something: a client
 * messages, books, cancels, pays, asks, signs, leaves. That is not an accident
 * of the list — it is the whole of what this app could notify a coach about,
 * because every one of those has another person's action behind it and
 * therefore a trigger or a handset to send it.
 *
 * So a coach was told about everything their clients did and nothing about
 * their own book going wrong. A session whose outcome nobody recorded, a pack
 * about to run out from under somebody, an invoice ageing past its due date, a
 * client who has stopped training — the app computes all four already, on
 * screens the coach has to open to see. `book` is that channel, and
 * `bookAlert` below is the rule that decides when it has something to say.
 */
export type CoachChannel = 'chat' | 'bookings' | 'money' | 'clients' | 'admin' | 'book';

export interface CoachChannelDef {
  key: CoachChannel;
  /** Title Case — a switch label. */
  title: string;
  /** Sentence case prose under it, naming what actually stops. */
  note: string;
  /**
   * Whether the notification is scheduled by THIS handset rather than sent to
   * it.
   *
   * The same field, meaning the same thing, as `CategoryDef.local` in
   * src/lib/notifyPrefs.ts, and it is here for the same reason: the two kinds
   * are gated in different places and a switch that claimed to govern the wrong
   * one would read "off" while the banner kept arriving.
   *
   * False for the first five — they are remote without exception, sent by
   * another person's handset or written server-side, and the preference is
   * applied in supabase/functions/send-push and notify-message where the
   * recipients are resolved.
   *
   * True for `book`, and that is not an inconsistency. Nothing about the coach's
   * own book has another person's action behind it to hang a trigger on: the
   * unmarked queue, the ageing invoice and the drifting client are all computed
   * on the coach's own device out of reads it already makes. The preference
   * still lives in the same server table, so it follows the coach between
   * phones like the other five — only the place it is APPLIED differs.
   */
  local: boolean;
  /**
   * Whether muting this is a decision the coach may come to regret quietly, and
   * what it would cost them.
   *
   * A SENTENCE rather than a flag, and it became one when a second channel
   * earned it. A missed chat message is visible the next time the coach opens
   * the app; a failed subscription payment is a client who has silently stopped
   * paying, and an unmarked session is somebody's pay held up — two different
   * costs, and a shared warning would have said the wrong one under one of
   * them. Null for the channels where muting costs nothing you would not
   * notice, so the flag still means something when it appears.
   *
   * Specific rather than reassuring, the same way `WITHHELD_NOTE` in
   * src/lib/coachShare.ts is: the consequence goes in front of the coach before
   * they choose.
   */
  quietCost: string | null;
}

export const COACH_CHANNELS: readonly CoachChannelDef[] = [
  {
    key: 'chat', title: 'Client Messages', quietCost: null, local: false,
    note: 'A message from a client. This is the one that arrives at 11pm.',
  },
  {
    key: 'bookings', title: 'Bookings And Cancellations', quietCost: null, local: false,
    note: 'A client booking a session, cancelling one, or a slot re-opening.',
  },
  {
    key: 'money', title: 'Money', quietCost: CHANNEL_QUIET_COST_MONEY, local: false,
    note: 'A package bought, a subscription starting or ending, and a subscription payment failing.',
  },
  {
    key: 'clients', title: 'Joining And Leaving', quietCost: null, local: false,
    note: 'Somebody asking to be coached by you, and somebody ending their coaching.',
  },
  {
    key: 'admin', title: 'Paperwork', quietCost: null, local: false,
    note: 'An intake coming back, a document accepted, a release signed, and a review left.',
  },
  {
    // The second channel to carry a quiet cost, and the reason `quietCost`
    // became a sentence rather than a flag. An unmarked session is a statement,
    // a payroll figure and a revenue line all short by exactly that session,
    // and `settlementBlocker` refuses to settle a period containing one — so
    // muting this is muting the only thing that tells a coach their own money
    // is being held up.
    key: 'book', title: 'Your Own Book', quietCost: CHANNEL_QUIET_COST_BOOK, local: true,
    note: 'A session waiting on an outcome, an invoice past its due date, and a client who has stopped training.',
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
 * The money channel's cost, kept under its old name.
 *
 * It was the only one, so the screen imported one constant and printed it under
 * whichever switch carried the flag. A second channel earned a quiet cost of
 * its own and the sentence moved onto the channel — `CoachChannelDef.quietCost`
 * — because one shared warning under two switches would have said the wrong
 * thing under one of them. This stays so the assertions about the WORDING keep
 * naming what they are about.
 */
export const CHANNEL_QUIET_COST = CHANNEL_QUIET_COST_MONEY;

/**
 * What is different about a LOCAL channel, shown under the switches that are
 * one.
 *
 * Said out loud because the difference is discoverable only by accident and it
 * matters twice. It arrives without a network, so a coach on a plane still gets
 * it. And it is the coach's own phone doing the arithmetic, so it can only be
 * as current as the last time they opened the app — which is exactly the sort
 * of promise this codebase refuses to leave implied.
 */
export const CHANNEL_LOCAL_NOTE =
  'This one is worked out by this phone rather than sent to it, so it arrives with no signal and it is only ever as up to date as the last time you opened the app. Your answer is still saved on your account, so it follows you to a new phone.';

/* ── what the coach's own book has to say ─────────────────────────────────── */

/**
 * The four figures the `book` channel is built from.
 *
 * Every one is `number | null` and the null is load-bearing: it means the read
 * did not establish the figure, NOT that the figure is nought. A banner about a
 * coach's own business composed out of a failed query is how somebody learns to
 * ignore the next one, and the next one is the one that matters — so a null
 * never prompts and never contributes to a count.
 *
 * They are passed in rather than read here because this module is pure and
 * because no single screen holds all four. A caller supplies what it actually
 * read and passes null for the rest, which is exactly what the null is for.
 */
export interface BookState {
  /** Sessions that happened with no outcome recorded — `SessionMonth.unmarked`
   *  in src/lib/coachRevenue.ts. */
  unmarkedSessions: number | null;
  /** Live invoices past their due date — `ageingBook(...).overdue.length`. */
  invoicesOverdue: number | null;
  /** Clients whose own record says they have stopped — the 'drifting' band of
   *  `summariseDrift`. Only ever passed from a read that could actually support
   *  a verdict: src/lib/clientDrift.ts is explicit that a truncated read cannot,
   *  and "where have you been" to somebody who trained yesterday is the exact
   *  harm this channel would otherwise cause. */
  clientsDrifting: number | null;
  /** Session packs about to run out from under somebody. Null from every caller
   *  today — no coach-wide screen reads pack balances yet — and declared rather
   *  than omitted so the day one does, the rule already knows what to do with
   *  it and nobody has to reopen this decision. */
  packsRunningOut: number | null;
}

/**
 * How few of something is not worth a banner.
 *
 * One overdue invoice out of forty is a Tuesday; one is also exactly the case a
 * coach with three clients wants to hear about. So the floor is ONE and there
 * is no threshold — the problem with this channel was never that it said too
 * much, it was that it did not exist.
 *
 * Unmarked sessions are the exception and they keep the bar they were already
 * given: `BACKLOG_FLOOR` in src/lib/coachReminders.ts, imported rather than
 * restated, because "below this the queue is a normal week's work" is one
 * decision and two copies of it would drift. A coach told about two unmarked
 * sessions every Monday stops reading the message that will one day say forty.
 */
export const BOOK_FLOOR = 1;

/** How this channel's banner reads. Title and body kept apart because the
 *  platform draws them differently and a body that repeats its title is the
 *  notification people swipe away without reading. */
export interface BookAlert { title: string; body: string }

const n = (x: number) => (x === 1 ? '' : 's');

/**
 * The one thing worth telling a coach about their own book, or null.
 *
 * ONE banner and not four, and the order is the argument. A phone that fires
 * four notifications in a row about the same business on the same morning is a
 * phone whose notifications get turned off, and turning them off is what took
 * the money channel down with the chat channel in the first place. So the
 * highest-cost item speaks and the rest are counted after it.
 *
 * The order is by what it costs to leave alone:
 *
 *   1. unmarked sessions — somebody's pay is held up. `settlementBlocker` in
 *      src/lib/gymSessions.ts refuses to settle a period containing one, and
 *      the statement, the payroll figure and the revenue line are all short by
 *      exactly those sessions until the coach clears them.
 *   2. overdue invoices — money already earned and not collected, ageing.
 *   3. packs running out — a client about to arrive with nothing left to draw
 *      on, which is a conversation to have BEFORE they turn up.
 *   4. drifting clients — the slowest of the four, and the one the Quiet
 *      Clients screen already exists for.
 *
 * Null when every figure is nought or unknown. Never a cheerful all-clear: an
 * empty book is not news, and a notification saying nothing is wrong is
 * indistinguishable from one composed out of four failed reads.
 */
export function bookAlert(s: BookState): BookAlert | null {
  const at = (v: number | null, floor = BOOK_FLOOR): number =>
    (v != null && Number.isFinite(v) && v >= floor ? Math.floor(v) : 0);
  const unmarked = at(s.unmarkedSessions, BACKLOG_FLOOR);
  const overdue = at(s.invoicesOverdue);
  const packs = at(s.packsRunningOut);
  const drifting = at(s.clientsDrifting);

  /** The others, as a trailing clause, or ''. Counted rather than listed: the
   *  banner has one line and the screen behind it has the detail. */
  const rest = (parts: string[]): string =>
    parts.length ? ` Also waiting: ${parts.join(', ')}.` : '';

  if (unmarked) {
    return {
      title: `${unmarked} session${n(unmarked)} waiting on an outcome`,
      // `backlogBody` and not a sentence written here. That wording — the
      // CONSEQUENCE rather than the chore, "counted nowhere until you mark
      // them" — is already argued at length in src/lib/coachReminders.ts and
      // was the whole of this channel before it had a name. Two wordings for
      // one fact is how the banner and the screen come to disagree.
      body: backlogBody(unmarked)
        + rest([
          overdue ? `${overdue} overdue invoice${n(overdue)}` : '',
          packs ? `${packs} pack${n(packs)} running out` : '',
          drifting ? `${drifting} client${n(drifting)} gone quiet` : '',
        ].filter(Boolean)),
    };
  }
  if (overdue) {
    return {
      title: `${overdue} invoice${n(overdue)} past ${overdue === 1 ? 'its' : 'their'} due date`,
      body: 'Money you have already earned and not been paid.'
        + rest([
          packs ? `${packs} pack${n(packs)} running out` : '',
          drifting ? `${drifting} client${n(drifting)} gone quiet` : '',
        ].filter(Boolean)),
    };
  }
  if (packs) {
    return {
      title: `${packs} pack${n(packs)} about to run out`,
      body: `Worth a word before ${packs === 1 ? 'they turn' : 'anybody turns'} up with nothing left to draw on.`
        + rest([drifting ? `${drifting} client${n(drifting)} gone quiet` : ''].filter(Boolean)),
    };
  }
  if (drifting) {
    return {
      title: `${drifting} client${n(drifting)} ${drifting === 1 ? 'has' : 'have'} gone quiet`,
      body: 'Nothing on their record for a while. Quiet Clients has who, and a draft you send yourself.',
    };
  }
  return null;
}

/** Applies to every device on the account, and says so — the master switch is
 *  per handset and this is not, which is exactly the sort of difference that
 *  gets discovered by accident. */
export const CHANNEL_ACCOUNT_WIDE =
  'This is set on your account rather than on this phone, so it applies wherever you are signed in. The Push Notifications switch above is the opposite: it is about this handset alone.';
