// Which switch a written notification answers to, and whether anything is
// going to push it.
//
// ── The defect this exists for ─────────────────────────────────────────────
//
// `COACH_CHANNELS` in src/lib/coachNotify.ts offers six switches. Two of them
// — `money` and `admin` — had no sender anywhere: nothing in the three apps
// ever passed those strings to `sendPushChecked`. A coach could mute two
// controls that nothing had ever sent on, and the screen said nothing about it.
//
// The reason was structural rather than an oversight. Every event those two
// channels name — a package bought, a subscription starting or failing, an
// intake returned, a document accepted, a release signed, a review left, a pack
// running out, an invoice ageing — is written SERVER-SIDE, by a trigger or a
// nightly pass, as a direct `insert into public.notifications`. Twenty-two of those
// statements exist across thirteen numbered parts. Not one of them reached
// `pg_net`, and nothing in the schema turned a `notifications` insert into a
// push. `supabase/parts/26` (messages → pg_net → `notify-message`) was the only
// server-side writer that posted anywhere at all.
//
// So roughly twenty-eight server-written notification kinds reached a phone
// only if the person happened to open the app, and `SERVER_WRITTEN` below them
// in src/lib/notifyInbox.ts catalogued every one of them without anybody
// noticing that the catalogue was a list of things nobody was told.
//
// ── Why the channel is DERIVED and not passed ──────────────────────────────
//
// The obvious fix is to make each of those inserts name its own channel. That
// is twenty-two edits in thirteen files owned by different people, and it is
// the shape of change this codebase already refused once: notifyInbox.ts
// puts the record/skip decision at the one choke point rather than at eleven
// call sites, "because a check at the call site is a check somebody forgets at
// the next one, and the next one is always the one that matters".
//
// So the channel is computed from what the row already carries, in one place.
// The primary signal is the ROUTE, which is the same signal `inboxIcon` uses
// and for the same reason: src/ui/notifications.tsx already ignores the `icon`
// column the trigger wrote and recomputes it from the route, because a route is
// a structural fact about what the notification is about and an icon is a
// choice somebody made in passing. A notification that opens Payments is about
// money whoever wrote it.
//
// ── The title fallback, and why its brittleness is the cheap kind ──────────
//
// Three server-written rows carry NO route, each for a stated reason:
// 'An invoice from your gym' (part 146 — no member screen for `gym_invoices`
// exists), 'Your coaching has ended' (part 159 — the sentence promises three
// screens and picking one would be a coin toss), and 'A client has signed the
// release' (part 159 — `liability_waivers` has no coach read policy and should
// not have one). A route-only mapping would silently never push any of them,
// and the third is a coach's paperwork.
//
// They are matched on the TITLE, which is brittle in exactly the way
// notifyInbox.ts says title matching is brittle — reword the literal in the SQL
// and the classification changes silently. It is tolerable here only because of
// WHICH WAY it falls: a miss returns null, null is not dispatched, and not
// dispatched is precisely the behaviour those three rows have today. A reword
// costs the notification nothing it has not already lost. It cannot ever cause
// a push on the wrong switch, because a wrong title matches nothing.
//
// ── Null is a refusal to guess, and it is the safe direction ───────────────
//
// `notificationChannel` returns null for a row it cannot classify, and a null
// channel is NOT dispatched. That is deliberate and it is the opposite of this
// codebase's usual "err towards the notification" rule, so it needs its own
// argument.
//
// supabase/functions/send-push drops muted recipients only when a `channel` is
// passed — a send with no channel is not filtered at all. So a dispatch that
// passed no channel would push every coach who had muted anything, on every
// switch, and the settings screen would be showing six controls that the newest
// sender ignores. That is the master switch's original defect pointing the
// other way, which is the failure src/lib/coachNotify.ts and part 251 were both
// written to prevent.
//
// Erring towards the notification is the recoverable error when the choice is
// "send or swallow". Here the choice is "send unmutably, or leave a kind
// exactly as silent as it already is", and silence loses nothing that is not
// already lost. `notifyDispatch.test.ts` pins that every route in
// `SERVER_WRITTEN` maps to a channel, so a new trigger with an unclassified
// route fails a test rather than going quiet.
//
// Pure. The SQL mirror is `public.notification_channel(route, title)` in
// supabase/parts/900-a-written-notification-that-reaches-a-phone.sql, and the
// test below is the thing that makes the two visibly one decision.
import type { CoachChannel } from './coachNotify';

/**
 * Routes whose notification is pushed by whoever wrote the row, so the
 * server-side dispatcher must not push it a second time.
 *
 * Chat, and only chat. `supabase/parts/26` posts to the `notify-message` edge
 * function, which writes the `notifications` row AND sends the Expo push
 * itself; src/ui/messaging.ts sends a second, correctly-routed push for the
 * coach's side. A dispatcher that also pushed these would make every message in
 * the product arrive twice.
 *
 * Matched on the route rather than on the writer for the reason notifyInbox.ts
 * gives for the same rule from the other side: the duplicate exists precisely
 * because a `messages` row was inserted, and a push about a `messages` row is a
 * push whose route is a message thread. A title can be reworded; a chat push
 * that no longer points at the chat is not a chat push.
 */
export const PUSHED_BY_ITS_WRITER: readonly string[] = [
  '/(client)/messages',
  '/(trainer)/chat',
];

/**
 * Route → the switch that governs it.
 *
 * WHOLE-ROUTE matching, with a query string allowed after it — the same rule
 * `inboxIcon` uses, and stated here rather than assumed because the obvious
 * reading (prefix matching) would make '/(trainer)/client-goals' shadow
 * '/(trainer)/client-photos' the moment somebody sorted this list. Order does
 * not matter and reordering cannot change an answer.
 *
 * The grouping is `COACH_CHANNELS`', which is by WHAT THE COACH WOULD DO ABOUT
 * IT rather than by which table the row came from.
 */
const CHANNEL_BY_ROUTE: ReadonlyArray<readonly [string, CoachChannel]> = [
  // ── chat ────────────────────────────────────────────────────────────────
  // Classified, and then excluded from dispatch by PUSHED_BY_ITS_WRITER above.
  // Both facts are true and they are different facts: the channel is what the
  // coach's switch governs, and the exclusion is about who sends it.
  ['/(client)/messages', 'chat'],
  ['/(trainer)/chat', 'chat'],

  // ── bookings ────────────────────────────────────────────────────────────
  // 'A client booking a session, cancelling one, or a slot re-opening.' Every
  // calendar screen in both builds, plus the two client screens that are a
  // calendar under another name, plus the class seat that opened (part 159) and
  // the answer to a request for an hour the coach had not opened (part 740).
  ['/(trainer)/calendar', 'bookings'],
  ['/(client)/calendar', 'bookings'],
  ['/(client)/bookings', 'bookings'],
  ['/(client)/pt-sessions', 'bookings'],
  ['/(client)/classes', 'bookings'],
  ['/(client)/request-session', 'bookings'],

  // ── money ───────────────────────────────────────────────────────────────
  // Payments & Packages is where parts 158, 159, 163, 611 and 612 send a coach:
  // a subscription started, failed or ended, a package bought, a pack nearly
  // used up, a pack used up, a pack out of time, a chargeback opened, a
  // chargeback decided. Eight kinds behind one switch, and the switch is the one
  // carrying `CHANNEL_QUIET_COST_MONEY`.
  ['/(trainer)/payments', 'money'],
  // Memberships & Packs — the client's half of a declined card (part 160).
  ['/(client)/packages', 'money'],
  // A gym's offer. Client-directed, and pushed today by the owner's own handset
  // (app/(owner)/promotions.tsx), so this classification is inert at runtime —
  // it is here so the column is not silently null on a row somebody later moves
  // server-side, and because an offer is a thing to buy.
  ['/(client)/explore', 'money'],
  ['/(client)/offers', 'money'],

  // ── clients ─────────────────────────────────────────────────────────────
  // The switch whose LABEL was wrong before this file existed — see the note in
  // src/lib/coachNotify.ts. It reads 'Joining And Leaving' and named two
  // things, while the schema had already been writing five kinds to it: a
  // coaching request and a coaching ending (parts 158, 159), a goal reached
  // (part 202), a progress photo sent (part 614), and an enquiry from somebody
  // with no account yet (part 470) — plus the personal best src/lib/prNotifyStore.ts
  // sends. The key is right and the label was narrow; the label moved.
  ['/(trainer)/dashboard', 'clients'],
  ['/(trainer)/leads', 'clients'],
  ['/(trainer)/client-goals', 'clients'],
  ['/(trainer)/client-training', 'clients'],
  ['/(trainer)/client-photos', 'clients'],
  // The client's side of the same conversation. Handset-pushed today.
  ['/(client)/my-coach', 'clients'],
  ['/(client)/trainers', 'clients'],

  // ── admin ───────────────────────────────────────────────────────────────
  // 'An intake coming back, a document accepted, a release signed, and a review
  // left' — parts 158, 159 — and one more the label did not name: a coach's own
  // credential or insurance approaching expiry (part 202), which shares
  // '/(trainer)/credentials' with the review. A route cannot separate those two,
  // and it does not need to: an insurance certificate with a date on it is
  // paperwork by any reading of that label, and the label now says so.
  ['/(trainer)/documents', 'admin'],
  ['/(trainer)/client-intake', 'admin'],
  ['/(trainer)/credentials', 'admin'],
  // The client's half of the intake — a form to fill in. Handset-pushed today
  // (src/ui/intake.ts).
  ['/(client)/intake', 'admin'],

  // ── book ────────────────────────────────────────────────────────────────
  // The coach's own book, and the three routes here are named almost word for
  // word by that channel's own note: 'A session waiting on an outcome, an
  // invoice past its due date, and a client who has stopped training.'
  //
  // `CoachChannelDef.local` is true for `book` and says nothing about the coach's
  // book has another person's action behind it to hang a trigger on. That was
  // true when it was written and parts 202, 471 and 613 have since made it half
  // false — not by hanging a trigger on somebody's action, but by adding NIGHTLY
  // PASSES, which are about the absence of a write and need nobody's action at
  // all. So the same switch now governs a banner this handset computes and a
  // push a cron job sends, and both must honour it or the switch lies about one
  // of them. See the note on `local` in src/lib/coachNotify.ts.
  ['/(trainer)/invoices', 'book'],
  ['/(trainer)/nudges', 'book'],
  // A training block that ran out under a client (part 471). Not one of the
  // three the note names, and it belongs with them rather than with `clients`:
  // it is the coach's own programme going stale, and what a coach does about it
  // is write the next block.
  ['/(trainer)/builder', 'book'],
];

/**
 * Server-written rows that carry no route at all, keyed on their title.
 *
 * Three, and there are three for stated reasons rather than by neglect — see
 * the header. The literals are the ones in supabase/parts/146 and /159; a
 * reword there and here must happen together, and `notifyDispatch.test.ts`
 * checks these against `SERVER_WRITTEN` so that a reword in one place is
 * visible in TypeScript rather than discovered by a coach who stopped being
 * told something.
 */
const CHANNEL_BY_TITLE: ReadonlyArray<readonly [string, CoachChannel]> = [
  // Part 146 · gym_invoices_notify_member — a gym invoice leaving draft.
  ['An invoice from your gym', 'money'],
  // Part 159 · coaching_end_notify — the client's half, when the coach ended it.
  ['Your coaching has ended', 'clients'],
  // Part 159 · liability_waiver_notify — the platform release, to the coach.
  ['A client has signed the release', 'admin'],
];

/** A route with any query string taken off it, or '' for nothing usable. */
function bareRoute(route: string | null | undefined): string {
  const r = (route ?? '').trim();
  if (!r) return '';
  const q = r.indexOf('?');
  return q === -1 ? r : r.slice(0, q);
}

/**
 * The switch a route answers to, or null for a route this build cannot place.
 *
 * Null is not "no switch governs this" — it is "nobody has decided", and the
 * dispatcher treats it as a refusal to send rather than as permission to send
 * unmutably. The header argues why that is the right direction here and only
 * here.
 */
export function channelForRoute(route: string | null | undefined): CoachChannel | null {
  const r = bareRoute(route);
  if (!r) return null;
  for (const [known, channel] of CHANNEL_BY_ROUTE) {
    if (r === known) return channel;
  }
  return null;
}

/** The switch a routeless server-written row answers to, or null. Exact match
 *  on the whole title, trimmed — a substring rule would put every future
 *  notification containing the word 'release' on the paperwork switch. */
export function channelForTitle(title: string | null | undefined): CoachChannel | null {
  const t = (title ?? '').trim();
  if (!t) return null;
  for (const [known, channel] of CHANNEL_BY_TITLE) {
    if (t === known) return channel;
  }
  return null;
}

/**
 * The switch a written notification answers to, from what the row carries.
 *
 * Route first, then the title. The route is tried first because it is the
 * structural signal and the title is a literal somebody may reword; a row with
 * a route this build does not know still gets its title tried, because a
 * classification is better than none and the title table cannot produce a wrong
 * one — an unknown title matches nothing.
 *
 * Mirrors `public.notification_channel(text, text)` exactly. Two copies of one
 * decision, in two languages, which is a cost this file pays deliberately: the
 * SQL is the one that runs, and this is the one that can be tested without a
 * database.
 */
export function notificationChannel(
  route: string | null | undefined,
  title: string | null | undefined,
): CoachChannel | null {
  return channelForRoute(route) ?? channelForTitle(title);
}

/** What the server-side dispatcher decides about one written row. */
export interface DispatchDecision {
  /** Whether the dispatcher posts this row to send-push. */
  dispatch: boolean;
  /** The channel passed with it, and the switch that will be honoured. Null
   *  only when `dispatch` is false. */
  channel: CoachChannel | null;
  /** Why, in the words a reviewer needs when somebody asks why a notification
   *  they can see in their inbox never reached their phone. */
  why: string;
}

/**
 * Whether a written notification should be pushed by the server, and on which
 * switch.
 *
 * `pushedByCaller` is the row's `push_by` column: true for a row written
 * through `notify_users()`, which is only ever called by a handset that has
 * either sent its own push through send-push (`sendPush`, `sendPushChecked`) or
 * decided on purpose not to (src/ui/coachInvoices.ts: "an invoice is not worth
 * waking a phone"). Both of those are answers, and a dispatcher that pushed
 * them anyway would double the first and overrule the second.
 *
 * The order of the three refusals is the order of their costs. Double-pushing
 * is the worst — it is visible to everybody and it is the thing that gets
 * notifications turned off — so it is checked first.
 */
export function dispatchDecision(
  route: string | null | undefined,
  title: string | null | undefined,
  pushedByCaller: boolean,
): DispatchDecision {
  if (pushedByCaller) {
    return {
      dispatch: false, channel: notificationChannel(route, title),
      why: 'written through notify_users(), whose callers send their own push or have decided not to',
    };
  }
  const r = bareRoute(route);
  if (r && PUSHED_BY_ITS_WRITER.includes(r)) {
    return {
      dispatch: false, channel: notificationChannel(route, title),
      why: 'a chat message; the notify-message edge function pushes this row itself (part 26)',
    };
  }
  const channel = notificationChannel(route, title);
  if (!channel) {
    return {
      dispatch: false, channel: null,
      why: 'nothing here says which switch governs it, and send-push does not filter a channelless send at all',
    };
  }
  return { dispatch: true, channel, why: 'nothing else pushes this row' };
}
