// The rule that decides who can stop somebody's recurring card payment.
// Compile with tsc, run with node.
//
// These assertions are the whole security boundary of the cancel/resume actions
// in `connect-checkout`: that function runs as the service role, RLS does not
// apply to it, and so nothing else in the system stops one coach acting on
// another coach's subscriptions. If this file passes and the rule is wrong,
// money moves for the wrong people.
//
// The block at the bottom is a mutation check. It asserts that each of the
// obvious wrong versions of the rule — matching on nulls, dropping the party
// test, letting a coach open a client's billing portal — actually FAILS here,
// so that a future simplification of `partyOf` cannot pass this file.
import {
  partyOf, mayAct, refusalFor, subState, unsettledNote, canSwitchCancel, subChange,
  type SubChange,
} from './subscriptionScope';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const CLIENT = '11111111-1111-1111-1111-111111111111';
const COACH = '22222222-2222-2222-2222-222222222222';
const OTHER_COACH = '33333333-3333-3333-3333-333333333333';
const OWNER = '44444444-4444-4444-4444-444444444444';

const row = { client_id: CLIENT, trainer_id: COACH };

// ── which side of the subscription somebody is on ───────────────────────────
eq(partyOf(row, CLIENT), 'client', 'the person paying is the client');
eq(partyOf(row, COACH), 'trainer', 'the person being paid is the trainer');
eq(partyOf(row, OTHER_COACH), 'stranger', 'another coach is a stranger to this row');
eq(partyOf(row, OWNER), 'stranger', 'the gym owner may read this row but is not a party to it');

// A null side matches nobody. Both columns are ON DELETE SET NULL against
// profiles, so orphaned rows are a real state of this table — and `null ===
// null` would have handed every one of them to every caller with no uid.
eq(partyOf({ client_id: null, trainer_id: null }, CLIENT), 'stranger', 'an orphaned row belongs to nobody');
eq(partyOf({ client_id: null, trainer_id: null }, null), 'stranger', 'a null uid does not match a null column');
eq(partyOf({ client_id: null, trainer_id: null }, ''), 'stranger', 'an empty uid does not match an empty column');
eq(partyOf({ client_id: '', trainer_id: '' }, ''), 'stranger', 'two empty strings are not a match either');
eq(partyOf({ client_id: null, trainer_id: COACH }, COACH), 'trainer', 'a missing client does not stop the coach being the coach');
eq(partyOf(null, COACH), 'stranger', 'no row at all is not somebody’s subscription');
eq(partyOf(undefined, COACH), 'stranger', 'an undefined row is not somebody’s subscription');

// Whitespace either side is the same identity, not a different one.
eq(partyOf({ client_id: ' ' + CLIENT + ' ', trainer_id: COACH }, CLIENT), 'client', 'padding is not part of an id');

// A coach who subscribed to their own package is the client of that row — the
// more permissive reading, and the one that leaves their own portal reachable.
eq(partyOf({ client_id: COACH, trainer_id: COACH }, COACH), 'client', 'a coach subscribed to themselves is the client');

// ── who may stop and restart a charge ───────────────────────────────────────
eq(mayAct(row, CLIENT, 'cancel'), true, 'a client may stop their own subscription');
eq(mayAct(row, CLIENT, 'resume'), true, 'a client may put their own subscription back');
eq(mayAct(row, COACH, 'cancel'), true, 'a coach may stop their own client’s subscription');
eq(mayAct(row, COACH, 'resume'), true, 'a coach may put back one they stopped');

// The assertion this whole file is for.
eq(mayAct(row, OTHER_COACH, 'cancel'), false, 'another coach may NOT cancel this subscription');
eq(mayAct(row, OTHER_COACH, 'resume'), false, 'another coach may NOT resume this subscription');
eq(mayAct(row, OWNER, 'cancel'), false, 'the gym owner may read the row but may not cancel it');
eq(mayAct(row, null, 'cancel'), false, 'an unauthenticated caller may not cancel anything');
eq(mayAct({ client_id: null, trainer_id: null }, null, 'cancel'), false, 'an orphaned row is not cancellable by a nobody');

// ── the billing portal is the client's alone ────────────────────────────────
eq(mayAct(row, CLIENT, 'portal'), true, 'a client may open their own billing portal');
eq(mayAct(row, COACH, 'portal'), false, 'a coach may NOT open their client’s card, invoices and receipts');
eq(mayAct(row, OTHER_COACH, 'portal'), false, 'a stranger may not open anybody’s billing portal');

// Ending it TODAY. Both parties, and the reason it is not the coach's alone is
// the one that made it worth building: it is the CLIENT who asks to be
// cancelled today, and an app that can only offer them "it stops in three
// weeks" is the reason they write the review.
eq(mayAct(row, CLIENT, 'end_now'), true, 'a client may end their own subscription today');
eq(mayAct(row, COACH, 'end_now'), true, 'and so may their coach');
eq(mayAct(row, OTHER_COACH, 'end_now'), false, 'a stranger may not end anybody’s subscription');

// An action nobody has written is refused rather than allowed by default.
// 'refund' is deliberately one of those and will stay one: a refund is about a
// CHARGE, not a subscription, it is authorised in
// supabase/functions/connect-refund against the sale row's own coach, and
// putting it here would put a refund inside the branch that cancels
// subscriptions.
eq(mayAct(row, COACH, 'refund'), false, 'a refund is not a subscription action, for the coach');
eq(mayAct(row, CLIENT, 'refund'), false, 'nor for the client');
eq(mayAct(row, COACH, 'delete'), false, 'and an action nobody has written is refused rather than allowed by default');
eq(mayAct(row, COACH, ''), false, 'an empty action is refused');

// ── what each refusal says ──────────────────────────────────────────────────
eq(refusalFor(row, COACH, 'cancel'), null, 'an allowed action has no refusal');
eq(refusalFor(row, CLIENT, 'portal'), null, 'the client’s own portal has no refusal');

const strangerRefusal = refusalFor(row, OTHER_COACH, 'cancel');
eq(strangerRefusal?.status, 404, 'a stranger is told the subscription was not found');
ok(!/portal|client’s|permission/i.test(strangerRefusal?.error ?? ''),
  'a stranger is told nothing about the row, not even that it exists');

const coachPortalRefusal = refusalFor(row, COACH, 'portal');
eq(coachPortalRefusal?.status, 403, 'a coach asking for the portal is refused, not told it is missing');
ok(/client/i.test(coachPortalRefusal?.error ?? ''), 'and is told whose it is');

// ── what state a subscription is in ─────────────────────────────────────────
eq(subState('active'), 'live', 'active is charging');
eq(subState('trialing'), 'live', 'a trial is about to charge');
eq(subState('past_due'), 'live', 'a failed card has not ended the subscription');
eq(subState('canceled'), 'ended', 'Stripe’s spelling of cancelled is over');
eq(subState('incomplete_expired'), 'ended', 'a first payment that never cleared is over');
eq(subState('unpaid'), 'ended', 'unpaid is over');

// The bucket this split exists for. Each of these used to vanish from the
// coach's Subscribers list entirely, leaving "Nobody is subscribed yet" on a
// screen that was holding the row.
eq(subState('incomplete'), 'unsettled', 'a first payment still in flight is neither');
eq(subState('paused'), 'unsettled', 'paused is neither charging nor finished');
eq(subState('some_status_stripe_adds_in_2027'), 'unsettled', 'a word Stripe invents later is shown, not filed as over');
eq(subState(''), 'unsettled', 'no status at all is not a finished subscription');
eq(subState(null), 'unsettled', 'a null status is not a finished subscription');
eq(subState('ACTIVE'), 'live', 'case is not a different status');
eq(subState('  active '), 'live', 'padding is not a different status');

// ── the sentence for each of those ──────────────────────────────────────────
ok(unsettledNote('paused').length > 20, 'paused has a sentence of its own');
ok(unsettledNote('incomplete').includes('has not gone through'), 'incomplete says the money has not moved');
ok(unsettledNote('wobbly').includes('wobbly'), 'an unknown status is quoted back rather than paraphrased away');
ok(!unsettledNote('wobbly').toLowerCase().includes('cancelled'), 'an unknown status is never described as cancelled');
ok(unsettledNote('').length > 20, 'a missing status still gets a sentence');

// ── where the controls appear ───────────────────────────────────────────────
eq(canSwitchCancel('active'), true, 'a running subscription can be stopped');
eq(canSwitchCancel('past_due'), true, 'a subscription with a failed card can still be stopped');
eq(canSwitchCancel('canceled'), false, 'a finished subscription offers no stop button');
eq(canSwitchCancel('paused'), false, 'a state we cannot place offers no button that would only error');

// ── mutation check: the wrong versions of this rule must fail here ──────────
//
// Each function below is a plausible simplification of `partyOf`/`mayAct`. If
// any of them satisfies every assertion above, then those assertions are not
// actually pinning the rule down and this file is decoration.
type Rule = (r: SubscriptionParties, uid: string | null, action: string) => boolean;
type SubscriptionParties = { client_id?: string | null; trainer_id?: string | null };

const mutants: { name: string; rule: Rule }[] = [
  {
    // The bug this whole task started from, in reverse: scope to the client
    // only, and a coach can never act.
    name: 'client only',
    rule: (r, uid) => !!uid && r.client_id === uid,
  },
  {
    // Raw equality with no emptiness test: an orphaned row (both columns null)
    // matches an unauthenticated caller.
    name: 'raw equality, nulls included',
    rule: (r, uid) => r.client_id === uid || r.trainer_id === uid,
  },
  {
    // Ownership dropped entirely — a signed-in stranger with an id.
    name: 'any signed-in caller',
    rule: (_r, uid) => !!uid,
  },
  {
    // Parties right, but the portal widened to the coach.
    name: 'portal opened to the coach',
    rule: (r, uid) => {
      const me = String(uid ?? '').trim();
      if (!me) return false;
      return (!!r.client_id && r.client_id === me) || (!!r.trainer_id && r.trainer_id === me);
    },
  },
  {
    // Every action allowed, including ones nobody wrote.
    name: 'unknown actions allowed',
    rule: (r, uid, action) => {
      const me = String(uid ?? '').trim();
      if (!me) return false;
      const party = (!!r.client_id && r.client_id === me) ? 'client' : (!!r.trainer_id && r.trainer_id === me) ? 'trainer' : 'stranger';
      if (party === 'stranger') return false;
      return action === 'portal' ? party === 'client' : true;
    },
  },
];

/** Every (row, caller, action) the assertions above cover, as data, so a mutant
 *  can be run against exactly the same set the real rule was. */
const cases: { r: SubscriptionParties; uid: string | null; action: string }[] = [];
for (const r of [row, { client_id: null, trainer_id: null }, { client_id: null, trainer_id: COACH }]) {
  for (const uid of [CLIENT, COACH, OTHER_COACH, OWNER, null, '']) {
    for (const action of ['cancel', 'resume', 'portal', 'end_now', 'refund', '']) {
      cases.push({ r, uid, action });
    }
  }
}

for (const m of mutants) {
  const agrees = cases.every((c) => m.rule(c.r, c.uid, c.action) === mayAct(c.r, c.uid, c.action));
  ok(!agrees, `mutation "${m.name}" is indistinguishable from the real rule — the assertions above do not pin it down`);
}

/* ── what a coach is told about a subscription ─────────────────────────────
 *
 * These assertions are the ONLY proof this rule is right. The rule itself runs
 * in a database trigger (supabase/parts/158), fired by a Stripe webhook that
 * this repository's test suite cannot reach and that nobody can run locally —
 * so if the truth table below is wrong, the first evidence will be a coach
 * being told a client churned who did not.
 *
 * Stated as (before, after) → what the coach is told, one line per transition,
 * with Stripe's own spellings.
 */
{
  const table: [string, string, SubChange | null][] = [
    // A signup. The row is inserted with no previous status at all; Stripe then
    // writes 'incomplete' → 'active' for a card that needs confirming, and
    // straight to 'active' or 'trialing' for one that does not.
    ['', 'active', 'started'],
    ['', 'trialing', 'started'],
    ['incomplete', 'active', 'started'],
    ['incomplete', 'trialing', 'started'],
    // ONE notification for one signup. The insert that lands on 'incomplete' is
    // not news — nothing has been charged and Stripe may still expire it — so
    // the coach hears about this subscriber once, when it starts charging.
    ['', 'incomplete', null],
    // A trial converting is not a second signup: it was already charging in the
    // sense that matters, and the coach was told when it began.
    ['trialing', 'active', null],

    // A card that failed. Still inside the live band — nothing has ended — and
    // it is the one of the three a coach can do something about today.
    ['active', 'past_due', 'failed'],
    ['trialing', 'past_due', 'failed'],

    // A retry that worked. The whole reason 'started' is keyed on the BAND and
    // not on the word: this is a recovery, and reporting it as a new subscriber
    // would tell a coach they had gained someone they never lost.
    ['past_due', 'active', null],

    // Over, in each of Stripe's three spellings for over.
    ['active', 'canceled', 'ended'],
    ['past_due', 'unpaid', 'ended'],
    ['incomplete', 'incomplete_expired', 'ended'],
    // Already over. A subscription that moves between two ended states has not
    // ended twice, and 'canceled' arriving after 'unpaid' is an ordinary
    // out-of-order webhook.
    ['unpaid', 'canceled', null],

    // A redelivered webhook rewrites the row with the status it already had.
    // Stripe retries; a retry is not a second event.
    ['active', 'active', null],
    ['canceled', 'canceled', null],
    ['', '', null],

    // 'paused', and any word Stripe invents after this was written. Neither
    // charging nor finished, and there is no sentence a coach could act on —
    // the Payments screen shows the row and quotes the word back instead.
    ['active', 'paused', null],
    // A pause resuming is not a signup. The coach already had this subscriber,
    // and 'started' is keyed on having NEVER charged for exactly this row.
    ['paused', 'active', null],
    ['active', 'something_new', null],
    // And a word we do not recognise resolving to 'active' could be either a
    // resume or a first payment. Neither is claimed.
    ['something_new', 'active', null],
  ];
  for (const [before, after, want] of table) {
    eq(subChange(before, after), want, `“${before || '(new row)'}” → “${after}”`);
  }

  // Case and whitespace come off a webhook payload and out of a text column,
  // and 'Active' must not read as a different word from 'active' — that would
  // report a status change on a redelivery.
  eq(subChange(' ACTIVE ', 'active'), null, 'the same status in another case is not a change');
  eq(subChange(null, 'active'), 'started', 'a null previous status is a new row');
  eq(subChange('active', null), null, 'a status that vanished is not an ending we can claim');
  eq(subChange(undefined, undefined), null, 'nothing known either side says nothing');

  // The three are mutually exclusive by construction — every transition above
  // yields at most one — and the coach is never told two things about one write.
  const kinds = new Set(table.map(([b, a]) => subChange(b, a)).filter(Boolean));
  eq(kinds.size, 3, 'the table exercises all three kinds and no fourth');
}


if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`subscriptionScope: ok (${cases.length} scope cases, ${mutants.length} mutations rejected)`);
