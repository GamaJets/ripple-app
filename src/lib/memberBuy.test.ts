// What a member can buy from their own gym. Compile with tsc, run with node.
//
// Four things are asserted here and each one stands for a way somebody's money
// or somebody's membership goes wrong:
//
//   · `gymCanSell` must agree with `canTakeDirectCharges` on every shape. They
//     are the same rule with different nouns, and the whole point of the gym
//     path being a second caller of that function is that it cannot quietly
//     become a second, laxer rule. If it drifts, a gym starts selling on an
//     account Stripe holds REPPLE liable for.
//
//   · `termEnd` must not hand out or take away days. A month plan bought on the
//     1st runs to the last day of that month, not to the 1st of the next, or
//     every member gets a free day per term and every renewal date drifts. And
//     a month from the 31st is the end of the following month, not a term
//     shortened to make the arithmetic tidy.
//
//   · `renewStart` must never back-date. Selling somebody a term that began
//     before they paid for it charges them for days that are already gone.
//
//   · `supersedeRow` must not produce a membership that ended before it began,
//     and must not leave an 'active' row with a past end date — which
//     `standingOf` reports as `stale`, and the membership screen renders as an
//     alarm about going to reception, over an ordinary upgrade.
//
// The block at the bottom is a mutation check: the obvious wrong versions of
// the term arithmetic must FAIL this file, so a later simplification cannot
// pass it.
//
// Timezones: every date function here parses bare ISO strings and does its
// arithmetic in UTC, and `npm run test:zones` runs this file in Kiritimati
// (UTC+14) and Midway (UTC-11) among others. Nothing below constructs a local
// Date, and nothing asserts on a formatted date string, because the format is
// the reader's locale's business and not this file's.
import {
  gymCanSell, asConnectRow, termEnd, termFrom, addDays, renewStart, supersedeRow,
  offerFor, switchLabel, passNote, orderNote, orderIsLive, isBuyablePass, renewalIsContiguous,
  offerMoney, fetchMyGymOrders, MY_ORDERS_CAP, type GymAccountFacts, type GymPlan,
} from './memberBuy';
import { canTakeDirectCharges } from './directCharges';
import { standingOf, type MemberMembership } from './memberRecord';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ═══════════════════════════════════════════════════════════════════════════
   1. The gym gate is the coach gate
   ═══════════════════════════════════════════════════════════════════════════ */

const SHAPES: GymAccountFacts[] = [];
for (const hasAccount of [true, false]) {
  for (const accountType of [null, 'standard', 'express', 'custom', 'none', 'Standard', ' standard ']) {
    for (const cardPaymentsStatus of [null, 'active', 'pending', 'inactive', '']) {
      for (const chargesEnabled of [true, false]) {
        SHAPES.push({ hasAccount, accountType, cardPaymentsStatus, chargesEnabled });
      }
    }
  }
}
eq(SHAPES.length, 2 * 7 * 5 * 2, 'the shape table is the full cross product');

let agreed = 0;
for (const s of SHAPES) {
  const mine = gymCanSell(s);
  const theirs = canTakeDirectCharges(asConnectRow(s));
  if (mine.ok !== theirs.ok) {
    errors.push(`gymCanSell disagrees with canTakeDirectCharges on ${JSON.stringify(s)} — gym said ${mine.ok}, connect said ${theirs.ok}`);
  } else {
    agreed += 1;
  }
}
eq(agreed, SHAPES.length, 'every account shape gets the same verdict from both gates');

// And the refusals are gym sentences, not coach ones. A member reading "this
// trainer has not finished verifying" while standing in a gym is being told
// about the wrong party.
for (const s of SHAPES) {
  const v = gymCanSell(s);
  if (!v.ok) ok(!/trainer/i.test(v.reason), `a gym refusal must not talk about a trainer: ${v.reason}`);
}

// The one shape that is not a shape: no row at all.
ok(!gymCanSell(null).ok, 'a gym with no Stripe account row cannot sell');
ok(!gymCanSell(undefined).ok, 'an undefined account is not a licence to sell either');
{
  const none = gymCanSell(null);
  ok(!none.ok && /reception/i.test(none.reason), 'and the member is told what they can still do about it');
}

// The happy shape, spelled out so the table above cannot be all-refusals and
// still pass.
ok(gymCanSell({ hasAccount: true, accountType: 'standard', cardPaymentsStatus: 'active', chargesEnabled: true }).ok,
  'a finished Standard account with card payments active can sell');
ok(gymCanSell({ hasAccount: true, accountType: 'standard', cardPaymentsStatus: null, chargesEnabled: true }).ok,
  'a null capability status falls back to charges_enabled rather than blocking every gym');
ok(!gymCanSell({ hasAccount: true, accountType: 'express', cardPaymentsStatus: 'active', chargesEnabled: true }).ok,
  'an Express account is refused however finished it looks');
ok(!gymCanSell({ hasAccount: true, accountType: null, cardPaymentsStatus: 'active', chargesEnabled: true }).ok,
  'an account nobody has asked Stripe about is refused');

/* ═══════════════════════════════════════════════════════════════════════════
   2. A term is exactly as long as it says
   ═══════════════════════════════════════════════════════════════════════════ */

eq(termEnd('2026-10-01', 'month'), '2026-10-31', 'a month from the 1st runs to the last day of that month');
eq(termEnd('2026-10-15', 'month'), '2026-11-14', 'a month from the 15th runs to the 14th of the next');
eq(termEnd('2026-01-31', 'month'), '2026-02-28', 'a month from the 31st of January is the end of February, not a shortened term');
eq(termEnd('2024-01-31', 'month'), '2024-02-29', 'and it is the 29th in a leap year');
eq(termEnd('2026-12-15', 'month'), '2027-01-14', 'a month can cross a year');
eq(termEnd('2026-12-01', 'month'), '2026-12-31', 'December to December');
eq(termEnd('2026-11-30', 'month'), '2026-12-29', 'a month from the 30th of November is the 29th of December');

eq(termEnd('2026-10-01', 'year'), '2027-09-30', 'a year from the 1st of October runs to the 30th of September');
eq(termEnd('2024-02-29', 'year'), '2025-02-28', 'a year from a leap day lands on the 28th, not on a day that does not exist');

eq(termEnd('2026-10-01', 'once'), null, 'a one-off has no end date, which is open-ended and not expired');
eq(termEnd('not a date', 'month'), null, 'an unreadable start buys no term');
eq(termEnd(null, 'month'), null, 'and neither does no start at all');
eq(termEnd('2026-10-1', 'month'), null, 'a date that is not zero-padded is not a date column');

// The shape the order and the membership are both written from.
eq(JSON.stringify(termFrom('2026-10-01', 'month')), JSON.stringify({ startsOn: '2026-10-01', endsOn: '2026-10-31' }), 'termFrom carries both ends');
eq(JSON.stringify(termFrom('2026-10-01', 'once')), JSON.stringify({ startsOn: '2026-10-01', endsOn: null }), 'a one-off term is open-ended');

// Consecutive terms must not overlap and must not leave a gap. Twelve months
// from the 15th, each starting the day after the last one ended.
{
  let start = '2026-01-15';
  let gaps = 0;
  for (let i = 0; i < 12; i++) {
    const end = termEnd(start, 'month');
    ok(end !== null, 'every month in the run has an end');
    const next = addDays(end, 1);
    if (next === null) { gaps += 1; break; }
    start = next;
  }
  eq(gaps, 0, 'a year of back-to-back monthly terms has no gap and no overlap');
  eq(start, '2027-01-15', 'and twelve of them land exactly a year later');
}

eq(addDays('2026-03-01', -1), '2026-02-28', 'a day before the 1st of March is the end of February');
eq(addDays('2024-03-01', -1), '2024-02-29', 'and the 29th in a leap year');
eq(addDays('2026-12-31', 1), '2027-01-01', 'a day after the last of the year crosses it');
eq(addDays(null, 1), null, 'no date in, no date out');

/* ═══════════════════════════════════════════════════════════════════════════
   3. A renewal starts where the last term stopped, and never earlier than today
   ═══════════════════════════════════════════════════════════════════════════ */

const held = (over: Partial<MemberMembership> = {}): MemberMembership => ({
  id: 'm1', tenantId: 't1', startedOn: '2026-09-01', endsOn: '2026-09-30',
  status: 'active', planId: 'p1', plan: null, ...over,
});

eq(renewStart(held(), '2026-09-20'), '2026-10-01', 'a renewal begins the day after the current term ends');
eq(renewStart(held(), '2026-09-30'), '2026-10-01', 'including on the last day of the term, which is still a good day');
eq(renewStart(held(), '2026-10-05'), '2026-10-05', 'a lapsed membership renews from today, not from a date already gone');
eq(renewStart(held({ endsOn: null }), '2026-09-20'), null, 'an open-ended membership has no term to extend and none is invented');
eq(renewStart(held({ endsOn: 'soon' }), '2026-09-20'), null, 'an unreadable end date buys nothing');

// A renewal either carries straight on or it does not, and that decides whether
// fulfilment extends the membership row or writes a second one. Extending it
// across a lapse would leave a row claiming somebody was a member through weeks
// they were not, on the record an attendance dispute is settled against.
ok(renewalIsContiguous('2026-09-30', '2026-10-01'), 'a renewal bought in time carries straight on');
ok(!renewalIsContiguous('2026-09-30', '2026-10-05'), 'a renewal bought after a lapse does not');
ok(!renewalIsContiguous('2026-09-30', '2026-09-30'), 'and a start on the old end date is an overlap, not a continuation');
ok(!renewalIsContiguous(null, '2026-10-01'), 'an open-ended membership has no end to carry on from');
ok(!renewalIsContiguous('rubbish', '2026-10-01'), 'and neither has an unreadable one');
{
  // The two together: renewStart and renewalIsContiguous must agree about the
  // same pair of dates, or fulfilment extends a row it should have replaced.
  const inTime = renewStart(held(), '2026-09-20')!;
  ok(renewalIsContiguous(held().endsOn, inTime), 'renewing in time is contiguous');
  const late = renewStart(held(), '2026-10-05')!;
  ok(!renewalIsContiguous(held().endsOn, late), 'renewing late is not');
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. What an upgrade does to the membership it replaces
   ═══════════════════════════════════════════════════════════════════════════ */

{
  const row = supersedeRow({ startedOn: '2026-09-01' }, '2026-09-20');
  eq(row?.ends_on, '2026-09-19', 'the old term ends the day before the new one starts');
  eq(row?.status, 'expired', 'and it is marked expired rather than cancelled, because nobody cancelled anything');

  // The sentence a member would actually read about it. `stale` is what turns
  // an ordinary upgrade into "check at reception before you travel in".
  const after = standingOf({ status: row!.status, startedOn: '2026-09-01', endsOn: row!.ends_on }, '2026-09-20');
  eq(after.kind, 'expired', 'the superseded membership reads as expired');
  eq((after as { stale: boolean }).stale, false, 'and NOT as a gym that forgot to close it');
}
{
  // Upgrading on the first day of a term. The old membership must not end
  // before it began.
  const row = supersedeRow({ startedOn: '2026-09-20' }, '2026-09-20');
  eq(row?.ends_on, '2026-09-20', 'a same-day upgrade leaves the old term ending on the day it started');
  const after = standingOf({ status: 'expired', startedOn: '2026-09-20', endsOn: row!.ends_on }, '2026-09-20');
  eq(after.kind, 'expired', 'which is still a membership that has ended');
}
eq(supersedeRow({ startedOn: '2026-09-01' }, 'nope'), null, 'an unreadable start date supersedes nothing');

/* ═══════════════════════════════════════════════════════════════════════════
   5. What the button on a plan says
   ═══════════════════════════════════════════════════════════════════════════ */

const plan = (over: Partial<GymPlan> = {}): GymPlan => ({
  id: 'p1', name: 'Full Access', priceCents: 20000, currency: 'AED', interval: 'month', ...over,
});
const TODAY = '2026-09-20';
const standing = (m: MemberMembership) => standingOf(m, TODAY);

{
  const o = offerFor(plan(), null, null, TODAY);
  eq(o.kind, 'buy', 'somebody with no membership is buying one');
  eq(o.label, 'Buy This Plan', 'and the button says so in Title Case');
  eq(o.startsOn, TODAY, 'starting today');
  eq(o.endsOn, '2026-10-19', 'and running a month');
}
{
  const m = held();
  const o = offerFor(plan(), m, standing(m), TODAY);
  eq(o.kind, 'renew', 'the plan they are on is a renewal');
  eq(o.startsOn, '2026-10-01', 'beginning when the current term ends');
  eq(o.endsOn, '2026-10-31', 'and running a month from there');
}
{
  const m = held();
  const o = offerFor(plan({ id: 'p2', priceCents: 30000 }), m, standing(m), TODAY);
  eq(o.kind, 'upgrade', 'a different plan takes over from the one they hold');
  eq(o.startsOn, TODAY, 'starting today, because they are moving now');
  ok(o.note.includes('ends the day before'), 'and the note says what happens to the old one');
}
{
  const m = held({ endsOn: null });
  const o = offerFor(plan(), m, standing(m), TODAY);
  eq(o.kind, 'held', 'an open-ended membership on this plan has nothing to renew');
  eq(o.label, null, 'so there is no button');
  ok(o.note.includes('has not recorded an end date'), 'and the reason is stated rather than left blank');
}
{
  const m = held({ status: 'frozen' });
  const o = offerFor(plan(), m, standing(m), TODAY);
  eq(o.kind, 'blocked', 'nothing is sold against a frozen membership');
  eq(o.label, null, 'and no button is drawn over it');
}
{
  const m = held({ startedOn: '2026-12-01', endsOn: '2026-12-31' });
  const o = offerFor(plan(), m, standing(m), TODAY);
  eq(o.kind, 'blocked', 'a membership that has not started yet is not renewed early');
}
{
  const m = held({ endsOn: '2026-08-31' });
  const o = offerFor(plan(), m, standing(m), TODAY);
  eq(o.kind, 'buy', 'an expired membership is a fresh purchase, not a renewal');
  eq(o.startsOn, TODAY, 'and it starts today rather than back where the last one stopped');
}
{
  const m = held({ status: 'cancelled' });
  const o = offerFor(plan(), m, standing(m), TODAY);
  eq(o.kind, 'buy', 'a cancelled membership is a fresh purchase too');
}
{
  const o = offerFor(plan({ interval: 'once' }), null, null, TODAY);
  eq(o.endsOn, null, 'a one-off plan has no end date');
  ok(o.note.includes('does not renew'), 'and it says so');
}

// The word "upgrade" is only used where it is true.
eq(switchLabel({ priceCents: 20000, currency: 'AED' }, plan({ id: 'p2', priceCents: 30000 })), 'Upgrade to This Plan', 'a dearer plan in the same currency is an upgrade');
eq(switchLabel({ priceCents: 30000, currency: 'AED' }, plan({ id: 'p2', priceCents: 20000 })), 'Switch to This Plan', 'a cheaper one is not');
eq(switchLabel({ priceCents: 20000, currency: 'GBP' }, plan({ id: 'p2', priceCents: 30000 })), 'Switch to This Plan', 'and two currencies cannot be compared at all');
eq(switchLabel({ priceCents: 20000, currency: null }, plan({ id: 'p2', priceCents: 30000 })), 'Switch to This Plan', 'nor can one with no currency recorded');
eq(switchLabel(null, plan()), 'Switch to This Plan', 'and a plan we could not read is not evidence of anything');

/* ═══════════════════════════════════════════════════════════════════════════
   6. Passes, orders and money
   ═══════════════════════════════════════════════════════════════════════════ */

ok(isBuyablePass('drop_in'), 'a drop-in can be bought in the app');
ok(isBuyablePass('pack'), 'so can a class pack');
ok(!isBuyablePass('guest'), 'a guest pass cannot: there is no screen that collects the guest');
ok(!isBuyablePass(null), 'and neither can a kind we could not read');

{
  const n = passNote({ id: 'x', name: 'Ten Classes', kind: 'pack', priceCents: 50000, currency: 'AED', uses: 10, validDays: 90 }, '2026-09-20');
  ok(n.startsWith('10 visits.'), 'a pack says how many visits it is worth, because the name rarely does');
  ok(n.includes('Valid until'), 'and when it stops being usable');
}
{
  const n = passNote({ id: 'x', name: 'Day Pass', kind: 'drop_in', priceCents: 5000, currency: 'AED', uses: 1, validDays: null }, '2026-09-20');
  ok(n.startsWith('One visit.'), 'one visit is said in words, not as the digit 1');
  ok(n.includes('does not expire'), 'and a pass with no expiry says that rather than showing a blank');
}

eq(orderNote({ status: 'paid', kind: 'membership' }), null, 'a paid order needs no sentence: the membership it made is on screen');
ok(orderNote({ status: 'pending', kind: 'membership' })!.includes('not confirmed'), 'a pending order says Stripe has not confirmed it');
ok(orderNote({ status: 'abandoned', kind: 'pass' })!.includes('nothing was charged'), 'an abandoned order says plainly that no money moved');
{
  const f = orderNote({ status: 'failed', kind: 'membership' })!;
  ok(f.includes('went through'), 'a failed order admits the money went through');
  ok(f.includes('reception'), 'and tells the member who can put it right');
}
ok(orderIsLive({ status: 'pending' }), 'a pending order is worth showing');
ok(orderIsLive({ status: 'failed' }), 'and a failed one especially');
ok(!orderIsLive({ status: 'paid' }), 'a paid one is represented by what it bought');
ok(!orderIsLive({ status: 'abandoned' }), 'and an abandoned one is clutter');

// Money never states a currency nobody chose, and never divides a currency that
// has no minor unit.
eq(offerMoney(20000, 'AED'), 'AED 200.00', 'a two-decimal currency is divided by a hundred');
eq(offerMoney(5000, 'JPY'), 'JPY 5,000', 'a yen amount is not divided at all');
eq(offerMoney(20000, null), null, 'an amount with no currency is withheld, not guessed');
eq(offerMoney(20000, ''), null, 'and an empty currency is the same fact as a null one');
eq(offerMoney(null, 'AED'), null, 'an amount nobody established is withheld too');

/* ═══════════════════════════════════════════════════════════════════════════
   The wrong versions must fail here
   ═══════════════════════════════════════════════════════════════════════════ */

{
  // Wrong: end the term on the same day of the next month. Every member gets a
  // free day per term and every renewal date drifts forward.
  const wrong = (start: string) => {
    const [y, m, d] = start.split('-').map(Number);
    return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  };
  ok(wrong('2026-10-01') !== termEnd('2026-10-01', 'month'), 'ending a month term on the same date next month must fail this file');
}
{
  // Wrong: add thirty days and call it a month. February is short and the
  // renewal date walks backwards through the year.
  const wrong = (start: string) => addDays(start, 29);
  ok(wrong('2026-01-01') !== termEnd('2026-01-01', 'month'), 'a fixed thirty-day month must fail this file');
}
{
  // Wrong: clamp the day AND subtract one, which takes a day off a term for the
  // arithmetic's convenience. 31 January would run to 27 February.
  const wrong = () => '2026-02-27';
  ok(wrong() !== termEnd('2026-01-31', 'month'), 'shortening a term to make the clamp tidy must fail this file');
}
{
  // Wrong: renew from the day after the old term whatever the date. A member
  // renewing three months late would be sold a term that ended before they paid.
  const wrong = (m: MemberMembership) => addDays(m.endsOn, 1);
  ok(wrong(held()) !== renewStart(held(), '2026-10-05'), 'back-dating a renewal must fail this file');
}
{
  // Wrong: leave the superseded membership 'active' with a past end date, which
  // standingOf reports as stale and the screen renders as an alarm.
  const after = standingOf({ status: 'active', startedOn: '2026-09-01', endsOn: '2026-09-19' }, '2026-09-20');
  ok((after as { stale: boolean }).stale === true, 'an active row past its end date really is reported stale');
  ok(String(supersedeRow({ startedOn: '2026-09-01' }, '2026-09-20')!.status) !== 'active', 'so leaving an upgraded membership active must fail this file');
}

/* ── the fifty-first order ─────────────────────────────────────────────────
 *
 * This list feeds "Waiting On Stripe" — the one screen in the app that tells
 * somebody their card was charged and nothing was granted. A window of fifty
 * with no flag meant a drop-in buyer's older stuck order fell silently outside
 * it while the header printed a confident count over what was left.
 */
{
  // The smallest thing shaped like the query chain: whatever `.limit()` is
  // asked for is what comes back, so the assertion is about the probe row.
  const sbWith = (rowCount: number) => {
    let asked = -1;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: (n: number) => {
        asked = n;
        return Promise.resolve({
          data: Array.from({ length: Math.min(rowCount, n) }, (_, i) => ({
            id: `o${i}`, kind: 'pass', intent: 'new', status: 'pending',
            amount_cents: 1000, currency: 'GBP', created_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
          })),
          error: null,
        });
      },
    };
    return { sb: { from: () => chain, rpc: () => Promise.resolve({ data: null, error: null }), functions: { invoke: async () => ({ data: null, error: null }) } } as any, askedFor: () => asked };
  };

  void (async () => {
    // One more than the window is asked for, or a full page and a truncated one
    // look identical — the whole argument of src/lib/rowCap.ts.
    const under = sbWith(3);
    const a = await fetchMyGymOrders(under.sb, 'me');
    ok(a.ok, 'a read that landed is ok');
    if (a.ok) {
      eq(a.value.orders.length, 3, 'a member with three orders gets three');
      eq(a.value.truncated, false, 'and is not told anything is missing');
    }
    eq(under.askedFor(), MY_ORDERS_CAP + 1, 'the query asks for one past the window, as a probe');

    const exact = await fetchMyGymOrders(sbWith(MY_ORDERS_CAP).sb, 'me');
    if (exact.ok) {
      eq(exact.value.orders.length, MY_ORDERS_CAP, 'exactly a window-full is a window-full');
      eq(exact.value.truncated, false, 'and a set that is exactly the window is not truncated');
    }

    const over = await fetchMyGymOrders(sbWith(MY_ORDERS_CAP + 1).sb, 'me');
    ok(over.ok, 'a truncated read still landed — it is not a failure');
    if (over.ok) {
      // The probe row is not data and must not reach the screen.
      eq(over.value.orders.length, MY_ORDERS_CAP, 'the probe row is not shown');
      eq(over.value.truncated, true, 'and the member is told there are more');
    }

    const out = await fetchMyGymOrders(sbWith(3).sb, '');
    eq(out.ok, false, 'nobody signed in is a refusal, not an empty list');

    // The one exit point. Everything above this file is synchronous and has
    // already run; this block is the last thing, so the whole file's result is
    // reported here rather than twice.
    if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
    console.log('memberBuy: ok');
  })();
}
