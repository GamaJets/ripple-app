// src/lib/bodyRate.ts — the weekly rate, the window it needs, and the grain it
// is allowed to claim.
//
// Run under plain node. Add to tsconfig.test.json alongside its module, and to
// the `test` script in package.json:
//
//   "src/lib/bodyRate.ts", "src/lib/bodyRate.test.ts"
//   node .tmp/lib/bodyRate.test.js
import { rateOf, rateDecimals, rateGapNote, MIN_TREND_DAYS, type RatePoint } from './bodyRate';

let failed = 0;
function ok(cond: boolean, what: string): void {
  if (cond) { console.log(`  ok   ${what}`); return; }
  failed++;
  console.log(`  FAIL ${what}`);
}
function eq(a: unknown, b: unknown, what: string): void {
  ok(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b), `${what} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
function near(a: number | null | undefined, b: number, what: string): void {
  ok(a != null && Math.abs(a - b) < 1e-9, `${what} (got ${a}, want ${b})`);
}

console.log('bodyRate — the window');

// ── nothing to rate ────────────────────────────────────────────────────────
eq(rateOf(null).gap, 'no-readings', 'a null list has no rate');
eq(rateOf([]).gap, 'no-readings', 'and neither has an empty one');
eq(rateOf(null).rate, null, 'and the rate itself is null, never 0');
eq(rateOf([{ at: '2026-05-04', value: 84 }]).gap, 'one-reading', 'one reading is not a rate');
eq(rateOf([{ at: '2026-05-04', value: 84 }]).days, null, 'and it reports no window — never 0, which would claim a same-day pair');

// ── the minimum window ─────────────────────────────────────────────────────
const sixDays: RatePoint[] = [{ at: '2026-05-04', value: 84.0 }, { at: '2026-05-10', value: 83.6 }];
eq(rateOf(sixDays).gap, 'too-short', 'six days apart is water, not a trend');
eq(rateOf(sixDays).rate, null, 'so no rate is produced at all');
eq(rateOf(sixDays).days, 6, 'but the window that WAS available is reported, so a screen can say how much longer');
ok(MIN_TREND_DAYS === 7, 'the threshold is goalTargets’ own, imported rather than re-declared');
const sevenDays: RatePoint[] = [{ at: '2026-05-04', value: 84.0 }, { at: '2026-05-11', value: 83.3 }];
ok(rateOf(sevenDays).rate != null, 'and exactly seven days is enough');
near(rateOf(sevenDays).rate?.perWeek, -0.7, 'a 0.7 kg loss over one week is −0.7 kg/week');

// ── the arithmetic ─────────────────────────────────────────────────────────
const month: RatePoint[] = [
  { at: '2026-05-04', value: 84.0 },
  { at: '2026-05-18', value: 83.1 },
  { at: '2026-06-01', value: 82.0 },
];
const m = rateOf(month);
near(m.rate?.perWeek, -0.5, '2.0 kg over 28 days is −0.5 kg/week');
eq(m.rate?.days, 28, 'the window is the whole span, not the last gap');
eq(m.rate?.points, 3, 'and the reading count travels with it');
eq(m.rate?.fromISO, '2026-05-04', 'the rate names the day it is measured from');
eq(m.rate?.toISO, '2026-06-01', 'and the day it is measured to');
near(rateOf([{ at: '2026-01-01', value: 20 }, { at: '2026-03-01', value: 20 }]).rate?.perWeek, 0,
  'a body that has not moved has a rate of exactly zero — which is a measurement, not an absence');
near(rateOf([{ at: '2026-01-01', value: 30.0 }, { at: '2026-02-26', value: 33.5 }]).rate?.perWeek, 0.4375,
  'and a gain is positive: 3.5 kg of muscle over 56 days');

// ── dates are calendar days, never UTC midnight ────────────────────────────
// A bare date and an ISO instant on the SAME local day must measure the same
// span. `Date.parse` on the bare date is UTC midnight, which would shorten the
// window by a day west of Greenwich and inflate the rate.
// The instant is BUILT from the local calendar day rather than written as a UTC
// string, so this fixture is 09:30 on 1 June wherever the runner is standing.
// A hardcoded `...T12:00:00Z` would be 2 June in Auckland and the test would be
// asserting the runner's timezone instead of the rule.
const june1LocalMorning = new Date(2026, 5, 1, 9, 30).toISOString();
const mixed: RatePoint[] = [
  { at: '2026-05-04', value: 84.0 },
  { at: june1LocalMorning, value: 82.0 },
];
ok(rateOf(mixed).rate != null, 'a bare date and a timestamp can bound the same window');
eq(rateOf(mixed).rate?.days, rateOf(month).rate?.days,
  'and they measure the same number of days as two bare dates would');

// ── a window nobody can measure ────────────────────────────────────────────
eq(rateOf([{ at: 'nonsense', value: 84 }, { at: '2026-06-01', value: 82 }]).gap, 'undated',
  'an unreadable end has no rate');
eq(rateOf([{ at: 'nonsense', value: 84 }, { at: '2026-06-01', value: 82 }]).rate, null,
  'and certainly not a rate of zero');
eq(rateOf([{ at: '2026-06-01', value: 82 }, { at: '2026-05-04', value: 84 }]).gap, 'undated',
  'a list handed over backwards is refused rather than reported with an inverted sign');

// ── values that are not values ─────────────────────────────────────────────
eq(rateOf([{ at: '2026-05-04', value: NaN }, { at: '2026-06-01', value: 82 }]).gap, 'one-reading',
  'a NaN reading is dropped, and one reading is left');
eq(rateOf([{ at: '2026-05-04', value: Infinity }, { at: '2026-06-01', value: 82 }]).gap, 'one-reading',
  'so is an infinite one');
ok(Number.isFinite(rateOf(month).rate!.perWeek), 'and a real rate is always finite');

console.log('bodyRate — the grain it may claim');

// One endpoint step spread over the weeks measured.
eq(rateDecimals(1, 14), 0, 'whole-pound weights over a fortnight earn whole pounds a week (±0.5 lb/wk)');
eq(rateDecimals(1, 70), 1, 'ten weeks of them earn a tenth (±0.1 lb/wk)');
eq(rateDecimals(0.1, 14), 1, 'tenth-of-a-kilogram weights over a fortnight earn a tenth');
eq(rateDecimals(0.1, 7), 1, 'over a single week the grain is exactly 0.1 kg/wk, which a tenth represents exactly');
eq(rateDecimals(0.1, 6), 0, 'and any window SHORTER than a week does not earn that tenth');
eq(rateDecimals(1, 13), 0, 'a grain of 0.54 lb/wk is coarser than a tenth, so it prints whole pounds');
eq(rateDecimals(0.01, 28), 2, 'a 0.01 kg segmental mass over four weeks earns two places');
eq(rateDecimals(0.1, 3650), 2, 'and the cap holds: ten years does not earn a thousandth off tenths');
eq(rateDecimals(1, 7), 0, 'never negative — a coarse rate is rounded to whole units, not to tens');
eq(rateDecimals(0, 28), 0, 'a nonsense step claims nothing');
eq(rateDecimals(0.1, 0), 0, 'and neither does a nonsense window');

console.log('bodyRate — what it says when it says nothing');

ok(rateGapNote('no-readings', null) === null,
  'a metric with no readings gets no rate sentence — it already has its own');
ok((rateGapNote('too-short', 6) ?? '').includes('1 more day'),
  'six days in, the sentence says one more day and says it in the singular');
ok((rateGapNote('too-short', 2) ?? '').includes('5 more days'),
  'two days in, five more — plural');
ok(rateGapNote('one-reading', null) != null, 'one reading gets a sentence of its own');
ok(rateGapNote('undated', null) != null, 'and so does an unreadable window');
ok(rateGapNote(null, 28) === null, 'and a metric that HAS a rate is told to say nothing');

console.log(failed ? `\n${failed} failed` : '\nbodyRate: all ok');
if (failed) process.exit(1);
