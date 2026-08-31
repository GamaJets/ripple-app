// What a member is told about their own membership and their own money.
// Compile with tsc, run with node.
//
// Three claims are being pinned here, and each of them is a sentence the app
// would otherwise say to a paying member that is not true:
//
//   1. "Your gym has not recorded a plan"  — said when the plan row simply
//      could not be read. Proved live before part 125: a member on a RETIRED
//      plan read their membership fine and got null for the plan, and over
//      PostgREST that is byte-identical to having no plan at all.
//   2. "Active"                            — said off the status column, which
//      no job ever moves, to somebody whose end date passed in March.
//   3. A single total                      — summed across AED and GBP rows,
//      producing a number in no currency that exists.
import {
  EXPIRING_SOON_DAYS, amount, daysBetween, isCurrent, methodLabel, planStateOf,
  primaryMembership, renewalNote, standingLabel, standingOf, todayIso, totalsByCurrency,
  type MemberMembership, type MemberPlan,
} from './memberRecord';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-08-31';

const plan = (over: Partial<MemberPlan> = {}): MemberPlan => ({
  id: 'p1', name: 'Gold', priceCents: 20000, currency: 'AED', interval: 'month', active: true, ...over,
});
const mem = (over: Partial<MemberMembership> = {}): MemberMembership => ({
  id: 'm1', tenantId: 't1', startedOn: '2026-01-05', endsOn: null, status: 'active',
  planId: 'p1', plan: plan(), ...over,
});

/* ── the plan that could not be read is not "no plan" ─────────────────────── */

// Claim 1. These two rows differ in nothing a `?? null` could tell apart.
eq(planStateOf({ planId: null, plan: null }).kind, 'none',
  'a membership the gym attached no plan to reports "none" — a real, sayable fact');
eq(planStateOf({ planId: 'p1', plan: null }).kind, 'unreadable',
  'a membership WITH a plan id whose plan row did not come back reports "unreadable", not "none"');
eq(planStateOf({ planId: 'p1', plan: plan() }).kind, 'plan',
  'and a plan that came back reports itself');

// The retired plan is the case part 125 exists for: it is still the member's
// plan, and it must read exactly like any other.
const retired = planStateOf({ planId: 'p1', plan: plan({ active: false, name: 'Gold (2024)' }) });
eq(retired.kind, 'plan', 'a plan the gym has stopped selling is still the plan its holder is on');
eq(retired.kind === 'plan' ? retired.plan.name : null, 'Gold (2024)', 'and it is named, not hidden');

/* ── the dates decide, not the status column ──────────────────────────────── */

// Claim 2. `memberships.status` defaults to 'active' on insert and nothing in
// the schema moves it when ends_on passes.
const stale = standingOf({ status: 'active', startedOn: '2025-01-01', endsOn: '2026-03-31' }, TODAY);
eq(stale.kind, 'expired', "a row still marked 'active' whose end date has passed is EXPIRED");
eq(stale.kind === 'expired' ? stale.stale : null, true,
  'and the fact that the database still disagrees is carried, not swallowed');
ok(/reception/i.test(renewalNote(stale, planStateOf(mem()))),
  'the sentence for it sends them to reception rather than promising entry');

const properlyExpired = standingOf({ status: 'expired', startedOn: '2025-01-01', endsOn: '2026-03-31' }, TODAY);
eq(properlyExpired.kind, 'expired', 'a row the gym actually marked expired is expired too');
eq(properlyExpired.kind === 'expired' ? properlyExpired.stale : null, false, 'and is not flagged as stale');

// A decision beats a date in both directions.
eq(standingOf({ status: 'cancelled', startedOn: '2026-01-01', endsOn: '2027-01-01' }, TODAY).kind, 'cancelled',
  'a cancelled membership with a future end date is cancelled, not current');
eq(standingOf({ status: 'frozen', startedOn: '2026-01-01', endsOn: null }, TODAY).kind, 'frozen',
  'and a frozen one is frozen');

// Open-ended is a real arrangement, and is NOT expired.
eq(standingOf({ status: 'active', startedOn: '2026-01-05', endsOn: null }, TODAY).kind, 'open',
  'no end date means open-ended — part 29 says so — never "expired"');
ok(/end date/i.test(renewalNote({ kind: 'open' }, planStateOf(mem()))),
  'and the note says the gym has recorded no end date rather than inventing one');

// The old screen printed "Valid until <today + 1 year>". Nothing may do that again.
const openNote = renewalNote({ kind: 'open' }, planStateOf(mem()));
ok(!/\d{4}-\d{2}-\d{2}/.test(openNote), 'an open-ended membership yields NO date at all, invented or otherwise');
ok(!/2027/.test(openNote), 'and certainly not one a year out');

/* ── the boundary: the last day is still a day you can train ──────────────── */

eq(standingOf({ status: 'active', startedOn: '2026-01-01', endsOn: TODAY }, TODAY).kind, 'expiring',
  'a membership ending TODAY is still good today — turning somebody away on the last day is a complaint');
eq(standingOf({ status: 'active', startedOn: '2026-01-01', endsOn: '2026-08-30' }, TODAY).kind, 'expired',
  'and the day after it ends, it has ended');

const soon = standingOf({ status: 'active', startedOn: '2026-01-01', endsOn: '2026-09-30' }, TODAY);
eq(soon.kind, 'expiring', `${EXPIRING_SOON_DAYS} days out is "ending soon"`);
eq(soon.kind === 'expiring' ? soon.daysLeft : null, 30, 'and the count is the days left, not an off-by-one');
eq(standingOf({ status: 'active', startedOn: '2026-01-01', endsOn: '2026-10-01' }, TODAY).kind, 'current',
  'one day past the window is simply current');

eq(standingOf({ status: 'active', startedOn: '2026-09-01', endsOn: null }, TODAY).kind, 'upcoming',
  'a membership sold to start next month has not started');

// A malformed end date must not be read as a licence to call it current.
eq(standingOf({ status: 'active', startedOn: '2026-01-01', endsOn: 'soon' }, TODAY).kind, 'open',
  'an unparseable end date falls back to open-ended rather than to a confident date');

/* ── what may be believed ─────────────────────────────────────────────────── */

ok(isCurrent({ kind: 'open' }), 'open-ended counts as current');
ok(isCurrent({ kind: 'current', endsOn: '2027-01-01', daysLeft: 123 }), 'so does current');
ok(isCurrent({ kind: 'expiring', endsOn: '2026-09-02', daysLeft: 2 }), 'and so does ending-soon — it has not ended');
ok(!isCurrent({ kind: 'expired', endsOn: '2026-01-01', stale: true }), 'expired does not, however the column reads');
ok(!isCurrent({ kind: 'frozen', endsOn: null }), 'a frozen membership does not let you in');
ok(!isCurrent({ kind: 'cancelled', endsOn: null }), 'nor a cancelled one');
ok(!isCurrent({ kind: 'upcoming', startsOn: '2026-09-01', daysUntil: 1 }), 'nor one that has not begun');

eq(standingLabel({ kind: 'expiring', endsOn: '2026-09-02', daysLeft: 2 }), 'Ending soon', 'the badge for expiring');
eq(standingLabel({ kind: 'expired', endsOn: null, stale: true }), 'Expired', 'and for expired, stale or not');

/* ── which membership the screen leads with ───────────────────────────────── */

// A member can hold a cancelled membership sold yesterday and a running one
// sold last year. Leading with the newest row tells somebody who is paid up
// that they are not.
const running = mem({ id: 'running', startedOn: '2025-06-01', endsOn: '2027-01-01', status: 'active' });
const cancelledYesterday = mem({ id: 'cancelled', startedOn: '2026-08-30', status: 'cancelled' });
eq(primaryMembership([cancelledYesterday, running], TODAY)?.id, 'running',
  'the current membership leads, even though the cancelled one is newer');
eq(primaryMembership([running, cancelledYesterday], TODAY)?.id, 'running', 'and the input order does not decide it');

const older = mem({ id: 'older', startedOn: '2024-01-01', endsOn: '2027-01-01' });
eq(primaryMembership([older, running], TODAY)?.id, 'running', 'among two current ones, the one started most recently');
eq(primaryMembership([], TODAY), null, 'no memberships is null, not a fabricated one');
eq(primaryMembership([cancelledYesterday], TODAY)?.id, 'cancelled',
  'a member whose only membership is cancelled is shown it — that is their actual position');

/* ── money: the currency is the row's, never this file's ──────────────────── */

// Claim 3. `gym_payments.currency` is per row because Repple is white-labelled.
const mixed = [
  { amountCents: 20000, currency: 'AED' },
  { amountCents: 15000, currency: 'AED' },
  { amountCents: 9900, currency: 'GBP' },
];
const totals = totalsByCurrency(mixed);
eq(totals.length, 2, 'two currencies produce two totals — never one');
eq(totals[0].currency, 'AED', 'sorted by currency so the order does not depend on which row came back first');
eq(totals[0].cents, 35000, 'the dirhams add up');
eq(totals[1].cents, 9900, 'and the pounds are left alone');
ok(!totals.some((t) => t.cents === 44900), 'nothing anywhere produces the cross-currency sum');

eq(totalsByCurrency([]).length, 0, 'no payments is no totals');
const unrecorded = totalsByCurrency([{ amountCents: 5000, currency: null }, { amountCents: 100, currency: 'AED' }]);
eq(unrecorded.length, 2, 'a row with no currency gets its own bucket rather than joining the biggest one');
eq(unrecorded[unrecorded.length - 1].currency, null, 'and it sorts last, where an oddity belongs');
eq(totalsByCurrency([{ amountCents: 100, currency: 'aed' }, { amountCents: 100, currency: ' AED ' }])[0].currency, 'AED',
  'case and stray space are the same currency, not two');

eq(amount(20000, 'AED'), 'AED 200.00', 'an amount is its ISO code and two decimals');
eq(amount(9900, 'gbp'), 'GBP 99.00', 'lower case in the column is still the currency');
eq(amount(0, 'AED'), 'AED 0.00', 'a genuine zero is a zero — a free month is a fact');
eq(amount(null, 'AED'), '—', 'an amount nobody read is a dash, never 0.00');
eq(amount(undefined, 'AED'), '—', 'and so is one that is not there');
ok(/currency not recorded/.test(amount(5000, null)),
  'an amount whose currency did not come back says so rather than borrowing one');
ok(!/[$£€]/.test(amount(5000, 'USD')), 'no symbol is ever guessed — billing.ts already billed a Dubai gym in dollars that way');
eq(amount(123456789, 'AED'), 'AED 1,234,567.89', 'and a figure over three digits is separated');

eq(methodLabel('direct_debit'), 'Direct debit', 'the method reads as a person would say it');
eq(methodLabel(null), 'Not recorded', 'and one the gym left blank is not silently called a card payment');

/* ── date arithmetic that survives a timezone ─────────────────────────────── */

// npm run test:zones runs this file in Los Angeles, Auckland and Dubai. Any of
// these done by constructing local Dates is off by one in at least one of them.
eq(daysBetween('2026-08-31', '2026-09-30'), 30, 'a month across a month boundary');
eq(daysBetween('2026-01-01', '2026-01-01'), 0, 'the same day is zero days');
eq(daysBetween('2026-03-01', '2026-02-28'), -1, 'and backwards is negative, not absolute');
eq(daysBetween('2026-03-07', '2026-03-09'), 2, 'a US DST weekend is still two days');
eq(daysBetween('2026-04-03', '2026-04-06'), 3, 'and so is a southern-hemisphere one');
eq(daysBetween('2024-02-28', '2024-03-01'), 2, 'a leap day counts');
eq(daysBetween('', '2026-01-01'), null, 'a missing date is null, not 0');
eq(daysBetween('2026-01-01', 'whenever'), null, 'and so is an unreadable one');

eq(todayIso(new Date(2026, 7, 31, 23, 30)), '2026-08-31',
  'late on the 31st is still the 31st in the reader’s own life, whatever UTC thinks');
eq(todayIso(new Date(2026, 0, 5, 0, 15)), '2026-01-05', 'and just after midnight is the new day');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`memberRecord: ok (plan-unreadable ≠ no-plan, dates beat the status column, ${EXPIRING_SOON_DAYS}-day window, no cross-currency totals)`);
