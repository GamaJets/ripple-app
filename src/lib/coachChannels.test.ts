// What the coach's channels cost against what they returned — and, mostly, the
// refusal to say. Compile with tsc, run with node.
//
// The defect this guards is one subtraction. Spend on one side, revenue on the
// other, difference in the middle — and every hole in either side moves that
// difference in the flattering direction, silently, leaving nothing on the
// screen where the missing thing would have been. A coach reading "your ads
// returned four times what they cost" off three codes out of seven, four of
// which nobody costed, has been handed a number that is not wrong so much as
// about a different business.
//
// So most of what follows is aimed at the refusals: each one is asserted from
// both sides of its condition, because a refusal that fires whatever happens is
// the same as no refusal at all once somebody notices it never lets anything
// through and deletes it.
import {
  againstLine, channelEmptyLine, channelReachLine, channelSum, spendAgainstReturn,
  type Against, type ChannelSum,
} from './coachChannels';
import type { CodeReturnRow } from './codeReturn';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (over: Partial<CodeReturnRow> = {}): CodeReturnRow => ({
  id: 'id-1', code: 'K7M2QX', label: 'Instagram bio', isDefault: false, isLive: true,
  createdAt: '2026-08-01T10:00:00Z', clients: 0, activeNow: 0,
  revenue: null, spend: null, ...over,
});

/** A sum with no holes in it, for pinning one refusal at a time. */
const sum = (over: Partial<ChannelSum> = {}): ChannelSum => ({
  codes: 1, unnamed: 0, clients: 0, stayed: 0,
  spent: [{ currency: 'GBP', minorUnits: 40000, count: 1 }],
  earned: [{ currency: 'GBP', minorUnits: 125000, count: 1 }],
  costUnknown: 0, paidUnknown: 0, crossCurrency: 0, ...over,
});

const whyAgainst = (a: Against): string => (a.statable ? 'statable' : a.why);

/* ── the default bucket is not a channel ────────────────────────────────── */

// It holds everybody whose join no named code claims, has no spend by
// construction, and would therefore put revenue on the return side against
// nothing on the cost side. enoughToTell() excludes it from ranking for the
// same reason; this excludes it from the arithmetic.
const withDefault = channelSum([
  row({ isDefault: true, label: 'Your main code', clients: 9, activeNow: 9, revenue: { cents: 900000, currency: 'GBP' } }),
  row({ id: 'id-2', label: 'Instagram bio', clients: 4, activeNow: 3, spend: { cents: 40000, currency: 'GBP' }, revenue: { cents: 125000, currency: 'GBP' } }),
]);
eq(withDefault.codes, 1, 'the default bucket is not counted as a channel');
eq(withDefault.unnamed, 1, 'and the screen is told how many rows were left out');
eq(withDefault.clients, 4, 'its nine clients are not credited to any channel');
eq(withDefault.stayed, 3, 'nor are they counted as having stayed on one');
eq(withDefault.earned.length, 1, 'and its revenue is not on the return side');
eq(withDefault.earned[0].minorUnits, 125000, 'which is the named code’s revenue alone, not the two added');
eq(withDefault.spent[0].minorUnits, 40000, 'the named code’s spend is counted');
eq(withDefault.spent[0].count, 1, 'and the pot knows how many codes are in it');

// The other half of the same branch: a named row is NOT dropped.
eq(channelSum([row()]).codes, 1, 'a named code is counted');
eq(channelSum([row()]).unnamed, 0, 'and is not filed as unnamed');

/* ── unknown is not zero, on either side ────────────────────────────────── */

const noCost = channelSum([row({ revenue: { cents: 125000, currency: 'GBP' } })]);
eq(noCost.costUnknown, 1, 'a code nobody has costed is counted as uncosted');
eq(noCost.spent.length, 0, 'and contributes nothing to the spend side');

// A typed zero IS a claim the coach made — an organic post that cost nothing —
// and it belongs in the total. Collapsing it into "not recorded" would tell a
// coach who deliberately recorded a zero that they had not answered.
const zeroCost = channelSum([row({ spend: { cents: 0, currency: 'GBP' }, revenue: { cents: 125000, currency: 'GBP' } })]);
eq(zeroCost.costUnknown, 0, 'a recorded zero is a recorded cost, not an absent one');
eq(zeroCost.spent.length, 1, 'and opens a pot in its currency');
eq(zeroCost.spent[0].minorUnits, 0, 'holding nothing, which is a figure');

const noRevenue = channelSum([row({ spend: { cents: 40000, currency: 'GBP' } })]);
eq(noRevenue.paidUnknown, 1, 'a code whose clients’ payments could not be totalled is counted');
eq(noRevenue.earned.length, 0, 'and contributes nothing to the return side');

/* ── currencies never merge, and the order does not shuffle ─────────────── */

const twoCurrencies = channelSum([
  row({ id: 'a', spend: { cents: 10000, currency: 'GBP' }, revenue: { cents: 10000, currency: 'GBP' } }),
  row({ id: 'b', spend: { cents: 90000, currency: 'AED' }, revenue: { cents: 90000, currency: 'AED' } }),
]);
eq(twoCurrencies.spent.length, 2, 'two currencies make two pots');
eq(twoCurrencies.spent[0].currency, 'AED', 'and the bigger amount is read first');
eq(twoCurrencies.spent[1].currency, 'GBP', 'with the smaller under it');

// The tiebreak, which is what stops the order shuffling between two reads of
// the same data — a screen whose rows swap places on refresh is read as a
// screen whose figures changed.
const tied = channelSum([
  row({ id: 'a', spend: { cents: 5000, currency: 'GBP' } }),
  row({ id: 'b', spend: { cents: 5000, currency: 'AED' } }),
]);
eq(tied.spent[0].currency, 'AED', 'equal amounts are ordered by their code');
eq(tied.spent[1].currency, 'GBP', 'so the same rows always read the same way round');

const sameCurrency = channelSum([
  row({ id: 'a', spend: { cents: 5000, currency: 'GBP' } }),
  row({ id: 'b', spend: { cents: 7000, currency: 'GBP' } }),
]);
eq(sameCurrency.spent.length, 1, 'two codes in one currency share a pot');
eq(sameCurrency.spent[0].minorUnits, 12000, 'and their amounts add');
eq(sameCurrency.spent[0].count, 2, 'and the pot counts both of them');

const crossed = channelSum([row({ spend: { cents: 40000, currency: 'GBP' }, revenue: { cents: 125000, currency: 'AED' } })]);
eq(crossed.crossCurrency, 1, 'a code paid for in one currency whose clients paid in another is flagged');
eq(channelSum([row({ spend: { cents: 1, currency: 'GBP' }, revenue: { cents: 1, currency: 'GBP' } })]).crossCurrency, 0,
  'and a code whose two sides agree is not');
// Half a pair is not a mismatch — it is already counted as a hole above, and
// counting it twice would report a currency problem to a coach who has one
// missing figure.
eq(noCost.crossCurrency, 0, 'a code with no spend at all is not a currency mismatch');
eq(noRevenue.crossCurrency, 0, 'nor is one with no revenue');

/* ── the refusals, each from both sides of its condition ────────────────── */

const STATUSES: LoadStatus[] = ['loading', 'partial', 'error'];
for (const s of STATUSES) {
  eq(whyAgainst(spendAgainstReturn(s, sum())), 'unread', `a ${s} read states no comparison`);
}
// 'partial' matters most and is the easiest to talk yourself out of: the rows
// in it are real, so a set of them looks like a set. It is an unknown set.
ok(!spendAgainstReturn('partial', sum()).statable, 'a truncated set of codes is an unknown set, not a smaller one');
eq(whyAgainst(spendAgainstReturn('ready', sum())), 'statable', 'and a completed read with no holes does state one');

eq(whyAgainst(spendAgainstReturn('ready', sum({ codes: 0, spent: [], earned: [] }))), 'no-channels',
  'no named codes is its own answer, and not a comparison of nothing');

eq(whyAgainst(spendAgainstReturn('ready', sum({ codes: 4, costUnknown: 3 }))), 'cost-unknown',
  'three uncosted codes out of four withholds the figure');
eq(whyAgainst(spendAgainstReturn('ready', sum({ codes: 4, costUnknown: 1 }))), 'cost-unknown',
  'and so does one — a single hole is enough to move the difference');

eq(whyAgainst(spendAgainstReturn('ready', sum({ codes: 2, paidUnknown: 1 }))), 'paid-unknown',
  'a code whose revenue could not be totalled withholds the figure too');
eq(whyAgainst(spendAgainstReturn('ready', sum({ codes: 2, crossCurrency: 1 }))), 'cross',
  'and so does a code whose two sides are in different currencies');

const split = spendAgainstReturn('ready', sum({
  codes: 2,
  spent: [{ currency: 'AED', minorUnits: 90000, count: 1 }, { currency: 'GBP', minorUnits: 40000, count: 1 }],
  earned: [{ currency: 'AED', minorUnits: 200000, count: 1 }, { currency: 'GBP', minorUnits: 125000, count: 1 }],
}));
eq(whyAgainst(split), 'two-currencies', 'two codes in two currencies have no single difference between them');
ok(/deliberately not added together/.test(split.statable ? '' : split.note), 'and the screen says that was a decision');

// Either side alone is enough. In rows that came through channelSum the two
// sides always match — every code past the hole counts carries both halves in
// one currency — but this function is handed a ChannelSum, not rows, and a set
// whose sides disagree must not fall through to the amounts underneath. Told
// apart from the mismatch case below, because "you advertise in two currencies"
// and "this figure is in the wrong one" are different sentences.
eq(whyAgainst(spendAgainstReturn('ready', sum({
  spent: [{ currency: 'AED', minorUnits: 90000, count: 1 }, { currency: 'GBP', minorUnits: 40000, count: 1 }],
}))), 'two-currencies', 'two spend currencies against one revenue currency is a two-currency set');
eq(whyAgainst(spendAgainstReturn('ready', sum({
  earned: [{ currency: 'AED', minorUnits: 200000, count: 1 }, { currency: 'GBP', minorUnits: 125000, count: 1 }],
}))), 'two-currencies', 'and so is one spend currency against two revenue currencies');

// Exactly one pot on each side is the passing case, and the boundary is the
// mutation most worth pinning: `> 1` slipping to `>= 1` refuses everything.
eq(whyAgainst(spendAgainstReturn('ready', sum())), 'statable', 'one currency on each side is comparable');

// The defensive arm. Reached only if a future row shape lets a code past the
// hole counts with a pot missing; without it the amounts would be read off an
// undefined and printed as a figure.
eq(whyAgainst(spendAgainstReturn('ready', sum({ earned: [] }))), 'cross', 'a missing pot refuses rather than reading off nothing');
eq(whyAgainst(spendAgainstReturn('ready', sum({ spent: [] }))), 'cross', 'from either side');
eq(whyAgainst(spendAgainstReturn('ready', sum({
  spent: [{ currency: 'GBP', minorUnits: 40000, count: 1 }],
  earned: [{ currency: 'AED', minorUnits: 40000, count: 1 }],
}))), 'cross', 'and two pots that do not match are refused rather than subtracted');

/* ── what the statable case actually carries ────────────────────────────── */

const good = spendAgainstReturn('ready', sum({ codes: 3 }));
eq(good.statable, true, 'a clean set states a comparison');
eq(good.statable ? good.currency : '', 'GBP', 'in the currency both sides are in');
eq(good.statable ? good.spentMinor : -1, 40000, 'carrying the spend');
eq(good.statable ? good.earnedMinor : -1, 125000, 'and the revenue');
eq(good.statable ? good.codes : -1, 3, 'and how many codes it is over');

/* ── the sentence, and its three arms ───────────────────────────────────── */

const up = againstLine(spendAgainstReturn('ready', sum({ codes: 3 })));
ok(/GBP 400\.00/.test(up), 'the spend is written out in its own currency');
ok(/GBP 1,250\.00/.test(up), 'and so is what those clients paid, with a thousands separator');
ok(/3 codes/.test(up), 'and the sentence says how many codes it covers');
ok(/GBP 850\.00 more than they cost/.test(up), 'and states the difference as a positive amount of money');

const down = againstLine(spendAgainstReturn('ready', sum({
  spent: [{ currency: 'GBP', minorUnits: 125000, count: 1 }],
  earned: [{ currency: 'GBP', minorUnits: 40000, count: 1 }],
})));
ok(/GBP 850\.00 less than they cost/.test(down), 'a loss is worded, not signed');
ok(!/-/.test(down), 'because a minus sign in a grey line is the easiest thing on a screen to miss');

const level = againstLine(spendAgainstReturn('ready', sum({
  spent: [{ currency: 'GBP', minorUnits: 40000, count: 1 }],
  earned: [{ currency: 'GBP', minorUnits: 40000, count: 1 }],
})));
ok(/exactly what they cost/.test(level), 'breaking even is neither more nor less and is said as itself');
ok(!/more than/.test(level) && !/less than/.test(level), 'and is not rounded into either');

// One minor unit either side of breaking even. The smallest difference that is
// a difference has to take the right arm: a channel a penny ahead is ahead, and
// a threshold set anywhere above zero would call it a loss.
const barelyUp = againstLine(spendAgainstReturn('ready', sum({
  spent: [{ currency: 'GBP', minorUnits: 40000, count: 1 }],
  earned: [{ currency: 'GBP', minorUnits: 40001, count: 1 }],
})));
ok(/GBP 0\.01 more than they cost/.test(barelyUp), 'a single minor unit ahead is ahead, not level and not behind');
const barelyDown = againstLine(spendAgainstReturn('ready', sum({
  spent: [{ currency: 'GBP', minorUnits: 40001, count: 1 }],
  earned: [{ currency: 'GBP', minorUnits: 40000, count: 1 }],
})));
ok(/GBP 0\.01 less than they cost/.test(barelyDown), 'and a single minor unit behind is behind');

// One code is "code", not "codes". A count that disagrees with its own noun is
// the tell that a screen is generated rather than written.
ok(/1 code,/.test(againstLine(spendAgainstReturn('ready', sum({ codes: 1 })))), 'one code is singular');

eq(againstLine({ statable: false, why: 'unread', note: 'the read failed.' }), 'the read failed.',
  'a refusal renders its own reason rather than a sentence about money');

// The last guard: an amount that cannot be written out is withheld whole rather
// than printed around a hole, which reads as a broken screen rather than as
// missing data.
ok(/could not be written out/.test(againstLine({ statable: true, currency: '', spentMinor: 1, earnedMinor: 2, codes: 1 })),
  'an amount with no currency on it is withheld, not printed bare');

// money() renders NaN as "GBP NaN" — a broken screen wearing a currency code —
// and every amount here is a sum or a subtraction over pots, so a non-finite
// one is exactly what a fault upstream produces. Either side alone is enough to
// withhold the sentence.
ok(/could not be written out/.test(againstLine({ statable: true, currency: 'GBP', spentMinor: NaN, earnedMinor: 200, codes: 1 })),
  'an unwritable spend withholds the whole sentence');
ok(/could not be written out/.test(againstLine({ statable: true, currency: 'GBP', spentMinor: 200, earnedMinor: NaN, codes: 1 })),
  'and so does an unwritable revenue, on its own');

/* ── an empty list means four different things ──────────────────────────── */

ok(/could not be read/.test(channelEmptyLine('error')), 'a failed read says so');
ok(!/no named codes/.test(channelEmptyLine('error')), 'and never that none of the coach’s codes worked');
ok(/more codes on record/.test(channelEmptyLine('partial')), 'a truncated read says nothing here is a count');
eq(channelEmptyLine('loading'), 'Still reading.', 'a read in flight claims nothing at all');
ok(/no named codes yet/.test(channelEmptyLine('ready')), 'and only a completed read says the coach has none');

/* ── the headcount, which is a count and is gated like one ──────────────── */

for (const s of STATUSES) {
  eq(channelReachLine(s, sum({ codes: 2, clients: 9, stayed: 7 })), '', `a ${s} read states no headcount`);
}
eq(channelReachLine('ready', sum({ codes: 0, clients: 0, stayed: 0 })), '', 'and nor does a coach with no channels');

const none = channelReachLine('ready', sum({ codes: 2, clients: 0, stayed: 0 }));
ok(/Nobody has come in/.test(none), 'a completed read over live codes that brought nobody says so');
ok(/on your roster and in none of these figures/.test(none), 'and still says the list is not the whole roster');

const some = channelReachLine('ready', sum({ codes: 2, clients: 9, stayed: 7 }));
ok(/9 people came in/.test(some), 'the headcount is people, once each');
ok(/7 of them are still with you/.test(some), 'and how many of them stayed, which is the half a join count cannot answer');
ok(/on your roster and in none of these figures/.test(some), 'and the roster caveat is on every arm, not only the empty one');

const all = channelReachLine('ready', sum({ codes: 1, clients: 4, stayed: 4 }));
ok(/all of them are still with you/.test(all), 'nobody having left is said as itself rather than as four of four');
ok(/4 people/.test(all), 'with the headcount still stated');

const one = channelReachLine('ready', sum({ codes: 1, clients: 1, stayed: 0 }));
ok(/1 person came in/.test(one), 'one client is a person, not people');
ok(/0 of them are still with you/.test(one), 'and a client who has left is not rounded up to one who stayed');
// The other side of that agreement: one who DID stay is "is", not "are".
ok(/1 of them is still with you/.test(channelReachLine('ready', sum({ codes: 1, clients: 3, stayed: 1 }))),
  'and a single client who stayed takes a singular verb');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachChannels: ok (every refusal asserted from both sides of its condition)');
