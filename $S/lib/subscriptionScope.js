"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.partyOf = partyOf;
exports.mayAct = mayAct;
exports.refusalFor = refusalFor;
exports.subState = subState;
exports.unsettledNote = unsettledNote;
exports.canSwitchCancel = canSwitchCancel;
exports.subChange = subChange;
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
function partyOf(row, uid) {
    const me = String(uid ?? '').trim();
    if (!me)
        return 'stranger';
    const client = String(row?.client_id ?? '').trim();
    if (client && client === me)
        return 'client';
    const trainer = String(row?.trainer_id ?? '').trim();
    if (trainer && trainer === me)
        return 'trainer';
    return 'stranger';
}
/**
 * May this caller perform this action on this subscription?
 *
 * Anything that is not one of the four known actions is refused. The caller
 * decides which of the two refusals to print: a stranger is told the
 * subscription was not found (confirming an id exists to somebody who has no
 * business with it is itself a leak), while a coach asking for the billing
 * portal is told plainly that it is the client's.
 *
 * There is deliberately no 'refund' here and there never will be. A refund is
 * about a CHARGE, not about a subscription — the two charges a coach can refund
 * live in two different tables under two different keys, neither of which is a
 * subscription id — and it is authorised by supabase/functions/connect-refund
 * against the sale row's own coach. Putting it in this union would put a refund
 * inside the branch that cancels subscriptions, which is exactly the confusion
 * the feature must not create.
 */
function mayAct(row, uid, action) {
    const party = partyOf(row, uid);
    if (party === 'stranger')
        return false;
    // The client's card and invoices. Never the coach's to open. See above.
    if (action === 'portal')
        return party === 'client';
    // 'end_now' stops the subscription TODAY and gives nothing back. Both parties
    // may do it, and the reason it is not the coach's alone is the one that made
    // it worth building: it is the CLIENT who asks to be cancelled today, and an
    // app that can only offer them "it stops in three weeks" is the reason they
    // write the review. A coach doing it to somebody who has paid for the month
    // is taking coaching off them, so `END_NOW_TAKES_THE_REST` in
    // src/lib/refunds.ts is printed in front of whoever taps it, and the money is
    // given back — if it is to be given back — as a separate act.
    return action === 'cancel' || action === 'resume' || action === 'end_now';
}
/**
 * The sentence for a refusal, so the two cases cannot be collapsed into one by
 * accident later. Null when the action is allowed.
 */
function refusalFor(row, uid, action) {
    if (mayAct(row, uid, action))
        return null;
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
/** Charging or about to. Kept identical to `LIVE_STATUSES` in subscriptions.ts
 *  on purpose — the client's Memberships screen filters on that one and must
 *  not start disagreeing with this one about who is subscribed. */
const LIVE = new Set(['trialing', 'active', 'past_due']);
/** Over. Stripe's spellings, and only Stripe's — 'canceled' with one L is the
 *  word the API sends, and inventing aliases here would file states that never
 *  arrive while doing nothing about the ones that do. */
const ENDED = new Set(['canceled', 'incomplete_expired', 'unpaid']);
function subState(status) {
    const s = String(status ?? '').trim().toLowerCase();
    if (LIVE.has(s))
        return 'live';
    if (ENDED.has(s))
        return 'ended';
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
function unsettledNote(status) {
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
function canSwitchCancel(status) {
    return subState(status) === 'live';
}
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
function subChange(before, after) {
    const a = String(before ?? '').trim().toLowerCase();
    const b = String(after ?? '').trim().toLowerCase();
    // No movement is no news. Stripe retries webhooks, and a redelivery rewrites
    // the row with the status it already had; announcing that would tell a coach
    // a client churned twice.
    if (a === b)
        return null;
    if (subState(b) === 'ended' && subState(a) !== 'ended')
        return 'ended';
    if (b === 'past_due')
        return 'failed';
    if (CHARGING.has(b) && NEVER_CHARGED.has(a))
        return 'started';
    return null;
}
