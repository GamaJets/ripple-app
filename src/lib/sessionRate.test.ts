// What one session was filed as being worth. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: `sessions.rate_cents` is an integer
// of minor units and the minor-unit factor is a property of the CURRENCY — 1,
// 100 or 1000. The same 4500 is ¥4,500, £45.00 and 4.500 Kuwaiti dinar, three
// figures two orders of magnitude apart. So a rate whose currency is null (every
// row written before supabase/parts/1010) has no readable amount at all, and the
// one thing this module must never do is print the bare integer or divide it by
// a hundred on the way past.
import { RATE_MEANING_NOTE, sessionRate } from './sessionRate';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── a rate with its unit on it ─────────────────────────────────────────── */

const gbp = sessionRate(4500, 'GBP');
eq(gbp.state, 'priced', 'a figure with a currency beside it can be read');
ok(/45/.test(gbp.amount ?? ''), 'and 4500 minor units of a hundredths currency is 45');
ok(/GBP/.test(gbp.amount ?? ''), 'named, never symbolised — this product is white-label');
eq(gbp.note, null, 'a real figure needs no apology under it');

/* ── the same integer, in three currencies, is three amounts ───────────── */
//
// The whole reason part 1010 exists. A hardcoded /100 gets one of these right
// and is out by a factor of a hundred on the other two.

const jpy = sessionRate(4500, 'JPY');
const kwd = sessionRate(4500, 'KWD');
eq(jpy.state, 'priced', 'a yen rate is still a rate');
ok(/4,?500/.test(jpy.amount ?? ''), 'a yen has no sen, so 4500 minor units is 4,500 yen and not 45');
ok(!/\./.test(jpy.amount ?? ''), 'and it is given no decimal places it has never had');
ok(/4\.500/.test(kwd.amount ?? ''), 'a dinar has a thousand fils, so the same integer is 4.500');
eq(new Set([gbp.amount, jpy.amount, kwd.amount]).size, 3,
  'one integer, three currencies, three different amounts — which is the whole argument for the column');

/* ── a figure whose unit was never recorded ─────────────────────────────── */
//
// Not a bare 4500, not 45.00, and above all not the gym's currency today —
// which is the relabelling part 1010 refused to backfill for exactly this
// reason: the only gym it would be wrong about is the gym that changed.

for (const missing of [null, undefined, '', '   ']) {
  const r = sessionRate(4500, missing);
  eq(r.state, 'unstated', `a rate with no currency (${JSON.stringify(missing)}) cannot be read`);
  eq(r.amount, null, 'so no amount is offered for it');
  ok(r.note != null, 'and the absence is explained rather than left blank');
  ok(!/4500|45\.00|45 /.test(r.note ?? ''), 'the note does not smuggle the figure back in');
}

/* ── no rate at all is not a rate of nothing ────────────────────────────── */

eq(sessionRate(null, 'GBP').state, 'none', 'an unpriced session is unpriced');
eq(sessionRate(undefined, 'GBP').state, 'none', 'and so is one whose column did not come back');
eq(sessionRate(null, 'GBP').amount, null, 'with no figure — never a zero, which would read as free');
eq(sessionRate(null, null).note, null,
  'and no sentence: most rows on this table are unpriced, and a line on every one of them trains a reader to skip the line that matters');

/* ── zero is a filing ───────────────────────────────────────────────────── */
//
// A comped hour was priced, at nought, on purpose. Collapsing it into 'none'
// would erase the difference between a session somebody decided was free and a
// session nobody has got to yet.

const free = sessionRate(0, 'GBP');
eq(free.state, 'priced', 'a session filed at nought was filed');
ok(/0/.test(free.amount ?? ''), 'and the nought is shown');

/* ── what PostgREST actually hands over ─────────────────────────────────── */

eq(sessionRate('4500', 'GBP').amount, gbp.amount, 'an integer that arrived as a string is the same rate');
eq(sessionRate('not a number', 'GBP').state, 'none',
  'and a value that is no number at all is no rate rather than a NaN on screen');

/* ── the standing line ──────────────────────────────────────────────────── */

ok(!/owe|pay now|due/i.test(RATE_MEANING_NOTE),
  'the note never turns a recorded rate into a debt — Repple takes no PT payment and has nowhere to settle one');
ok(/not a bill/i.test(RATE_MEANING_NOTE), 'and says so outright');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sessionRate: ok — one integer is three amounts, and a rate with no currency on it is shown as no amount at all');
