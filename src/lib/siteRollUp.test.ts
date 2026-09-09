// A figure over several gyms, and the four ways it lies.
//
// Ordered by how expensive the mistake is rather than by how the module reads:
//
//   1. A GYM THAT DID NOT ANSWER IS NOT A GYM WITH NO MEMBERS. `status !==
//      'error'` admits 'loading' and 'partial'; the second is the one nobody
//      expects, and across sites the wrong answer is not an empty screen but a
//      smaller number that looks real. The mutation block at the bottom asserts
//      that the loose test actually passes and this module's does not.
//   2. MONEY IS NEVER ADDED ACROSS CURRENCIES. Two gyms on two codes have no
//      combined revenue, and a gym that recorded no code at all is a SECOND
//      answer rather than a free pass into the neighbour's pot.
//   3. TWO GYMS IN TWO ZONES DO NOT SHARE A MONTH.
//   4. NOTHING IS EVER ZERO BECAUSE IT WAS NOT READ.
import {
  gapOf, rollCount, rollMoney, denominate, siteMoney, zoneSpan, mayPresentAsOnePeriod,
  periodNote, floorNote, gapsNote, moneyNote, orderSites, drillInto,
  type SiteFigures, type SiteMoney,
} from './siteRollUp';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const NO_MONEY: SiteMoney = { cents: null, currencies: [], unstated: false };

function site(over: Partial<SiteFigures> & { siteId: string }): SiteFigures {
  return {
    name: null,
    current: false,
    refused: false,
    status: 'ready',
    currency: null,
    timezone: null,
    activeMembers: null,
    trainers: null,
    taken: NO_MONEY,
    ...over,
  };
}

const money = (cents: number, code: string | null): SiteMoney =>
  code === null
    ? { cents, currencies: [], unstated: true }
    : { cents, currencies: [code], unstated: false };

/* ── 1 · a read that did not finish is not a gym with nothing in it ────────── */

const here = site({
  siteId: A, name: 'Ruoni Fitness', current: true, currency: 'GBP',
  timezone: 'Europe/London', activeMembers: 220, trainers: 6, taken: money(480_000, 'GBP'),
});
const north = site({
  siteId: B, name: 'Ruoni North', currency: 'GBP',
  timezone: 'Europe/London', activeMembers: 140, trainers: 4, taken: money(310_000, 'GBP'),
});

{
  const whole = rollCount([here, north], (s) => s.activeMembers);
  eq(whole.total, 360, 'two gyms that both answered are a total');
  eq(whole.whole, true, 'and it is a total, not a floor');
  eq(whole.floor, false, 'so nothing marks it as one');
  eq(floorNote(whole), null, 'and there is no sentence over it');
}

// The four statuses, one gym each, over four gyms that between them hold 400
// members. Only the whole ones are in the figure.
{
  const four = [
    here,
    site({ siteId: B, name: 'Ruoni North', status: 'error', activeMembers: null }),
    site({ siteId: C, name: 'Ruoni Marina', status: 'partial', activeMembers: 90 }),
    site({ siteId: D, name: 'Ruoni Deira', status: 'loading', activeMembers: null }),
  ];
  const roll = rollCount(four, (s) => s.activeMembers);
  eq(roll.total, 220, 'only the gym that answered whole is in the figure');
  eq(roll.floor, true, 'and the figure is a floor');
  eq(roll.whole, false, 'never a total');
  eq(roll.gaps.length, 3, 'three gyms are named as missing');
  eq(roll.gaps.map((g) => g.why).join(','), 'error,partial,loading',
    'each with its own reason, not one word for all three');
  ok((floorNote(roll) ?? '').startsWith('This is a floor, not a total: 1 of 4 gyms'),
    'and the sentence says floor, and says how many of how many');
  ok((gapsNote(roll) ?? '').includes('Ruoni Marina answered with more rows than came back'),
    'the truncated read is described as truncated, not as failed');
}

// THE ONE THAT MATTERS MOST. A gym at the row cap holds real rows and an
// unknown fraction of them. It must not be counted.
eq(gapOf(site({ siteId: C, status: 'partial' }), 90), 'partial',
  'a partial read is a gap even though the figure in hand is a number');
eq(gapOf(site({ siteId: C, status: 'ready' }), 90), null, 'a whole read with a figure is in');
eq(gapOf(site({ siteId: C, status: 'ready' }), null), 'unstated',
  'a whole read with nothing on record is out, and it is not a zero');
eq(gapOf(site({ siteId: C, status: 'error', refused: true }), 90), 'refused',
  'a refused gym is refused whatever else is true of it');

// Nothing answered at all. Null, never 0.
{
  const dark = rollCount(
    [site({ siteId: A, name: 'Ruoni Fitness', status: 'error' }),
      site({ siteId: B, name: 'Ruoni North', status: 'error' })],
    (s) => s.activeMembers,
  );
  eq(dark.total, null, 'two failed reads are not a business with no members');
  eq(dark.floor, false, 'there is no figure, so there is no floor');
  ok((floorNote(dark) ?? '').includes('which is not the same as a figure of nothing'),
    'and the sentence says so out loud');
}

eq(rollCount([], (s) => s.activeMembers).total, null, 'no gyms at all is null');
eq(rollCount([], (s) => s.activeMembers).whole, false, 'and never a whole answer');

/* ── 2 · the ordinary state of a second gym: recorded, not readable ────────── */

{
  const recorded = [here, site({ siteId: B, name: 'Ruoni North', refused: true, status: 'error' })];
  const roll = rollCount(recorded, (s) => s.activeMembers);
  eq(roll.total, 220, 'the readable gym is counted');
  eq(roll.gaps[0].why, 'refused', 'and the other is refused rather than failed');
  ok((gapsNote(roll) ?? '').includes('Ruoni North is not on this sign-in'),
    'which reads as a thing nobody switched on, not as a thing that broke');

  const drill = drillInto(recorded, B);
  ok(drill != null, 'a refused gym can still be opened');
  ok((drill?.blocked ?? '').includes('Nothing failed'),
    'and it says nothing failed, because nothing did');
  eq(drill?.depthNote, null, 'there are no figures to qualify');

  const own = drillInto(recorded, A);
  eq(own?.blocked, null, 'the gym this console is signed in to is not blocked');
  eq(own?.depthNote, null, 'and needs no caveat — every other screen already shows it');
}

// A second gym whose TOTALS came back is still not a gym whose rows did.
{
  const drill = drillInto([here, north], B);
  eq(drill?.blocked, null, 'its figures are there');
  ok((drill?.depthNote ?? '').includes('not on this sign-in'),
    'and the drill-down says its members and payments are not');
}

eq(drillInto([here], B), null, 'a gym that is not in the list cannot be opened');

/* ── 3 · money is never added across currencies ────────────────────────────── */

{
  const same = rollMoney([here, north], (s) => s.taken);
  eq(same.cents, 790_000, 'two gyms in one money have a combined figure');
  eq(same.currency, 'GBP', 'labelled with the money it is in');
  eq(same.mixedCurrency, false, 'and not mixed');
  eq(moneyNote(same), null, 'so nothing needs saying about it');
}

{
  const dubai = site({
    siteId: B, name: 'Ruoni Dubai', currency: 'AED', timezone: 'Asia/Dubai',
    activeMembers: 140, taken: money(300_000, 'AED'),
  });
  const mixed = rollMoney([here, dubai], (s) => s.taken);
  eq(mixed.cents, null, 'a pound and a dirham do not add up to anything');
  eq(mixed.currency, null, 'and there is no code to label the sum with');
  eq(mixed.mixedCurrency, true, 'the gate says mixed');
  eq(mixed.currencies.join(','), 'AED,GBP', 'and the words name both, sorted');
  eq(mixed.counted.length, 0, 'nobody is IN a total that does not exist');
  eq(mixed.floor, false, 'and a figure that is absent is not a floor');
  ok((moneyNote(mixed) ?? '').includes('never adds money across currencies'),
    'the sentence says the rule rather than hedging');
  eq(floorNote(mixed), null,
    'and the floor sentence stays quiet — one silence gets one explanation');
}

// A gym that recorded no currency is a SECOND answer, not a free pass into the
// neighbour's pot. This is the cross-site form of the substitution part 1010
// added sessions.rate_currency to end.
{
  const silent = site({ siteId: B, name: 'Ruoni North', taken: money(310_000, null) });
  const roll = rollMoney([here, silent], (s) => s.taken);
  eq(roll.mixedCurrency, true, 'stated GBP and stated nothing are two answers');
  eq(roll.cents, null, 'so there is no combined figure');
  eq(roll.currencies.join(','), 'GBP', 'and only the real code is a word');
}

// Every gym silent: the figure is REAL and its unit is genuinely not recorded.
// Nulling it would destroy a true number; labelling it would be a guess.
{
  const roll = rollMoney(
    [site({ siteId: A, name: 'One', taken: money(100, null) }),
      site({ siteId: B, name: 'Two', taken: money(200, null) })],
    (s) => s.taken,
  );
  eq(roll.cents, 300, 'the figure survives');
  eq(roll.currency, null, 'unlabelled');
  eq(roll.mixedCurrency, false, 'and it is not mixed — one answer, given twice');
  ok((moneyNote(roll) ?? '').includes('that would be a guess'), 'and the note says why');
}

// ' gbp ' and 'GBP' are one currency. A comparison that says otherwise
// withholds a total the gym is entitled to.
eq(denominate([{ cents: 1, currencies: [' gbp '], unstated: false },
  { cents: 2, currencies: ['GBP'], unstated: false }]).cents, 3,
'spacing and case do not open a second pot');

// A figure with rows behind it and nothing said about any of them counts as
// unstated rather than as agreeing with whoever is beside it.
eq(denominate([{ cents: 5, currencies: [], unstated: false },
  { cents: 5, currencies: ['GBP'], unstated: false }]).mixedCurrency, true,
'an empty currency list is "nobody said", not "same as the others"');

// One gym's own rows get the same rule as four gyms' do.
eq(siteMoney({ cents: 900, currencies: ['GBP', 'AED'], unstated: false }).cents, null,
  'a gym that changed its currency mid-window has no figure of its own either');
eq(siteMoney({ cents: 900, currencies: ['GBP'], unstated: false }).currency, 'GBP',
  'and one that did not, does');
eq(siteMoney(NO_MONEY).cents, null, 'no rows is null, not zero');

/* ── 4 · two gyms in two zones do not share a month ────────────────────────── */

{
  const roll = rollCount([here, north], (s) => s.activeMembers);
  const span = zoneSpan(roll, [here, north]);
  eq(span.kind, 'one', 'two gyms on one clock keep one month');
  eq(mayPresentAsOnePeriod(span), true, 'so "September" means one window');
  eq(periodNote(span, 'September'), null, 'and needs no sentence');
}

{
  const dubai = site({
    siteId: B, name: 'Ruoni Dubai', timezone: 'Asia/Dubai', activeMembers: 140,
  });
  const roll = rollCount([here, dubai], (s) => s.activeMembers);
  const span = zoneSpan(roll, [here, dubai]);
  eq(span.kind, 'mixed', 'London and Dubai are two clocks');
  eq(mayPresentAsOnePeriod(span), false, 'so no period heading may stand alone');
  ok((periodNote(span, 'September') ?? '').includes('September is not one window here'),
    'and the sentence names the heading the reader just read');
  ok((periodNote(span, 'September') ?? '').includes('Asia/Dubai, Europe/London'),
    'and names both zones, sorted');
}

// A gym with no zone beside one that has a zone is mixed, not "one".
{
  const nowhere = site({ siteId: B, name: 'Ruoni North', activeMembers: 140 });
  const roll = rollCount([here, nowhere], (s) => s.activeMembers);
  const span = zoneSpan(roll, [here, nowhere]);
  eq(span.kind, 'mixed', 'a stated zone and an unstated one are two answers');
  ok((periodNote(span, 'this month') ?? '').includes('has not set one'),
    'and the note says a gym has not set one');
}

// Nobody has a zone: the window is drawn on somebody else's clock and the
// screen has to say whose.
{
  const a = site({ siteId: A, name: 'One', activeMembers: 1 });
  const b = site({ siteId: B, name: 'Two', activeMembers: 2 });
  const span = zoneSpan(rollCount([a, b], (s) => s.activeMembers), [a, b]);
  eq(span.kind, 'none', 'no zones at all is its own answer');
  eq(mayPresentAsOnePeriod(span), false, 'and it is not one period');
  ok((periodNote(span, 'September') ?? '').includes('Repple’s clock'),
    'the note names whose clock it actually is');
}

// THE ZONE QUESTION IS ABOUT THE GYMS IN THE FIGURE, NOT THE GYMS ON THE PAGE.
// A warning about a problem the figure does not have teaches a reader to ignore
// the ones it does.
{
  const dubai = site({
    siteId: B, name: 'Ruoni Dubai', timezone: 'Asia/Dubai', status: 'error',
  });
  const roll = rollCount([here, dubai], (s) => s.activeMembers);
  eq(zoneSpan(roll, [here, dubai]).kind, 'one',
    'the gym that contributed nothing contributes no clock either');
}

eq(zoneSpan(rollCount([], (s) => s.activeMembers), []).kind, 'unknown',
  'nothing in the figure means the question cannot be answered');
eq(mayPresentAsOnePeriod({ kind: 'unknown' }), false,
  'and unknown may not claim one period — a screen never claims a scope it did not establish');

/* ── 5 · the order two gyms appear in ──────────────────────────────────────── */

{
  const rows = orderSites([
    site({ siteId: C, name: 'Zed' }),
    site({ siteId: B, name: 'Alpha' }),
    site({ siteId: D, name: null }),
    here,
  ]);
  eq(rows.map((r) => r.siteId).join(','), [A, D, B, C].join(','),
    'the signed-in gym first, then by name with the unnamed sorting as empty, then by id');
  eq(orderSites([here, north])[0].siteId, A, 'and the order is stable across reads');
}

/* ── 6 · the mutations: the wrong versions must actually pass ──────────────── */
//
// Each pair below is a simplification somebody could make while tidying. The
// first line asserts the wrong version is quiet; the second asserts this module
// is not. Delete either and the file stops defending anything.

// "status !== 'error'" — the fourteen-times-fixed defect, one level up.
{
  const cap = site({ siteId: C, name: 'Ruoni Marina', status: 'partial', activeMembers: 90 });
  const loose = (s: SiteFigures, v: number | null) => (s.status !== 'error' && v != null);
  eq(loose(cap, 90), true, 'the wrong version counts a truncated read');
  eq(gapOf(cap, 90), 'partial', 'and the right one refuses to');
}

// "error or loading" — the second spelling, which admits 'partial' as well.
{
  const cap = site({ siteId: C, status: 'partial', activeMembers: 90 });
  const looser = (s: SiteFigures) => s.status === 'error' || s.status === 'loading';
  eq(looser(cap), false, 'the wrong version sees nothing wrong with a row-capped read');
  ok(gapOf(cap, 90) !== null, 'and the right one keeps it out of the total');
}

// "a missing gym contributes nothing, so just add up what you have."
{
  const four = [here, site({ siteId: B, name: 'Ruoni North', status: 'error' })];
  const naive = four.reduce((a, s) => a + (s.activeMembers ?? 0), 0);
  eq(naive, 220, 'the wrong version produces the same number');
  const roll = rollCount(four, (s) => s.activeMembers);
  eq(roll.total, 220, 'and so does this one — the number was never the difference');
  eq(roll.floor, true, 'the difference is that this one knows the number is a floor');
  ok(floorNote(roll) !== null, 'and says so, which is the entire feature');
}

// "null is basically zero."
{
  const dark = rollCount([site({ siteId: A, status: 'error' })], (s) => s.activeMembers);
  eq(dark.total ?? 0, 0, 'reading the null as zero gives a confident nothing');
  eq(dark.total, null, 'and this module refuses to hand one over');
}

// "one of them is in GBP, so call the total GBP."
{
  const dubai = site({ siteId: B, name: 'Ruoni Dubai', taken: money(300_000, 'AED') });
  const parts = [here, dubai].map((s) => s.taken);
  const naive = parts.reduce((a, p) => a + (p.cents ?? 0), 0);
  eq(naive, 780_000, 'the wrong version adds a pound to a dirham');
  eq(rollMoney([here, dubai], (s) => s.taken).cents, null, 'and this one has no figure to give');
}

if (errors.length) {
  console.error(`siteRollUp.test.ts — ${errors.length} failed:`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('siteRollUp.test.ts — ok');
