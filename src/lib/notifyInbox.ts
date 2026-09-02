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
export type InboxIcon = 'bell' | 'calendar' | 'message' | 'sparkle' | 'heart' | 'dumbbell' | 'trophy' | 'info' | 'pencil' | 'people' | 'grid';

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

/** Route → the icon that route's notifications are drawn with.
 *
 *  ORDER DOES NOT MATTER, despite the name of the local. `inboxIcon` matches a
 *  WHOLE route — `r === prefix`, or the route with a query string on it — so no
 *  entry can shadow another and reordering this table cannot change any answer.
 *  This said "first match wins, so the longer, more specific prefixes come
 *  first", which is false twice: the matching is not prefix matching, and the
 *  list is not sorted that way ('/(client)/messages' precedes '/(trainer)/chat',
 *  '/(client)/explore' precedes '/(client)/calendar'). Whole-route matching is
 *  the deliberate choice and notifyInbox.test.ts pins it — '/(client)/calendar-archive'
 *  gets the bell, not the calendar. Somebody who believed the old sentence would
 *  "fix" a wrong icon by moving a line, and nothing would change. */
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
  // Memberships & Packs, which part 160 sends a client to when their card is
  // declined. The icon CLIENT_NAV already gives that screen (src/lib/features.ts,
  // key 'packages') and not a fresh choice: without an entry here the row falls
  // to the generic bell, which is the icon that means "we have no idea what this
  // is" — on the one notification in a client's inbox that costs them their
  // coaching if they scroll past it.
  ['/(client)/packages', 'trophy'],
  // ── the coach's own three ────────────────────────────────────────────────
  //
  // Written by database triggers rather than by a push (supabase/parts/158),
  // and each takes the icon TRAINER_NAV already gives the screen it opens —
  // src/lib/features.ts: Clients is 'people', Your Documents is 'pencil',
  // Payments & Packages is 'grid'. Not a fresh choice per notification: a coach
  // has learned those three shapes from the nav, and a row that opens Payments
  // wearing a different icon from the Payments row is one they have to read
  // before they know what it is about.
  //
  // '/(trainer)/dashboard' is the coach's client list, which is where
  // src/ui/CoachRequests.tsx draws the accept/decline card. There is no
  // dedicated screen for a coaching request and this is deliberately not the
  // moment to invent one.
  // A client's own training, which is where a personal best sends the coach
  // (src/lib/prNotify.ts). "Their Training" is `href: null` in the coach's tab
  // layout — it is reached from a client rather than from the nav — so there is
  // no TRAINER_NAV icon to inherit. A dumbbell, which is what this table
  // already gives the member's own training screen: it is the one row in a
  // coach's inbox that is about a lift, and the bell would say "we have no idea
  // what this is" over the single most encouraging thing in the product.
  ['/(trainer)/client-training', 'dumbbell'],
  ['/(trainer)/dashboard', 'people'],
  ['/(trainer)/documents', 'pencil'],
  ['/(trainer)/payments', 'grid'],
  // ── and the two screens part 159 sends a coach to ────────────────────────
  //
  // Same rule as the three above: the icon TRAINER_NAV already gives the screen
  // (src/lib/features.ts) — Credentials & Reviews is 'trophy'. A review
  // notification wearing anything else would be the only 'trophy' row in the
  // coach's inbox that is not a review, or the only review row that is not a
  // trophy, depending on which way somebody got it wrong.
  ['/(trainer)/credentials', 'trophy'],
  // Not in TRAINER_NAV at all — a per-client screen, reached from a client's
  // page and from this notification. The pencil matches '/(client)/intake'
  // above, which is the SAME DOCUMENT seen from the other side: the ask and the
  // answer should not be two different shapes in two inboxes.
  ['/(trainer)/client-intake', 'pencil'],
  // ── and the two screens part 202 sends a coach to ────────────────────────
  //
  // Quiet Clients is 'bell' in TRAINER_NAV, which is also the fallback this
  // list returns for a route it does not know — so the entry changes nothing at
  // runtime and is here anyway. Without it the row's icon is an ACCIDENT that
  // happens to be right, and the next person to add a fallback for unknown
  // routes would change this notification without knowing they had.
  ['/(trainer)/nudges', 'bell'],
  // Working Toward is 'target' in TRAINER_NAV and `InboxIcon` has no 'target' —
  // it is a deliberately short list, and widening it for one row would put a
  // shape in coach inboxes that appears nowhere else. 'trophy' rather than the
  // bell, because a goal reached is the one notification in this product where
  // the trophy is literally what happened, and the bell means "we do not know
  // what this is".
  ['/(trainer)/client-goals', 'trophy'],
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
  // The personal best. The only push in this catalogue sent from inside a
  // branch that has already made a judgement — see src/lib/prNotify.ts, which
  // holds the wording and the once-a-day rule, and supabase/parts/202, which
  // says why this one is not a database trigger. Recorded, and it has to be: a
  // coach who missed the banner has no other way to learn a record was set
  // except by opening that client's training screen and reading the sets.
  { where: 'app/(client)/workouts.tsx', title: 'A client set a personal best', body: 'Sam just logged Back squat at 100 kg (220.5 lb) for 5 reps, and their app makes that their best set of that movement on record.', route: '/(trainer)/client-training?clientId=00000000-0000-0000-0000-000000000000' },
];

/* ── rows nothing in this file decides about ───────────────────────────────
 *
 * KNOWN_PUSHES above is a catalogue of PUSHES, and every entry in it passes
 * through recordInbox() where inboxDecision() gets a say. There is a second,
 * entirely separate population in this table that it does not describe at all:
 * rows written server-side, by an edge function or a trigger, which never touch
 * this file's rules and cannot be classified by them.
 *
 * They were invisible here, and the cost of that was concrete. `notify-message`
 * wrote coach-directed rows for two years whose route was '/(trainer)/messages'
 * — a screen that exists, in a group the coach's build contains, so nothing
 * refused it — and it is not the coach's thread: app/(trainer)/chat.tsx is, and
 * it needs a clientId. Every one of those notifications opened a list instead of
 * the conversation it was about. Nothing in this repository stated the
 * relationship the bug broke, so nothing could notice.
 *
 * That relationship is what this catalogue exists to state, and it is a
 * different assertion from the one KNOWN_PUSHES makes. Each row below declares
 * WHO it is addressed to, and the test checks the two things the reader will
 * silently get wrong:
 *
 *   1. the route survives `safeRoute` for the build that RECEIVES it. A route
 *      naming another group is not an error anywhere — it is stored happily and
 *      it renders as a readable row with "Nothing to open" under it, which is
 *      the failure mode a coach reports as "the notification does nothing".
 *   2. `inboxIcon` gives it the icon this catalogue names. The reader derives
 *      the icon from the ROUTE (src/ui/notifications.tsx, `rowToItem`) and
 *      ignores the `icon` column the trigger wrote, so a trigger that picks a
 *      good icon and a route this table has no entry for draws the generic
 *      bell — indistinguishable from "we have no idea what this is".
 *
 * Like KNOWN_PUSHES this is a hand-maintained snapshot and it is honest about
 * that: it cannot make the SQL correct, and a trigger added without a line here
 * costs nothing at runtime. What it does is make the route and the icon a coach
 * will actually get visible in TypeScript, next to the rules that produce them.
 */
export interface ServerWritten {
  /** The file that writes it. */
  where: string;
  /** The condition, in the words a reviewer needs. */
  when: string;
  /** The build the recipient is running, which is what the route must match. */
  to: 'client' | 'trainer' | 'owner';
  title: string;
  route: string | null;
  /** What `inboxIcon` will give the row. Not necessarily the `icon` column the
   *  writer set — the reader recomputes it. */
  icon: InboxIcon;
}

export const SERVER_WRITTEN: ReadonlyArray<ServerWritten> = [
  // ── the edge function (part 26) ──────────────────────────────────────────
  {
    where: 'supabase/functions/notify-message',
    when: 'a coach sends a chat message',
    to: 'client', title: 'the coach’s name', route: '/(client)/messages', icon: 'message',
  },
  {
    where: 'supabase/functions/notify-message',
    when: 'a client sends a chat message',
    to: 'trainer', title: 'the client’s name',
    // The parameter is the whole point of this entry. Without it the row opens
    // a coach's thread LIST and not the thread; with it, safeRoute's query
    // string branch is the thing keeping it followable.
    route: '/(trainer)/chat?clientId=00000000-0000-0000-0000-000000000000', icon: 'message',
  },
  // ── the gym's invoice (part 146) ─────────────────────────────────────────
  {
    where: 'supabase/parts/146 · gym_invoices_notify_member',
    when: 'a gym invoice leaves draft',
    // Routeless on purpose: there is no member screen for `gym_invoices` yet,
    // and the bell is what a row with nowhere to go is drawn with.
    to: 'client', title: 'An invoice from your gym', route: null, icon: 'bell',
  },
  // ── the coach's three (part 158) ─────────────────────────────────────────
  //
  // Everything a client does reached a coach only if the coach went looking. A
  // coaching request sat on a dashboard card, a subscription failing or ending
  // was a number on a screen nobody opens daily, and an accepted waiver was
  // nothing at all. These are the three the roadmap named.
  {
    where: 'supabase/parts/158 · coach_request_notify',
    when: 'a client asks to be coached — from the directory or by join code',
    to: 'trainer', title: 'A coaching request', route: '/(trainer)/dashboard', icon: 'people',
  },
  {
    where: 'supabase/parts/158 · coach_doc_acceptance_notify',
    when: 'a client accepts one of the coach’s documents',
    to: 'trainer', title: 'Paperwork accepted', route: '/(trainer)/documents', icon: 'pencil',
  },
  {
    where: 'supabase/parts/158 · client_subscription_notify',
    when: 'subChange() says a subscription started — see src/lib/subscriptionScope.ts',
    to: 'trainer', title: 'A subscription has started', route: '/(trainer)/payments', icon: 'grid',
  },
  {
    where: 'supabase/parts/158 · client_subscription_notify',
    when: 'subChange() says a payment failed',
    to: 'trainer', title: 'A subscription payment failed', route: '/(trainer)/payments', icon: 'grid',
  },
  {
    where: 'supabase/parts/158 · client_subscription_notify',
    when: 'subChange() says a subscription ended',
    to: 'trainer', title: 'A subscription has ended', route: '/(trainer)/payments', icon: 'grid',
  },
  // ── the other seven (part 159) ───────────────────────────────────────────
  //
  // Part 158 closed three of the silences its own sweep found. These are the
  // rest of them, and two are addressed to the CLIENT rather than the coach —
  // the first server-written rows in this table that are, apart from chat and
  // the gym invoice. That is what entry 1 of the test below is for: a client's
  // row carrying a '/(trainer)/…' route renders perfectly and opens nothing.
  {
    where: 'supabase/parts/159 · coaching_end_notify',
    when: 'a client ends the coaching (ended_by = client_id)',
    to: 'trainer', title: 'A client has ended their coaching', route: '/(trainer)/dashboard', icon: 'people',
  },
  {
    where: 'supabase/parts/159 · coaching_end_notify',
    when: 'a coach ends the coaching (ended_by = coach_id)',
    // Routeless on purpose, and not for want of a screen: the sentence promises
    // that this person's training history, photos and measurements are still
    // theirs, and those are three screens. Picking one would be a coin toss.
    to: 'client', title: 'Your coaching has ended', route: null, icon: 'bell',
  },
  {
    where: 'supabase/parts/159 · client_purchase_notify',
    when: 'a client buys a package or a session pack',
    to: 'trainer', title: 'A package was bought', route: '/(trainer)/payments', icon: 'grid',
  },
  {
    where: 'supabase/parts/159 · class_promotion_notify',
    when: 'a waitlisted member is promoted into a class seat by somebody else',
    to: 'client', title: 'A place has opened in a class', route: '/(client)/classes', icon: 'calendar',
  },
  {
    where: 'supabase/parts/159 · client_intake_notify',
    when: 'a client’s intake document exists for the first time',
    // The parameter is the point, as it is for the coach's chat thread above:
    // without it this opens a screen that says no client was named.
    to: 'trainer', title: 'An intake has come back',
    route: '/(trainer)/client-intake?clientId=00000000-0000-0000-0000-000000000000', icon: 'pencil',
  },
  {
    where: 'supabase/parts/159 · liability_waiver_notify',
    when: 'a client signs the platform liability release',
    // Routeless because `liability_waivers` has no coach read policy at all and
    // should not have one (part 84). There is no screen this could open.
    to: 'trainer', title: 'A client has signed the release', route: null, icon: 'bell',
  },
  {
    where: 'supabase/parts/159 · coach_review_notify',
    when: 'a client leaves or revises a review — at every rating, unfiltered',
    to: 'trainer', title: 'A client has left you a review', route: '/(trainer)/credentials', icon: 'trophy',
  },
  // ── the client's half of a failed card (part 160) ────────────────────────
  //
  // Part 158 writes three subscription rows and all three go to the COACH,
  // including the one about a declined card — which the coach cannot fix. This
  // is the same transition told to the person whose card it is. Two rows, two
  // recipients, two routes, and the pair below is why the `to` field on this
  // table earns its place: they are one line apart and one of them is refused
  // by the other's build.
  {
    where: 'supabase/parts/160 · client_subscription_notify_client',
    when: 'subChange() says a payment failed — the client’s half of part 158’s middle band',
    to: 'client', title: 'Your payment did not go through', route: '/(client)/packages', icon: 'trophy',
  },
  // ── the pack running out (part 163) ──────────────────────────────────────
  //
  // `packRunOut()` in src/lib/coachMoney.ts could always say a paid pack was
  // spent, and exactly one thing rendered it: app/(trainer)/payments.tsx, a
  // screen a coach opens when they are thinking about money. That is not the
  // moment this matters. The moment is the session AFTER the last one, when the
  // coach turns up and delivers something nothing pays for.
  //
  // Two rows rather than one, because a notification at zero is late. The
  // warning at one session left is the cheap conversation; the one at zero is
  // the fact. Both are downward crossings, so a pack going 2 → 1 → 0 produces
  // exactly these two and a refund that puts sessions back produces neither.
  //
  // Neither carries a figure. `client_purchases.amount_cents` is nullable and
  // its currency is a separate, often-null column, and part 150 left this
  // product with no default currency anywhere — so the count is the message and
  // Payments & Packages is where it is priced.
  {
    where: 'supabase/parts/163 · pack_balance_notify',
    when: 'a paid session pack crosses down to one session left',
    to: 'trainer', title: 'A session pack is nearly used up', route: '/(trainer)/payments', icon: 'grid',
  },
  {
    where: 'supabase/parts/163 · pack_balance_notify',
    when: 'a paid session pack reaches none left — including via promote_from_waitlist()',
    to: 'trainer', title: 'A session pack has run out', route: '/(trainer)/payments', icon: 'grid',
  },
  // ── three the app computed and told nobody (part 202) ────────────────────
  //
  // The first and the third are the first SCHEDULED writers in this table.
  // Everything above is a trigger firing inside somebody's transaction; these
  // two are a nightly pg_cron pass, because both are about the ABSENCE of a
  // write — nobody inserts a row saying "this client did not come in", and
  // nobody inserts one saying "your insurance ran out today".
  {
    where: 'supabase/parts/202 · run_overdue_client_notices',
    when: 'a client is past their own median gap between active days by more than the tolerance in src/lib/cadence.ts',
    to: 'trainer', title: 'A client is past their usual gap', route: '/(trainer)/nudges', icon: 'bell',
  },
  {
    where: 'supabase/parts/202 · goal_achieved_notify',
    when: 'a client marks one of their own goals reached — the upward crossing of goal_targets.achieved_at',
    // The parameter is the point, as it is for the coach's chat thread and
    // their client's intake: client-goals.tsx has a roster picker and opens
    // without one, so a missing id is not an error — it is a notification about
    // a named person that opens a list of everybody.
    to: 'trainer', title: 'A client has hit a goal',
    route: '/(trainer)/client-goals?clientId=00000000-0000-0000-0000-000000000000', icon: 'trophy',
  },
  {
    where: 'supabase/parts/202 · run_credential_expiry_notices',
    when: 'a coach’s credential or insurance is sixty days from expiry, and again on the day it lapses',
    // The only row in this table addressed to a coach about the COACH rather
    // than about a client, and the only one whose consequence is outside the
    // app: lapsed public liability means somebody is working uninsured.
    to: 'trainer', title: 'Your insurance runs out soon', route: '/(trainer)/credentials', icon: 'trophy',
  },
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
