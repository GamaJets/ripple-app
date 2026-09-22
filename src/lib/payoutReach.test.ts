// Whether the money reaches the coach. Compile with tsc, run with node.
//
// The assertion this file exists for is the first group: `payouts_enabled`
// null must not resolve to either answer. Read as false it tells every coach
// whose `account.updated` webhook has not fired that Stripe will not pay them;
// read as true it is the bug this module was written to end — a screen saying
// "Payouts active" over an account Stripe is holding the balance on.
import {
  payoutReach, transferState, payoutHeading, payoutNote, transferNote, payoutsSettled,
  type PayoutCapability,
} from './payoutReach';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const acct = (p: PayoutCapability = {}): PayoutCapability => p;

/* ── null is neither answer ────────────────────────────────────────────── */

eq(payoutReach(acct({})), 'unrecorded',
  'a row with no payout column is not a refusal — part 161 applied or not, absence is absence');
eq(payoutReach(acct({ payouts_enabled: null })), 'unrecorded',
  'and an explicit null is the webhook not having fired, not a No');
eq(payoutReach(null), 'unrecorded', 'and no row at all says nothing about payouts');
eq(payoutsSettled('unrecorded'), false,
  'nothing unrecorded may be drawn as settled — that is the whole defect');
eq(payoutsSettled('held'), false, 'and a held account certainly may not');
eq(payoutsSettled('reaching'), true, 'only Stripe’s own yes is a yes');

/* ── the two answers Stripe does give ──────────────────────────────────── */

eq(payoutReach(acct({ payouts_enabled: true })), 'reaching', 'true is true');
eq(payoutReach(acct({ payouts_enabled: false })), 'held', 'and false is held, not merely unknown');

// The heading is the sentence the backlog item names. An account taking cards
// with payouts off must not be headed "Payouts active".
eq(payoutHeading('reaching'), 'Payouts active', 'the only state that heading is true of');
ok(payoutHeading('held').includes('Card payments yes'),
  'a held account leads with the half that is working');
ok(payoutHeading('held').includes('payouts not yet'),
  'and says plainly that the payouts half is not');
ok(!payoutHeading('held').toLowerCase().includes('payouts active'),
  'and never carries the sentence that was wrong');
ok(!payoutHeading('unrecorded').toLowerCase().includes('payouts'),
  'an unrecorded account claims nothing about payouts in its heading either');

ok(payoutNote('held').includes('Nothing is lost'),
  'and the coach is told the money is not gone, because that is the fear');
ok(payoutNote('held').includes('Stripe onboarding'),
  'and where the outstanding thing is listed, rather than being left to guess');
ok(payoutNote('unrecorded').includes('not a No'),
  'an unrecorded payout state is explicitly not reported as a refusal');
ok(payoutNote('reaching').includes('paying your balance out'),
  'and the working case says what is actually happening');

/* ── transfers: the other hop, kept apart ──────────────────────────────── */

eq(transferState(acct({ transfers_status: 'active' })), 'active', 'active is the one yes');
eq(transferState(acct({ transfers_status: 'ACTIVE ' })), 'active', 'trimmed and folded');
eq(transferState(acct({ transfers_status: 'pending' })), 'not_active', 'pending is not a yes');
eq(transferState(acct({ transfers_status: 'inactive' })), 'not_active', 'nor is inactive');
eq(transferState(acct({ transfers_status: 'unrequested' })), 'not_active', 'nor unrequested');
eq(transferState(acct({ transfers_status: null })), 'unrecorded', 'and null is unrecorded');
eq(transferState(acct({})), 'unrecorded', 'as is an absent column');
eq(transferState(acct({ transfers_status: '   ' })), 'unrecorded', 'a blank states nothing');

eq(transferNote('active', 'active'), null, 'nothing is said about a capability that works');
eq(transferNote('unrecorded', null), null,
  'and an unrecorded capability is not a second paragraph of the same hedge');

{
  const note = transferNote('not_active', 'pending');
  ok((note ?? '').includes('pending'),
    'Stripe’s own word is quoted back, because that is what their dashboard and their support will say');
  ok((note ?? '').includes('passes a client payment on to you'),
    'and the note says which hop this actually blocks');
}

ok((transferNote('not_active', null) ?? '').includes('not activated transfers'),
  'a not-active capability with no word on it still says what is wrong');
ok(!(transferNote('not_active', null) ?? '').includes('“”'),
  'and does not quote an empty string at somebody');

/* ── the two facts never collapse into one ─────────────────────────────── */

{
  // Payouts fine, transfers not. Real: a destination-charge account mid-way
  // through having its capabilities granted.
  const a = acct({ payouts_enabled: true, transfers_status: 'pending' });
  eq(payoutReach(a), 'reaching', 'a transfers problem does not take away a payout yes');
  eq(transferState(a), 'not_active', 'and is reported on its own line');
}

{
  // Transfers fine, payouts held. Also real, and the opposite remedy.
  const a = acct({ payouts_enabled: false, transfers_status: 'active' });
  eq(payoutReach(a), 'held', 'a working transfers capability does not turn payouts on');
  eq(transferNote(transferState(a), a.transfers_status), null,
    'and nothing is invented to say about the half that works');
}

if (errors.length) { for (const e of errors) console.error('FAIL', e); process.exit(1); }
console.log('payoutReach: ok');
