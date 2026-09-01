// Who is allowed to touch a recurring charge, and what to do with a status
// nobody wrote a sentence for.
//
// ── Why this is a pure module, and why the edge function imports it ───────
//
// The rule below is the ONLY thing standing between one coach and another
// coach's subscriptions. `connect-checkout` runs as the service role, and the
// service role is not subject to RLS — so `client_subs_read` (which already
// says client_id = auth.uid() OR trainer_id = auth.uid() OR the owner of that
// coach's gym) does not protect that function at all. The check RLS would have
// made has to be made in code, and a rule about somebody's money that exists
// only inside a Deno function is a rule that can never be asserted.
//
// So it lives here, with a test, and `supabase/functions/connect-checkout`
// imports it the same way `ads-sync` imports src/lib/adMatch.ts. It is imported
// rather than copied on purpose: a second copy of these three lines would be
// the one that drifts, and the test would keep passing on the other one.
//
// ── What the rule is ─────────────────────────────────────────────────────
//
// A subscription has exactly two parties: the client paying and the coach being
// paid. Both may STOP it at the end of the period and both may put it back —
// the coach because it is their client and their revenue, and because a coach
// who cannot stop a charge in the app has to be sent to a Stripe dashboard they
// may not have; the client because it is their money.
//
// Nobody else. Not the coach next door, and not a signed-in stranger with a
// subscription id — which is the whole failure mode this file exists to
// prevent, because a `sub_...` id is a bearer token if the server does not ask
// whose it is.
//
// The gym OWNER is deliberately NOT here, even though `client_subs_read` lets
// them READ the row. Reading a subscriber list to run a gym and cancelling
// somebody's card payment are different acts, and the second one has never been
// asked for. Widening this is a decision, not an oversight to be tidied up.
//
// ── The one action that stays the client's alone ─────────────────────────
//
// `portal` opens Stripe's hosted billing portal against the CLIENT's Stripe
// customer: their saved card, their invoices, their receipts, their address —
// and the controls to change all of it. That is the client's private financial
// record, not the coach's business, and handing a coach a session for it would
// be a data breach dressed up as a convenience. A coach who needs an invoice
// asks the client for it. So `portal` is client-only, and it is refused with a
// sentence that says why rather than with a lie about the row not existing.

/** The two columns on `client_subscriptions` that say whose subscription this
 *  is. Both are nullable — `ON DELETE SET NULL` against `profiles` — and a null
 *  must never match anybody, which is the point of the emptiness checks below. */
export type SubscriptionParties = {
  client_id?: string | null;
  trainer_id?: string | null;
};

/** Everything `connect-checkout` will do to a subscription that already exists. */
export type SubAction = 'cancel' | 'resume' | 'portal';

/** Which side of the subscription the caller is on. 'stranger' is everybody
 *  else, including the gym owner and including a caller with no uid at all. */
export type Party = 'client' | 'trainer' | 'stranger';

/**
 * Which party the caller is, from the row alone.
 *
 * Trimmed and compared as strings rather than with `===` on the raw values,
 * because a null trainer_id and an undefined uid are both falsy and both
 * "unknown", and `null === null` would have made every orphaned row belong to
 * every unauthenticated caller. An empty side matches nobody, ever.
 *
 * The client is checked first. A coach who has subscribed to their own package
 * — which happens, when they test it — is treated as the client, which is the
 * more permissive of the two and the one that keeps their own billing portal
 * reachable.
 */
export function partyOf(row: SubscriptionParties | null | undefined, uid: string | null | undefined): Party {
  const me = String(uid ?? '').trim();
  if (!me) return 'stranger';
  const client = String(row?.client_id ?? '').trim();
  if (client && client === me) return 'client';
  const trainer = String(row?.trainer_id ?? '').trim();
  if (trainer && trainer === me) return 'trainer';
  return 'stranger';
}

/**
 * May this caller perform this action on this subscription?
 *
 * Anything that is not one of the three known actions is refused. The caller
 * decides which of the two refusals to print: a stranger is told the
 * subscription was not found (confirming an id exists to somebody who has no
 * business with it is itself a leak), while a coach asking for the billing
 * portal is told plainly that it is the client's.
 */
export function mayAct(
  row: SubscriptionParties | null | undefined,
  uid: string | null | undefined,
  action: string,
): boolean {
  const party = partyOf(row, uid);
  if (party === 'stranger') return false;
  // The client's card and invoices. Never the coach's to open. See above.
  if (action === 'portal') return party === 'client';
  return action === 'cancel' || action === 'resume';
}

/**
 * The sentence for a refusal, so the two cases cannot be collapsed into one by
 * accident later. Null when the action is allowed.
 */
export function refusalFor(
  row: SubscriptionParties | null | undefined,
  uid: string | null | undefined,
  action: string,
): { status: number; error: string } | null {
  if (mayAct(row, uid, action)) return null;
  if (partyOf(row, uid) === 'trainer' && action === 'portal') {
    return {
      status: 403,
      error: 'The billing portal holds your client’s own card, invoices and receipts, so it is theirs to open, not yours. They can reach it from their Memberships screen.',
    };
  }
  // Everything else, including an action this function does not have: the same
  // answer a caller gets for an id that does not exist, so that guessing ids
  // tells them nothing.
  return { status: 404, error: 'subscription not found' };
}

// ── what state a subscription is in ──────────────────────────────────────
//
// `client_subscriptions.status` is written by the stripe-webhook, verbatim,
// from whatever word Stripe used. Repple has never chosen that vocabulary and
// cannot: Stripe has added statuses before (`paused`) and will again.
//
// Every screen in the app filtered that column with `isLive`, which answers
// true for three words and false for everything else — so a subscription in a
// state this app has no sentence for did not render as unknown, it rendered as
// NOTHING. A coach with one paused subscriber read "Nobody is subscribed yet"
// on a screen that had the row in memory. That is the failure this split
// exists to end: a status we cannot place is shown, not hidden.

/**
 * Three buckets, and the third is the one that matters.
 *
 *   live       charging, or about to. Exactly the words `LIVE_STATUSES` in
 *              subscriptions.ts already names, unchanged — `past_due` included,
 *              because a failed card has not ended anything.
 *   ended      over, and Stripe's own words for over: the client is not being
 *              charged and will not be again on this subscription.
 *   unsettled  neither. `incomplete` (the first payment has not cleared),
 *              `paused`, and — the reason this bucket is a default rather than
 *              a list — any word Stripe invents after this was written.
 *
 * `unsettled` is deliberately the fallback rather than `ended`. Filing an
 * unrecognised status as finished is how a live subscriber disappears from a
 * coach's list, and the coach then believes a client churned who is in fact
 * still on the books.
 */
export type SubState = 'live' | 'ended' | 'unsettled';

/** Charging or about to. Kept identical to `LIVE_STATUSES` in subscriptions.ts
 *  on purpose — the client's Memberships screen filters on that one and must
 *  not start disagreeing with this one about who is subscribed. */
const LIVE = new Set(['trialing', 'active', 'past_due']);

/** Over. Stripe's spellings, and only Stripe's — 'canceled' with one L is the
 *  word the API sends, and inventing aliases here would file states that never
 *  arrive while doing nothing about the ones that do. */
const ENDED = new Set(['canceled', 'incomplete_expired', 'unpaid']);

export function subState(status: string | null | undefined): SubState {
  const s = String(status ?? '').trim().toLowerCase();
  if (LIVE.has(s)) return 'live';
  if (ENDED.has(s)) return 'ended';
  return 'unsettled';
}

/**
 * What to tell a coach about a subscription that is neither charging nor
 * finished — including one whose status word this app has never seen.
 *
 * The unknown case quotes Stripe's word back rather than paraphrasing it. A
 * word we do not understand is exactly the thing a coach should be able to
 * search for, and a sentence that smoothed it into "something went wrong" would
 * take away the only fact we actually have.
 */
export function unsettledNote(status: string | null | undefined): string {
  const raw = String(status ?? '').trim();
  switch (raw.toLowerCase()) {
    case 'incomplete':
      return 'The first payment has not gone through yet, so nothing has been charged. Stripe gives the card about a day, then ends the subscription on its own.';
    case 'paused':
      return 'Stripe has this subscription paused. It is not being charged, and it has not ended.';
    case '':
      return 'Stripe has not said what state this subscription is in, so this app cannot say whether it is charging.';
    default:
      return `Stripe reports this subscription as “${raw}”, which is a state this app has no settled meaning for. It is shown rather than hidden: as far as we can tell it is neither charging nor finished.`;
  }
}

/**
 * Whether the stop/resume controls should be offered on a row.
 *
 * Only on a live one. `cancel_at_period_end` is a switch on a running
 * subscription; Stripe refuses it on one that has ended, and offering a button
 * whose only outcome is an error message is the thing this screen already
 * refused to do once.
 */
export function canSwitchCancel(status: string | null | undefined): boolean {
  return subState(status) === 'live';
}

/* ── what a coach is told about a subscription, and when ───────────────────
 *
 * A coach is told about exactly three things today: a PT booking, a session
 * cancellation, and a client message. A subscription starting, a card failing
 * and a client churning are all silent — `client_subscriptions` is written only
 * by `supabase/functions/stripe-webhook`, which contains no notification code
 * at all, so the first a coach hears of a lost subscriber is the next time they
 * open Payments & Packages and count the rows.
 *
 * ── Why the decision is HERE and the trigger only mirrors it ──────────────
 *
 * The write happens in the database (supabase/parts/158), because the only
 * writer of that table is a webhook running as the service role with no
 * `auth.uid()` — `notify_users()` correctly returns 0 for such a caller, and
 * the app never sees the event at all. So the notification cannot be sent from
 * a screen, and a trigger is the only place it can come from.
 *
 * That would normally mean the rule is stated in plpgsql and never tested. The
 * rule is not arithmetic: it is a reading of Stripe's status vocabulary, the
 * same reading `subState` above already makes, and a second copy of that
 * vocabulary would be the copy that drifts — the exact failure the header of
 * this file spends a paragraph on for `mayAct`. So the sets are used once,
 * here, and the trigger mirrors this function line for line with a comment
 * naming it. This function has no runtime caller in the app, and that is
 * deliberate rather than dead code: it is the specification, and the truth
 * table in subscriptionScope.test.ts is the only place the rule can be proved
 * before it is deployed to a database nobody can run a test against.
 *
 * ── Why these three and not "every status change" ─────────────────────────
 *
 * A signup is TWO writes — `incomplete` then `active` — and a coach told twice
 * about one subscriber learns to ignore the notification. A retry that succeeds
 * is `past_due` then `active`, and calling that second one "started" would
 * report a new subscriber who has been there for months. So the transitions are
 * stated as movements between bands, not as arrivals at words:
 *
 *   started  reaching 'active' or 'trialing' from a status that has never
 *            charged: nothing at all (a row Stripe has just created) or
 *            'incomplete' (the first payment has not cleared). NOT from
 *            'past_due', which is a card recovering; NOT from 'paused', which
 *            is a subscriber the coach already had; and NOT from a word this
 *            app does not recognise, because a resume and a signup are
 *            indistinguishable from the outside and "your client has started
 *            subscribing" is the wrong one to guess.
 *   failed   reaching 'past_due'. Inside the live band — a failed card has not
 *            ended anything — but it is the one a coach can act on today.
 *   ended    reaching any of Stripe's words for over, from outside that band.
 *
 * `null` for everything else, including a status word Stripe invents after this
 * was written. Silence about a state we have no sentence for is right: the
 * coach's Payments screen already shows such a row and quotes Stripe's own word
 * back (`unsettledNote`), and a notification cannot do that in a way anybody
 * could act on.
 */
export type SubChange = 'started' | 'failed' | 'ended';

/** Statuses that mean the subscription is charging in the ordinary way.
 *  Deliberately NOT `LIVE`: that set includes 'past_due', because a failed card
 *  has not ended anything — but arriving at 'active' from 'past_due' is a
 *  recovery and must not be announced as a new subscriber. */
const CHARGING = new Set(['trialing', 'active']);

/** Statuses a subscription can be in having never taken a payment. The only
 *  two a 'started' may be announced from — see above for why 'paused' and an
 *  unrecognised word are not among them. */
const NEVER_CHARGED = new Set(['', 'incomplete']);

/**
 * What (if anything) to tell the coach, given the status this row held before
 * and the status it holds now.
 *
 * `before` is the empty string for a row that has just been inserted, which is
 * how a subscription that arrives already active is reported as started.
 */
export function subChange(before: string | null | undefined, after: string | null | undefined): SubChange | null {
  const a = String(before ?? '').trim().toLowerCase();
  const b = String(after ?? '').trim().toLowerCase();
  // No movement is no news. Stripe retries webhooks, and a redelivery rewrites
  // the row with the status it already had; announcing that would tell a coach
  // a client churned twice.
  if (a === b) return null;
  if (subState(b) === 'ended' && subState(a) !== 'ended') return 'ended';
  if (b === 'past_due') return 'failed';
  if (CHARGING.has(b) && NEVER_CHARGED.has(a)) return 'started';
  return null;
}
