// One hour of coaching, one figure, and three screens that must file it the
// same way. Compile with tsc, run with node.
//
// The bugs these guard:
//
//  1. A COACH WITH NO GYM AND NO RATE AT ALL. All three writers converted with
//     `tenant?.currency`, which is null for a self-employed coach, so every
//     session they delivered was filed with `rate_cents` unset — even after
//     part 940 let them say what they charge in. That is the defect.
//  2. THE THREE DISAGREEING. A half-converted snapshot is worse than a
//     consistently missing one: the same hour marked from the queue, from the
//     schedule and from the log screen would be worth three different things.
//     One function, one argument shape, called by all three.
//  3. A GYM COACH PRICING THEMSELVES. The coach's own column must stay dormant
//     wherever a gym answers — including a gym that has answered "I have not
//     chosen", which is the owner's to fix and not the coach's to route around.
//  4. NULL BECOMING ZERO. No currency is no snapshot. A zero in `rate_cents`
//     reads as "this session was free" and settles payroll short.
import { rateCentsToSnapshot, snapshotCurrency, snapshotFee, type RateSnapshotSource } from './rateSnapshot';
import type { MyCurrency } from './currencySource';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A resolved answer, the shape `fetchMyCurrency()` returns. */
const mine = (over: Partial<MyCurrency> = {}): MyCurrency =>
  ({ currency: null, from: null, gap: null, canSetOwn: false, ...over });
const src = (over: Partial<RateSnapshotSource> = {}): RateSnapshotSource =>
  ({ gymFee: null, ownFee: null, gymCurrency: null, mine: null, ...over });

/* ── the defect: a self-employed coach now gets a snapshot ────────────────── */

{
  // No gym anywhere, and part 940 has given them a currency of their own.
  const r = rateCentsToSnapshot(src({
    ownFee: 90, mine: mine({ currency: 'GBP', from: 'own' }),
  }));
  eq(r, 9000, 'a coach with no gym files their own rate in the currency they set');
}

eq(rateCentsToSnapshot(src({ ownFee: 6300, mine: mine({ currency: 'JPY', from: 'own' }) })), 6300,
  'yen has no minor unit — a ¥6,300 session is 6,300, not 630,000');
eq(rateCentsToSnapshot(src({ ownFee: 40, mine: mine({ currency: 'KWD', from: 'own' }) })), 40000,
  'a dinar has three places — a KWD 40 session is 40,000 fils, not 4,000');
eq(rateCentsToSnapshot(src({ ownFee: 90, mine: mine({ currency: '  gbp ', from: 'own' }) })), 9000,
  'the code is trimmed and upper-cased before it decides anything');

/* ── and this is what it did before, which must never come back ───────────── */

eq(rateCentsToSnapshot(src({ ownFee: 90, mine: null })), null,
  'the same coach with nothing resolved yet still files no rate at all');

/* ── the gym is the authority, and it is reached one step earlier ─────────── */

{
  const r = rateCentsToSnapshot(src({
    gymFee: 200, ownFee: 90, gymCurrency: 'AED', mine: mine({ currency: 'GBP', from: 'own' }),
  }));
  eq(r, 20000, 'a gym coach is filed at the gym’s fee in the gym’s currency');
}

eq(snapshotCurrency('AED', mine({ currency: 'GBP', from: 'own' })), 'AED',
  'an in-memory gym currency is never overridden by the coach’s own column');
eq(snapshotCurrency(null, mine({ currency: 'AED', from: 'gym' })), 'AED',
  'and a gym currency that only the fetched answer knows about is still taken');

{
  // The branch the whole precedence rule exists for. There IS a gym, its owner
  // has set nothing, and `resolveMyCurrency` therefore returns a null code with
  // gap 'gym-unset' — the coach's own column was never consulted. Nothing here
  // may consult it either: this coach is waiting on their owner.
  const r = rateCentsToSnapshot(src({ gymFee: 200, ownFee: 90, mine: mine({ gap: 'gym-unset' }) }));
  eq(r, null, 'a coach in a gym whose owner has chosen no currency files no rate');
}

/* ── every gap is a null, and none of them is a zero ──────────────────────── */

for (const gap of ['reading', 'unreadable', 'unavailable', 'nowhere', 'gym-unset', 'own-unset'] as const) {
  eq(rateCentsToSnapshot(src({ ownFee: 90, mine: mine({ gap }) })), null,
    `"${gap}" leaves the rate unwritten rather than writing a zero`);
}

eq(rateCentsToSnapshot(src({ ownFee: 90, gymCurrency: '   ' })), null,
  'whitespace is not a currency, so it is not a factor either');
eq(rateCentsToSnapshot(src({ gymCurrency: 'AED' })), null,
  'a currency with no fee behind it is still nothing to file');

/* ── the fee: the gym’s where there is one, and a stated zero is stated ───── */

eq(snapshotFee(200, 90), 200, 'a gym’s fee is what a gym coach’s session is worth');
eq(snapshotFee(null, 90), 90, 'and a coach with no gym fee is worth their own rate');
eq(snapshotFee(0, 90), 0,
  'a gym that states a fee of nothing has stated one — sessions inside a membership are a real arrangement');
eq(snapshotFee(null, null), null, 'nothing stated anywhere is nothing to convert');
eq(rateCentsToSnapshot(src({ gymFee: 0, gymCurrency: 'AED' })), 0,
  'and that stated zero is filed as a zero, which is not the same as no snapshot');

/* ── the three writers agree, because there is one function ───────────────── */

{
  // The same coach, the same hour, marked from each of the three screens. The
  // only thing that differs between them is which of the two fees they had in
  // hand, and `snapshotFee` is what makes that one answer.
  const queue = rateCentsToSnapshot(src({ gymFee: null, ownFee: 90, gymCurrency: null, mine: mine({ currency: 'GBP', from: 'own' }) }));
  const schedule = rateCentsToSnapshot(src({ gymFee: null, ownFee: 90, gymCurrency: null, mine: mine({ currency: 'GBP', from: 'own' }) }));
  const logScreen = rateCentsToSnapshot(src({ gymFee: null, ownFee: 90, gymCurrency: null, mine: mine({ currency: 'GBP', from: 'own' }) }));
  ok(queue === schedule && schedule === logScreen && queue === 9000,
    'the queue, the schedule and the log screen file the same session at the same figure');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('rateSnapshot: ok — one hour of coaching is worth one figure, whichever screen filed it');
