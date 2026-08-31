// Which pushes earn a row in the in-app inbox, and where a stored row is
// allowed to send you.
//
// ── Why the decision lives here and not at the call sites ──────────────────
//
// There are eleven places in these apps that send a push, spread across six
// files, and until now none of them wrote anything down: `sendPush` posts to an
// edge function and forgets. The inbox is added by making the two functions in
// src/ui/pushNotifications.ts record a row alongside the send, which is the one
// change that reaches every call site at once and cannot be forgotten by the
// twelfth.
//
// That choke point sees only what the call sites already pass — a title, a
// body, and `data.route`. So the decision has to be made from those. Doing it
// by hand at each call site would have been more precise and would also have
// meant eleven separate opportunities to skip it, in files owned by different
// people; this is deliberately the cheaper, single-place version.
//
// ── An inbox full of things nobody needs is worse than no inbox ────────────
//
// Three kinds are refused. Only the first is load-bearing:
//
//  1. CHAT. `supabase/parts/26-message-notifications.sql` puts an AFTER INSERT
//     trigger on `messages` which calls the `notify-message` edge function,
//     and that function ALREADY does `notifications.insert({ icon: 'message' })`
//     for the recipient. It has been the table's only writer since it was
//     created. Both message pushes — src/ui/messaging.ts and the coach's
//     broadcast, which writes a `messages` row per client — would therefore
//     produce a SECOND row for a message that already has one, and every
//     conversation would read as though it had been sent twice.
//
//     This rule is keyed on the ROUTE, which is the structural signal: the
//     duplicate exists precisely because a `messages` row was inserted, and a
//     push about a `messages` row is a push whose route is a message thread.
//     A title can be reworded; a chat push that no longer points at the chat
//     is not a chat push.
//
//  2. EXPIRING OFFERS. "A slot just opened — first to book it gets it." goes to
//     every client with an open request the moment a cancellation frees a slot.
//     It is a race, and by the time somebody opens an inbox it has been won or
//     the slot has passed. A permanent list of invitations to things that are
//     over is the exact failure the brief warned about.
//
//  3. READ RECEIPTS. "Your coach has read your injuries" is a courtesy nudge,
//     and src/ui/injuryAcks.tsx says so itself: the acknowledgement row is
//     already readable by the client on their injuries screen whether or not
//     the push lands. An inbox row would be a second, worse copy of a record
//     that is already permanent and already in the right place.
//
// 2 and 3 are matched on the title, which IS brittle — reword the string and
// the classification silently changes. That is tolerable only because of which
// way the brittleness falls: a miss here adds one extra row to an inbox. A miss
// on rule 1 duplicates every message anyone ever sends. The catalogue below and
// its test exist so that a reword is at least visible to the next person, and
// the DEFAULT is to record: a push nobody has classified is one somebody
// thought worth waking a phone up for, and it gets kept.
//
// Everything else is recorded: session booked, session cancelled, a new offer,
// a new booking, a coach asking about an injury. Those are the five that a
// client or coach who missed the banner genuinely has no other way to learn.

import { num } from './format';
import type { LoadStatus } from '../ui/loadStatus';

/** Icons the inbox draws. A subset of `IconName` in src/ui/Icon.tsx — narrowed
 *  here rather than imported because src/lib may not reach into src/ui (that
 *  file is .tsx and pulls in react-native-svg, which does not compile under
 *  tsconfig.test.json or run in the web console). The UI assigns these straight
 *  into `IconName`, so a value added here that Icon does not draw fails to
 *  typecheck at the use site. */
export type InboxIcon = 'bell' | 'calendar' | 'message' | 'sparkle' | 'heart' | 'dumbbell' | 'trophy' | 'info' | 'pencil';

export interface InboxDecision {
  /** Whether to write a `notifications` row alongside the push. */
  record: boolean;
  /** The icon the row is drawn with. Meaningless when `record` is false. */
  icon: InboxIcon;
  /** Why, in the words a reviewer needs. Not shown to a user — this is the
   *  sentence that has to be defensible when somebody asks why their inbox is
   *  missing a notification they remember receiving. */
  why: string;
}

/** A route that opens a message thread. Both apps' chat screens, and nothing
 *  else. Matched as a prefix so `/(trainer)/chat?clientId=…` counts. */
const CHAT_ROUTES = ['/(client)/messages', '/(trainer)/chat'];

/** A push about something that is over before it can be read. */
const EXPIRING = /\bjust opened\b/i;

/** A push confirming something the recipient can already see recorded. */
const RECEIPT = /\bhas read your\b/i;

/** Route prefix → the icon that route's notifications are drawn with. First
 *  match wins, so the longer, more specific prefixes come first. */
const ICON_BY_ROUTE: ReadonlyArray<readonly [string, InboxIcon]> = [
  ['/(client)/messages', 'message'],
  ['/(trainer)/chat', 'message'],
  ['/(client)/injuries', 'heart'],
  // The intake ask has been sending a push with this route since src/ui/intake.ts
  // was written, and every one of those rows drew the generic bell — the icon a
  // row gets when nothing in this list matches it, which is indistinguishable
  // from "we have no idea what this is". A pencil, because the whole content of
  // that notification is that the client has a form to fill in.
  ['/(client)/intake', 'pencil'],
  // A notice from a coach or a gym. Not the bell either: the bell is the
  // fallback, and a noticeboard is a specific thing.
  ['/(client)/notices', 'info'],
  ['/(client)/explore', 'sparkle'],
  ['/(client)/offers', 'sparkle'],
  ['/(client)/calendar', 'calendar'],
  ['/(trainer)/calendar', 'calendar'],
  ['/(client)/bookings', 'calendar'],
  ['/(client)/pt-sessions', 'calendar'],
  ['/(client)/classes', 'calendar'],
  ['/(client)/workouts', 'dumbbell'],
  ['/(client)/achievements', 'trophy'],
];

const startsWithAny = (route: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => route === p || route.startsWith(p + '?'));

/** The icon a route implies, or the generic bell. */
export function inboxIcon(route: string | null | undefined): InboxIcon {
  const r = (route ?? '').trim();
  if (!r) return 'bell';
  for (const [prefix, icon] of ICON_BY_ROUTE) {
    if (r === prefix || r.startsWith(prefix + '?')) return icon;
  }
  return 'bell';
}

/**
 * The heading to draw over a row's body, or null for no heading at all.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * `title` is nullable — part 122 added the column and deliberately left it so,
 * because `notify-message` had been writing rows without one since 2025. The
 * inbox drew `item.title ?? f.title` for those, and `f.title` is the SCREEN's
 * name. So a row whose body was "third rep" rendered under the heading
 * "Notifications", on a screen called Notifications. Two such rows are in
 * production right now and both look like real, titled notifications that say
 * nothing.
 *
 * Borrowing the screen's name is the worst of the available answers: it is
 * indistinguishable from a heading somebody wrote, so it does not read as
 * missing, it reads as content — and the content is a tautology.
 *
 * ── Why only the message case gets a fallback ─────────────────────────────
 *
 * A heading invented for a row is a claim about that row, and only one kind of
 * untitled row is actually known. Every title-less row in this table was
 * written by `notify-message` after a chat message; that is what its
 * `icon: 'message'` records, and "New message" is a true statement about it.
 *
 * Nothing else is guessed. An untitled row that came through notify_users()
 * with a calendar icon might be a booking or a cancellation, and "Session
 * update" over a cancellation is a worse lie than no heading, because it is a
 * plausible one. Those rows return null and the screen draws the body alone,
 * which is the whole of what is known about them.
 */
export function inboxHeading(title: string | null | undefined, icon: InboxIcon): string | null {
  const t = (title ?? '').trim();
  if (t) return t;
  if (icon === 'message') return 'New message';
  return null;
}

/**
 * Whether this push should also leave a row in the inbox.
 *
 * `body` matters because the table's body is `not null`: a push with a title
 * and no body has nothing to show in a list, and writing a row whose only
 * content is its heading gives somebody a notification that tells them nothing.
 */
export function inboxDecision(
  title: string | null | undefined,
  body: string | null | undefined,
  route: string | null | undefined,
): InboxDecision {
  const t = (title ?? '').trim();
  const b = (body ?? '').trim();
  const r = (route ?? '').trim();
  const icon = inboxIcon(r);

  if (!b) return { record: false, icon, why: 'no body — an inbox row with only a heading says nothing' };
  if (startsWithAny(r, CHAT_ROUTES)) {
    return { record: false, icon, why: 'a chat message; the messages trigger writes this row already (part 26)' };
  }
  if (EXPIRING.test(t)) {
    return { record: false, icon, why: 'a race for a slot — over by the time an inbox is opened' };
  }
  if (RECEIPT.test(t)) {
    return { record: false, icon, why: 'a read receipt; the acknowledgement itself is already on the injuries screen' };
  }
  return { record: true, icon, why: 'nothing else tells the recipient this happened' };
}

/**
 * Every push this repository sends today, so the test can state what each one
 * is classified as rather than testing the regexes against invented strings.
 *
 * This is a snapshot maintained by hand, and it is honest about that: it does
 * not make the classification correct, it makes it VISIBLE. Adding a push
 * without adding it here costs nothing at runtime — the default is to record —
 * and the test's job is to stop a reword quietly turning a recorded kind into
 * a dropped one.
 */
export const KNOWN_PUSHES: ReadonlyArray<{
  where: string; title: string; body: string; route: string | null;
}> = [
  { where: 'app/(trainer)/calendar.tsx', title: 'Session booked', body: 'Your session on Tue at 6:30 PM is confirmed.', route: '/(client)/calendar' },
  { where: 'app/(trainer)/calendar.tsx', title: 'Session cancelled', body: 'Your 6:30 PM session on Tue was cancelled.', route: '/(client)/calendar' },
  { where: 'app/(trainer)/calendar.tsx', title: 'A slot just opened', body: '6:30 PM on Tue is available — first to book it gets it.', route: '/(client)/calendar' },
  { where: 'app/(trainer)/broadcast.tsx', title: 'Message from your coach', body: 'Session times move next week.', route: '/(client)/messages' },
  { where: 'app/(owner)/promotions.tsx', title: 'A new offer', body: '20% off with code SPRING', route: '/(client)/explore' },
  { where: 'app/(client)/calendar.tsx', title: 'New booking', body: 'A client booked Tue 6:30 PM.', route: '/(trainer)/calendar' },
  { where: 'src/ui/messaging.ts', title: 'New message from your coach', body: 'See you Tuesday.', route: '/(client)/messages' },
  { where: 'src/ui/messaging.ts', title: 'New message from your client', body: 'Can we move to 7?', route: '/(trainer)/chat?clientId=abc' },
  { where: 'src/ui/injuryAsk.ts', title: 'Your coach asked about an injury', body: 'They’ve asked you to add your left knee to your injuries.', route: '/(client)/injuries' },
  { where: 'src/ui/injuryAcks.tsx', title: 'Your coach has read your injuries', body: 'They have seen what you disclosed.', route: '/(client)/injuries' },
  { where: 'src/ui/sessions.tsx', title: 'A PT slot just opened', body: 'Tue 6:30 PM with your coach just opened up.', route: '/(client)/calendar' },
  { where: 'src/ui/sessions.tsx', title: 'Session cancelled', body: 'A client cancelled Tue 6:30 PM. The slot re-opened.', route: '/(trainer)/calendar' },
  // Waitlist promotion. Sent from two places — the coach cancelling a session
  // on their grid, and the client cancelling their own — and it is the one push
  // in this list that reports a booking somebody did not make themselves, so it
  // is the one an inbox row matters most for.
  { where: 'app/(trainer)/calendar.tsx', title: 'The slot you were waiting for is yours', body: '6:30 PM on Tue freed up and you were next on the list — it is booked for you.', route: '/(client)/calendar' },
  { where: 'src/ui/sessions.tsx', title: 'The slot you were waiting for is yours', body: 'Tue 6:30 PM with your coach just freed up and you were next on the list.', route: '/(client)/calendar' },
  { where: 'src/ui/intake.ts', title: 'Your coach asked for your intake', body: 'They need your intake form before your first session.', route: '/(client)/intake' },
  // The coach's check-in nudge. It does NOT go through sendPush() — it invokes
  // the send-push function directly — so recordInbox() never sees it, and it is
  // listed here so that reading this catalogue does not leave somebody
  // believing it is one of the pushes this file decides about. It needs no row
  // either way: it writes a `messages` row first, and part 26's trigger records
  // that, which is the same reason the chat rule drops it.
  { where: 'app/(trainer)/dashboard.tsx', title: 'A nudge from your coach', body: 'Hey Sam — checking in! How is your week going?', route: '/(client)/messages' },
  // The two notices. Both are RECORDED whether or not the author asked for a
  // push — see src/ui/announcements.tsx — so these two rows are the only ones
  // in this catalogue that describe a send which may happen with no push at
  // all. The body is the author's own words; the heading is this app's.
  { where: 'src/ui/announcements.tsx', title: 'A notice from your coach', body: 'No 6pm class this Thursday — the room is being re-floored.', route: '/(client)/notices' },
  { where: 'src/ui/announcements.tsx', title: 'A notice from your gym', body: 'We are closed Monday for the public holiday. Normal hours from Tuesday.', route: '/(client)/notices' },
  // The invoice. Like the nudge above it does NOT go through sendPush() — it
  // calls recordInbox() directly, because an invoice is not worth waking a
  // phone for and the inbox row is the durable half anyway. It is listed here
  // so that reading this catalogue does not leave somebody believing an invoice
  // notification is a push, and so the classification of its wording is
  // visible: it has a body, it is not chat, and it is recorded.
  { where: 'src/ui/coachInvoices.ts', title: 'An invoice from your coach', body: 'Invoice 0007 for AED 450.00 — Ten sessions. Your coach states this amount is being requested.', route: null },
];

/* ── Where a stored row is allowed to send you ─────────────────────────────
 *
 * `notifications.route` holds a string that came from a CALLER. notify_users()
 * caps its length and nothing else, deliberately — the database is the wrong
 * place to keep a list of this app's screens. So the value is untrusted on the
 * way out, and the inbox validates it here before handing it to router.push().
 *
 * Two separate things are being refused.
 *
 * The first is the obvious one: a client could call notify_users() directly
 * with the publishable key and a route of their choosing, addressed to their
 * own coach. Without this, "Session cancelled" in a coach's inbox could open
 * anything expo-router will accept, including an external URL.
 *
 * The second is quieter and will happen by accident rather than by malice.
 * These are three separate App Store binaries built from one tree, and each
 * contains only its own route group (src/lib/variant.ts, groupAllowed). A
 * notification written for a coach carries '/(trainer)/calendar'; if that row
 * is ever read by a build that is not the coach app — a shared account, a
 * changed role, a mis-addressed write — pushing it navigates to a group this
 * binary does not contain. So the group in the route must be the group this
 * build ships. Null means "show the row, make it inert", which is the right
 * outcome: the words are still worth reading.
 */

/** A route this app is willing to navigate to: one of the three groups, one
 *  screen name, and at most a simple query string. */
const ROUTE_SHAPE = /^\/\((client|trainer|owner)\)\/[a-z0-9][a-z0-9-]*(\?[A-Za-z0-9_%=&.\-]*)?$/;

/**
 * The route to open for a stored notification, or null if there is not one we
 * are prepared to follow.
 *
 * `group` is this build's variant. Passed in rather than read from
 * src/lib/variant.ts so this stays a pure function — variant.ts reads
 * process.env at module scope, which is a build constant on the phone and
 * nothing at all under `node`.
 */
export function safeRoute(raw: string | null | undefined, group: 'client' | 'trainer' | 'owner'): string | null {
  const r = (raw ?? '').trim();
  if (!r) return null;
  // Anchored, and the character class excludes '/' after the screen name, so
  // '/(client)/../../elsewhere' and '/(client)/a/b' do not match. Checked
  // before the group so a malformed route can never be accepted on the
  // strength of its prefix alone.
  const m = ROUTE_SHAPE.exec(r);
  if (!m) return null;
  return m[1] === group ? r : null;
}

/* ── How old a row is ──────────────────────────────────────────────────────
 *
 * Durations only — "3h", "2d", "5w" — and never a calendar date. The suite runs
 * under three timezones (`npm run test:zones`), and "yesterday" is a claim
 * about a calendar that depends on where the phone is. A duration is the same
 * number everywhere, which is also the honest thing to show somebody who
 * travelled between receiving a notification and reading it.
 */
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, WEEK = 7 * DAY, YEAR = 365 * DAY;

/** "Just now", "12m", "3h", "2d", "5w", "1y". */
export function inboxAge(iso: string | null | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  // Clock skew between the phone and the server puts rows a few seconds in the
  // future. "in 4 seconds" next to a notification is a bug report; "Just now"
  // is what it means.
  const ms = Math.max(0, now - t);
  if (ms < MIN) return 'Just now';
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < WEEK) return `${Math.floor(ms / DAY)}d`;
  if (ms < YEAR) return `${Math.floor(ms / WEEK)}w`;
  return `${Math.floor(ms / YEAR)}y`;
}

/* ── What the bell shows ───────────────────────────────────────────────────
 *
 * A bell with no badge over eleven unread notifications is worse than no bell:
 * it is a control that has been looked at and, silently, answered the question
 * wrongly. So the mark on the bell is decided here rather than in the header of
 * each of the three dashboards, where it would be decided three times.
 *
 * The rule that makes this a function and not a `count > 0 &&` is LoadStatus.
 * `unread` is counted over the rows the inbox is HOLDING, and what that set is
 * depends entirely on how the read went:
 *
 *   'loading' — nothing has come back yet. A cached copy may already be on
 *               screen, but drawing a figure from it means the bell prints a
 *               number and then changes it a moment later, which teaches people
 *               the number is a guess. Nothing is drawn.
 *   'ready'   — the whole set, from the server. This is the only status under
 *               which a FIGURE may be shown, and zero genuinely means zero.
 *   'partial' — a prefix of the newest rows (src/lib/rowCap.ts caps the read).
 *               Unread rows older than the cap are not in the count, so the
 *               count is a floor and not a total — src/ui/loadStatus.ts forbids
 *               a figure over a truncated read. A mark, no number.
 *   'error'   — the server did not answer. Whatever is held is a cached copy of
 *               unknown age, and an EMPTY one means "could not be read", never
 *               "you have none". This is the case the whole type exists for:
 *               drawing nothing here would state, in the most glanceable place
 *               in the app, a fact nobody has established.
 *
 * The count is put through num() because it is a count of rows in a table with
 * no ceiling: a gym pushing an offer a day to a member who never opens the
 * inbox reaches four digits in three years, and `1204` unseparated is the
 * defect scripts/check-numbers.mjs exists for.
 */
export type UnreadBadge =
  /** Draw nothing. Either there is nothing unread, or nothing is known yet. */
  | { kind: 'none' }
  /** An exact figure, already formatted. */
  | { kind: 'count'; label: string; a11y: string }
  /** At least one unread, over a set we do not have all of. No figure. */
  | { kind: 'some'; a11y: string }
  /** The read failed. Not the same as none, and must not look like it. */
  | { kind: 'unknown'; a11y: string };

/**
 * The mark to draw on a notifications bell.
 *
 * `unread` is the number of unread rows the caller is holding — for 'partial'
 * and 'error' that is a floor and a stale copy respectively, which is why
 * neither of those returns a figure.
 */
export function unreadBadge(unread: number, status: LoadStatus): UnreadBadge {
  const n = Number.isFinite(unread) && unread > 0 ? Math.floor(unread) : 0;
  // Said before anything else: under 'error' the number in hand is not evidence
  // either way, so both the zero case and the non-zero case answer the same.
  if (status === 'error') {
    return { kind: 'unknown', a11y: 'Notifications. Unread count could not be read.' };
  }
  if (status === 'loading') return { kind: 'none' };
  if (status === 'partial') {
    // Zero over a prefix is not zero over the set: the rows past the cap are
    // the OLDEST, and an unread one among them is exactly the notification
    // somebody has not got to yet.
    return n > 0
      ? { kind: 'some', a11y: 'Notifications. You have unread notifications.' }
      : { kind: 'unknown', a11y: 'Notifications. Unread count could not be read.' };
  }
  if (n === 0) return { kind: 'none' };
  return { kind: 'count', label: num(n), a11y: `Notifications. ${num(n)} unread.` };
}

/* ── What the inbox is allowed to destroy ──────────────────────────────────
 *
 * The inbox shipped able to read and to mark read, and with no way to remove
 * anything, so the list only ever grew. This is the removal half, and the whole
 * of the difficulty is that a DELETE is a write whose failure looks exactly
 * like its success.
 *
 * Proved against production tonight, `set local role authenticated` with a real
 * `request.jwt.claims`, every fixture rolled back:
 *
 *   C deletes D's row by id                      0 rows, NO ERROR
 *   C marks D's row unread by id                 0 rows, NO ERROR
 *   anon deletes every row in the table          0 rows, NO ERROR
 *   C deletes their own row                      1 row
 *
 * Four different meanings — a stranger's row, a stale id, a signed-out caller,
 * a real deletion — and three of them are the same answer. src/lib/wroteRows.ts
 * is what turns the count into a sentence; this decides whether the control may
 * be offered at all, which is the part that depends on LoadStatus.
 *
 * ── Why the gate is a function of LoadStatus and not a boolean ────────────
 *
 * 'loading' — nothing has come back. Anything on screen is a cached copy, and
 *             a delete keyed on a cached id cannot be told apart from a stale
 *             one. There is also nothing established to destroy yet.
 *
 * 'ready'   — the whole set, from the server. Everything is offered. This is
 *             the only status under which "Clear Read" can name a NUMBER in
 *             its confirmation and have that number be the truth.
 *
 * 'partial' — the rows are real but they are a prefix (src/lib/rowCap.ts).
 *             Per-row removal is fine: each row named came back from the server
 *             in THIS read, so "we read it and the delete matched nothing" is a
 *             genuine failure and is reported as one.
 *
 *             "Clear Read" is REFUSED here, and this is the decision worth
 *             arguing with. `delete where read = true` would sweep rows past
 *             the cap that were never on screen, while the confirmation could
 *             only offer a count taken over the prefix — asking somebody to
 *             approve deleting 200 things and then deleting 1,400. That is a
 *             figure computed from an unknown fraction of the set, which
 *             src/ui/loadStatus.ts forbids, aimed at a destructive irreversible
 *             action. Refused, and the screen says why rather than going quiet.
 *
 * 'error'   — the server did not answer. The list is a cache of unknown age; an
 *             empty one means "could not be read", never "you have none". A
 *             delete here cannot be confirmed either way, and a row vanishing
 *             off a screen that already says "not confirmed" would be the app
 *             inventing a fact. Nothing is offered.
 */
export interface InboxControls {
  /** May a single row be removed? */
  rowDelete: boolean;
  /** May a single row be put back to unread? */
  markUnread: boolean;
  /** May "Clear Read" be offered? */
  clearRead: boolean;
  /** Why a control is withheld, in the reader's words. Null when everything is
   *  offered. Shown on the screen — a control that silently disappears reads as
   *  a bug, and under 'error' the reason is the whole point. */
  withheld: string | null;
}

export function inboxControls(status: LoadStatus): InboxControls {
  if (status === 'error') {
    return {
      rowDelete: false, markUnread: false, clearRead: false,
      withheld: 'Removing is off while this list is unconfirmed. The server did not answer, so nothing here can be shown to have been deleted.',
    };
  }
  if (status === 'loading') {
    return { rowDelete: false, markUnread: false, clearRead: false, withheld: null };
  }
  if (status === 'partial') {
    return {
      rowDelete: true, markUnread: true, clearRead: false,
      withheld: 'Clearing read notifications is off while this is only part of the list. It would remove notifications that are not on this screen and cannot be counted here.',
    };
  }
  return { rowDelete: true, markUnread: true, clearRead: true, withheld: null };
}

/**
 * The confirmation for "Clear Read", or null when there is nothing to offer.
 *
 * A single row is removed on one tap and this is not (see the note above
 * `deletedNote`), so this one is confirmed and the confirmation names the
 * figure. `num()` because it is a count of rows in a table with no ceiling and
 * `1204 read notifications` is the defect scripts/check-numbers.mjs exists for.
 *
 * `readCount` is counted over the rows in hand, which is why this refuses
 * anything but 'ready': under any other status that number is not the number
 * the delete would match.
 */
export function clearReadPrompt(
  readCount: number,
  status: LoadStatus,
): { label: string; title: string; message: string; confirm: string } | null {
  if (!inboxControls(status).clearRead) return null;
  const n = Number.isFinite(readCount) && readCount > 0 ? Math.floor(readCount) : 0;
  if (n === 0) return null;
  const one = n === 1;
  return {
    label: 'Clear Read',
    // Title Case for the heading, sentence case for the sentence under it.
    title: one ? 'Delete the read notification?' : `Delete ${num(n)} read notifications?`,
    // Says what is NOT touched, because the fear this control raises is that it
    // takes the unread ones too — and says the thing is gone for good, because
    // it is: there is no undo and no copy anywhere else.
    message: one
      ? 'It will be removed from your inbox for good. Anything still unread stays where it is.'
      : `They will be removed from your inbox for good. Anything still unread stays where it is.`,
    confirm: one ? 'Delete' : 'Delete Them',
  };
}

/**
 * What to say after removing one row.
 *
 * Only the failure is worth a sentence: the row leaving the list IS the success
 * message, and a "Deleted." note under a list that visibly shrank is noise. So
 * this returns null when it worked, and the sentence names the row when it did
 * not, because by then the row is back on screen and the reader needs to know
 * which one and why.
 *
 * `why` comes from src/lib/wroteRows.ts. It is passed in rather than rebuilt so
 * that "the server accepted the request and matched no rows" is worded once in
 * this codebase.
 */
export function deletedNote(what: string, why: string | null): string | null {
  if (!why) return null;
  return `${what} is still in your inbox. ${why}`;
}

/**
 * What to say after "Clear Read".
 *
 * Three outcomes and three sentences, the same shape `markAllRead` reports in,
 * and for the same reason: a bulk write that matched nothing answers 204 with a
 * Content-Range header of zero rows, which is what an RLS refusal answers too.
 * "Done" would be a claim the server never made.
 */
export function clearedNote(ok: boolean, changed: number): string {
  if (!ok) return 'Nothing was deleted — the server did not answer. Your inbox is unchanged.';
  const n = Number.isFinite(changed) && changed > 0 ? Math.floor(changed) : 0;
  if (n === 0) return 'Nothing was deleted. There was nothing marked read to remove.';
  return n === 1 ? 'One read notification deleted.' : `${num(n)} read notifications deleted.`;
}
