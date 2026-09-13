// Whether this app has heard from Stripe, and when it last did.
//
// ── The two empty screens this exists to tell apart ────────────────────────
//
// Every figure under "Taken Through Stripe" on app/(trainer)/payments.tsx comes
// from `client_purchases` and `client_subscription_payments`, and both tables
// are written by exactly one thing: supabase/functions/stripe-webhook. So an
// empty Payments screen has two completely different causes and, until this
// module, one appearance:
//
//   · nobody has bought anything yet. Ordinary, and where all seven live
//     coaches start;
//   · the webhook has never been reached. The endpoint in the Stripe dashboard
//     is wrong, or the signing secret does not match, or the function was
//     deployed without `--no-verify-jwt` so Stripe's unsigned POST is refused
//     before any handler runs. Clients ARE being charged and this app is never
//     told.
//
// The second is an incident that presents as a quiet week. `stripe_last_heard()`
// (supabase/parts/2630) is the only evidence either way, and this module is what
// that evidence is allowed to say.
//
// ── What this may NOT be read as ───────────────────────────────────────────
//
// A diagnosis. `stripe_webhook_events` records events this project HANDLED, and
// Stripe only sends one when something happens — so a coach who has sold
// nothing for a fortnight has a fortnight-old heartbeat and a perfectly healthy
// webhook. There is no threshold in this file past which anything is called
// broken, because no such threshold exists: the age of the last event is a fact
// about how busy the deployment has been and not about whether it is working.
//
// The one genuinely diagnostic state is `silent` — never heard, not once, from
// anybody, since the ledger was created. That is not a quiet fortnight. That is
// a connection that has never carried anything.
//
// A statement about THIS COACH's sales, either. The table has three columns —
// id, type, handled_at — and no tenant, no coach and no customer, so the figure
// is about the whole deployment and every sentence below says so. A coach told
// "last heard 4 hours ago" who read it as "somebody bought something from me 4
// hours ago" has been misled by this module, which is why
// `STRIPE_PULSE_IS_NOT_YOUR_SALES` is on the screen and not only in this
// comment.
//
// Pure, framework-free and asserted against under plain `node`. The read is in
// src/ui/stripeHeartbeat.ts.
import { agePhrase } from './freshness';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/** What `stripe_last_heard()` answers with: the instant of the most recent
 *  handled event, and how many have ever been handled. Both are aggregates over
 *  a possibly empty table, so a successful read of a deployment Stripe has
 *  never reached is `{ at: null, events: 0 }` — and that is a FACT, not a
 *  missing answer. */
export interface StripeHeard {
  /** An ISO instant — `handled_at` is a `timestamptz`, so it means a moment and
   *  is parsed as one. This is the one date in the coach money lane that is NOT
   *  a bare `YYYY-MM-DD`, and reading it as a local calendar day would be the
   *  mirror image of the mistake src/lib/localDate.ts exists for. */
  at: string | null;
  events: number | null;
}

/**
 * Where this deployment stands with Stripe.
 *
 *   'unread'      the call failed or has not landed. NOTHING may be said —
 *                 least of all "never heard", which is the one sentence a
 *                 failed read would turn into an accusation.
 *   'silent'      the call succeeded and the ledger is empty. This app has
 *                 never completed a Stripe webhook.
 *   'unreadable'  the ledger has a most-recent event and its date will not
 *                 parse. Something IS on record; how long ago is unknown, and
 *                 a guessed age here would be a made-up fact about a wire.
 *   'heard'       an event was handled, at a moment that reads.
 */
export type StripePulse =
  | { kind: 'unread' }
  | { kind: 'silent' }
  | { kind: 'unreadable'; events: number | null }
  | { kind: 'heard'; at: string; ageMs: number; events: number | null };

/**
 * The pulse, from the read and the clock.
 *
 * `now` is passed in rather than read here, for the reason every dated module
 * in this folder passes it: a function that reads its own clock cannot be
 * asserted against, and the assertions are the only thing that stops a negative
 * age becoming "-3 hours ago" on somebody's screen.
 *
 * `isWhole` rather than `status === 'ready'`, and it is checked FIRST. A
 * single-row aggregate cannot come back 'partial', but the gate is the same one
 * every figure in this app passes and writing it as `!== 'error'` is how a
 * 'loading' read becomes a confident "never".
 */
export function stripePulse(
  heard: StripeHeard | null | undefined,
  status: LoadStatus,
  now: number,
): StripePulse {
  if (!isWhole(status) || !heard) return { kind: 'unread' };
  const events = heard.events != null && Number.isFinite(heard.events) ? heard.events : null;
  const raw = String(heard.at ?? '').trim();
  if (!raw) return { kind: 'silent' };
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return { kind: 'unreadable', events };
  return { kind: 'heard', at: raw, ageMs: now - t, events };
}

/**
 * The one line this puts on the Payments screen.
 *
 * Four sentences for four states, none of which is a diagnosis. `agePhrase`
 * rounds DOWN and answers 'just now' for a negative age, so a phone whose clock
 * is ahead of the server's does not produce "-2 minutes ago" — see
 * src/lib/freshness.ts, which is reused here rather than copied precisely so
 * that rounding rule stays in one place.
 */
export function stripePulseLine(p: StripePulse): string {
  if (p.kind === 'unread') {
    return 'Whether this app has heard from Stripe could not be read just now. That is not a statement that it has not — nothing below is affected, and neither is anything Stripe has already recorded.';
  }
  if (p.kind === 'silent') {
    return 'This app has never heard from Stripe. Card payments reach Repple through a webhook Stripe calls, and not one has ever arrived — so if a client has paid you by card, that payment is at Stripe and this app was never told about it. An empty list below is this, not a quiet month.';
  }
  if (p.kind === 'unreadable') {
    return 'This app has heard from Stripe, and the date it last did could not be read. Something is on record; how long ago is not, and a figure is not going to be invented for it.';
  }
  return `Last heard from Stripe ${agePhrase(p.ageMs)}.`;
}

/**
 * What the count is, said only where there is one. Null when there is nothing
 * honest to count.
 *
 * A separate sentence rather than an extra clause on the line above, because a
 * coach reading a heartbeat wants the age first and the volume second — and
 * because `events` can be null while the age is perfectly good, and a template
 * that interpolated a null would print the four characters "null" into a figure.
 */
export function stripeEventsLine(p: StripePulse): string | null {
  if (p.kind === 'unread' || p.kind === 'silent') return null;
  const n = p.events;
  if (n == null || n <= 0) return null;
  return `${n} ${n === 1 ? 'event has' : 'events have'} been handled since this app was connected.`;
}

/**
 * That the heartbeat is about the wire and not about the coach.
 *
 * On the screen, not only here. "Last heard from Stripe 4 hours ago" sits
 * directly above this coach's own takings, and the obvious misreading — that
 * somebody bought something from them 4 hours ago — is one a person makes
 * without noticing. The ledger has no tenant column and cannot be narrowed to
 * one coach, so the honest fix is to say what it covers.
 */
export const STRIPE_PULSE_IS_NOT_YOUR_SALES =
  'This is about the connection between Repple and Stripe, not about your own sales. Every coach on this app shares one webhook, so the time above is when it last carried anybody’s payment — not necessarily one of yours.';

/**
 * That a quiet heartbeat is not a broken one.
 *
 * The sentence that stops this feature generating support requests. Stripe only
 * calls the webhook when something happens, so an old timestamp on a deployment
 * where nobody sold anything this week is exactly correct and means nothing is
 * wrong. Nothing in this module calls anything broken, and this says why.
 */
export const STRIPE_PULSE_IS_NOT_A_HEALTH_CHECK =
  'Stripe only calls this app when something happens, so a date a while back means a quiet stretch rather than a fault. The state worth acting on is the one that says Stripe has never reached this app at all.';
