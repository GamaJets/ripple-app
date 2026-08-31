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

/** Icons the inbox draws. A subset of `IconName` in src/ui/Icon.tsx — narrowed
 *  here rather than imported because src/lib may not reach into src/ui (that
 *  file is .tsx and pulls in react-native-svg, which does not compile under
 *  tsconfig.test.json or run in the web console). The UI assigns these straight
 *  into `IconName`, so a value added here that Icon does not draw fails to
 *  typecheck at the use site. */
export type InboxIcon = 'bell' | 'calendar' | 'message' | 'sparkle' | 'heart' | 'dumbbell' | 'trophy';

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
