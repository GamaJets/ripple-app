// Adding dirhams to pounds is not a sum. Compile with tsc, run with node.
//
// `summarise()` adds `amountCents` across payments and `priceCents` across the
// plans behind active memberships, and for a long time it ignored what currency
// each of those rows stated. That was invisible while every gym was in the UAE
// and is a wrong number the moment one is not: `gym_payments.currency` and
// `membership_plans.currency` are both `not null default 'AED'`, so every row
// written before those write paths demanded a currency is a dirham row. A
// London gym that has since set GBP had those dirhams added to its pounds, and
// the two console screens that show the result — the Overview and Plans &
// payments, the first two figures an owner reads — labelled it GBP.
//
// There is no fixing that inside the sum: converting needs a rate nobody has.
// So the sum REPORTS the currency it can honestly claim and reports null when
// the contributing rows do not agree, and the screens withhold the figure and
// say why. These assertions are what stop the report drifting back to a guess.
import { summarise, sharedCurrency, money, type GymPayment, type Membership, type MembershipPlan } from './gymRecord';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── sharedCurrency: the rule, on its own ──────────────────────────────── */

eq(sharedCurrency([]), null, 'an empty set states no currency');
eq(sharedCurrency([{ currency: 'GBP' }]), 'GBP', 'one row states its own');
eq(sharedCurrency([{ currency: 'GBP' }, { currency: 'GBP' }]), 'GBP', 'rows that agree state it');
eq(sharedCurrency([{ currency: 'GBP' }, { currency: 'AED' }]), null,
  'rows that disagree state nothing — this is the legacy-dirham case');
// The one that matters most, and the one an "ignore the nulls" implementation
// gets wrong: a row with no currency is SILENT, and silence is not agreement.
// Reading it as consent is how a single unpriced row lets a whole set be
// labelled with whatever the others happen to say.
eq(sharedCurrency([{ currency: 'GBP' }, { currency: null }]), null,
  'a row stating no currency does not agree with one that does');
eq(sharedCurrency([{ currency: null }, { currency: null }]), null,
  'rows that all state nothing state nothing, not a shared null to print with');
eq(sharedCurrency([{}, {}]), null, 'an absent currency field is the same silence as a null one');
// Order must not decide anything. `rows[0].currency` was the implementation
// this replaces, and reversing the set was enough to change the answer.
eq(sharedCurrency([{ currency: 'AED' }, { currency: 'GBP' }]),
   sharedCurrency([{ currency: 'GBP' }, { currency: 'AED' }]),
   'the answer does not depend on which row sorted first');

/* ── the two sums, and what they claim to be in ────────────────────────── */

const pay = (cents: number, currency: string): GymPayment => ({
  id: `p${cents}${currency}`, memberId: null, memberName: null,
  amountCents: cents, currency, method: 'card',
  takenAt: '2026-08-01T00:00:00Z', note: null,
});

const plan = (id: string, priceCents: number, currency: string,
              interval: 'month' | 'year' | 'once' = 'month'): MembershipPlan => ({
  id, name: id, priceCents, currency, interval, active: true,
});

const member = (id: string, planId: string | null): Membership => ({
  id, memberId: `m-${id}`, memberName: null, planId, planName: null,
  status: 'active', startedOn: '2026-01-01', endsOn: null,
});

{
  // The happy case: one currency throughout, and the sum may name it.
  const s = summarise(
    [pay(5000, 'GBP'), pay(2500, 'GBP')],
    [member('a', 'p1'), member('b', 'p1')],
    [plan('p1', 4000, 'GBP')],
  );
  eq(s.takenCents, 7500, 'the total is still the total');
  eq(s.takenCurrency, 'GBP', 'and it says what money it is in');
  eq(s.mrrCents, 8000, 'two monthly memberships on a 40.00 plan');
  eq(s.mrrCurrency, 'GBP', 'priced in the plan’s own currency');
  eq(money(s.takenCents, s.takenCurrency), 'GBP 75.00', 'and renders');
}

{
  // The defect itself: one legacy dirham payment among the pounds. The total is
  // still returned — it is what the rows add to — but nothing may print it.
  const s = summarise(
    [pay(5000, 'GBP'), pay(2500, 'AED')],
    [member('a', 'p1')],
    [plan('p1', 4000, 'GBP')],
  );
  eq(s.takenCents, 7500, 'the arithmetic is unchanged; only the claim about it is');
  eq(s.takenCurrency, null, 'a mixed set of payments is in no one currency');
  eq(money(s.takenCents, s.takenCurrency), null,
    'so money() withholds it rather than labelling dirhams-plus-pounds as pounds');
  // The two sums are judged separately: the plans still agree, so the recurring
  // figure is not withheld because the till was mixed.
  eq(s.mrrCurrency, 'GBP', 'a mixed till does not withhold the recurring figure');
}

{
  // Plans disagreeing, payments fine — the mirror of the above.
  const s = summarise(
    [pay(5000, 'GBP')],
    [member('a', 'p1'), member('b', 'p2')],
    [plan('p1', 4000, 'GBP'), plan('p2', 3000, 'EUR')],
  );
  eq(s.takenCurrency, 'GBP', 'the till is still one currency');
  eq(s.mrrCurrency, null, 'two plans in two currencies have no one monthly total');
  eq(s.mrrCents, 7000, 'the number is reported; printing it is what is refused');
}

{
  // An empty set states nothing to disagree with. This has to stay distinct
  // from "the rows disagree", because the caller falls back to the gym's own
  // tenants.currency in the first case and must withhold in the second.
  const s = summarise([], [], []);
  eq(s.takenCents, null, 'no payments recorded is not zero taken');
  eq(s.takenCurrency, null, 'and no rows state a currency');
  eq(s.payments, 0, 'the row count is what tells the two apart');
  eq(s.mrrCents, null, 'no priced membership is not zero recurring');
}

{
  // A `once` plan is in the price book and contributes nothing to a MONTHLY
  // figure, so its currency must not be allowed to withhold one. This is the
  // reason the currency is asked of the contributing plans rather than of every
  // plan handed in.
  const s = summarise(
    [],
    [member('a', 'p1'), member('b', 'p2')],
    [plan('p1', 4000, 'GBP'), plan('p2', 9900, 'AED', 'once')],
  );
  eq(s.mrrCents, 4000, 'the day pass adds nothing to the monthly figure');
  eq(s.mrrCurrency, 'GBP', 'so its currency does not withhold one either');
}

{
  // An annual plan DOES contribute, so its currency counts.
  const s = summarise(
    [],
    [member('a', 'p1'), member('b', 'p2')],
    [plan('p1', 1200, 'GBP'), plan('p2', 12000, 'AED', 'year')],
  );
  eq(s.mrrCents, 2200, 'the annual plan contributes a twelfth');
  eq(s.mrrCurrency, null, 'and therefore its currency has to agree');
}

{
  // A membership whose plan carries no currency at all. The plan is priced, so
  // it contributes; it states nothing, so the total cannot be named.
  const s = summarise(
    [],
    [member('a', 'p1'), member('b', 'p2')],
    // `membership_plans.currency` is `not null default 'AED'`, so a plan that
    // says nothing says it as an empty string rather than as a null. The two
    // are the same fact and sharedCurrency normalises them together — money()
    // already refuses '' for exactly this reason.
    [plan('p1', 4000, 'GBP'), plan('p2', 4000, '')],
  );
  eq(s.mrrCents, 8000, 'both are monthly and both are priced');
  eq(s.mrrCurrency, null, 'but one of them will not say in what');
}

if (errors.length) {
  console.error(`gymMoney: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('gymMoney: ok (a sum names its currency, or is refused one)');
