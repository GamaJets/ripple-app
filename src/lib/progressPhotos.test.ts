// How far apart two progress photographs are. Compile with tsc, run with node,
// under every zone the suite runs in — the assertions below are the reason the
// zone matters.
//
// ── what this file is about ───────────────────────────────────────────────
//
// `daysApart` used to be `Math.abs(Math.round((b - a) / 86400000))` over two
// instants, which counts elapsed 24-hour periods. Every caption printed beside
// its answer counts CALENDAR days: app/(client)/scans.tsx and
// app/(client)/compare.tsx both put `fmtFullDay` under each photograph, and
// `fmtFullDay` reads through `localDate`. So the interval and the two dates it
// sat between were measuring different quantities, and the disagreement shows
// on screen in both directions.
//
// Every pair below is built from LOCAL wall-clock times — `new Date(y, m, d, h)`
// and not a literal Z instant — so "10 August at 22:00" is the tenth of August
// at ten at night wherever the suite is run, and the expected calendar gap is
// the same number in Kiritimati, in UTC, in Midway and in Auckland. A literal
// `...T22:00:00Z` would be a different local day in half of those and the
// assertion would be asserting the timezone rather than the arithmetic.
import {
  daysApart,
  comparePair,
  sortOldestFirst,
  photosNote,
  missingFileCount,
  type ProgressPhoto,
} from './progressPhotos';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** An instant, named by the local wall clock it is. */
const at = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m - 1, d, h, min, 0, 0).toISOString();

/* ── the two failures, one in each direction ───────────────────────────── */

// Late one night and just after midnight the next: two and a half hours
// elapsed, so the elapsed-hours version said "Same day" — printed under two
// captions reading 10 Aug and 11 Aug.
eq(daysApart(at(2026, 8, 10, 22, 0), at(2026, 8, 11, 0, 30)), 1,
  'two photographs on consecutive nights are one day apart, not the same day');

// Monday morning and Tuesday evening: thirty-six hours elapsed, so the
// elapsed-hours version said "2 days apart" — printed under two captions
// exactly one day apart.
eq(daysApart(at(2026, 8, 10, 8, 0), at(2026, 8, 11, 20, 0)), 1,
  'Monday morning to Tuesday evening is one day, not two');

// And the same-day case it must not swallow: fourteen hours, one calendar day.
eq(daysApart(at(2026, 8, 10, 6, 0), at(2026, 8, 10, 20, 0)), 0,
  'two photographs taken the same day are the same day');

// A whole week, taken at opposite ends of the day so the elapsed count is
// 6.25 days and only calendar arithmetic gives 7.
eq(daysApart(at(2026, 8, 10, 20, 0), at(2026, 8, 17, 5, 0)), 7,
  'a week apart is seven days however the hours fall');

// Across a month boundary, and across the boundary a daylight-saving change
// falls on in several of the zones this runs in. Both sides are local
// midnights, so a 23- or 25-hour day costs exactly the one day it is.
eq(daysApart(at(2026, 3, 29, 9, 0), at(2026, 4, 5, 9, 0)), 7,
  'seven local days across a daylight-saving weekend are seven days');
eq(daysApart(at(2026, 8, 31, 9, 0), at(2026, 9, 1, 9, 0)), 1,
  'the last of the month to the first of the next is one day');

/* ── what the answer is not ────────────────────────────────────────────── */

// Never a direction: the two ids arrive in whatever order the member tapped.
eq(daysApart(at(2026, 8, 11, 20, 0), at(2026, 8, 10, 8, 0)), 1,
  'the later one first gives the same gap, not a negative one');

// Never a zero for "cannot say". `spanLabel` prints 0 as "Same day" and null as
// a dash, and those are different claims about two photographs.
eq(daysApart('2026-01-01T00:00:00Z', 'nonsense'), null,
  'an unreadable date has no gap — not zero, which would say they were taken together');
eq(daysApart('nonsense', '2026-01-01T00:00:00Z'), null, 'and the same the other way round');
eq(daysApart('', ''), null, 'two empty strings are not the same day');

/* ── behaviour that must not have changed ──────────────────────────────── */

const UID = 'fc0f5920-8063-47a8-92b0-94ea1d196cdd';
const ph = (id: string, takenAt: string, url: string | null = 'u'): ProgressPhoto =>
  ({ id, path: `${UID}/${id}.jpg`, takenAt, url, weightKg: null, bodyFatPct: null });

// The pair this feeds, still ordered by when the photographs were taken rather
// than by the order they were tapped in.
{
  const mixed = [ph('c', '2026-03-01T00:00:00Z'), ph('a', '2026-01-01T00:00:00Z'), ph('b', '2026-02-01T00:00:00Z')];
  const pair = comparePair(sortOldestFirst(mixed), ['c', 'a']);
  ok(pair !== null && pair.before.id === 'a' && pair.after.id === 'c',
    'before/after still follows the dates, not the taps');
  // 59 in every zone: whichever local day those two instants fall on, they fall
  // on the corresponding days of January and March, and the gap between them is
  // the same. This is the assertion src/lib/coverage.test.ts already makes, and
  // it holds unchanged — which is the point of checking it here.
  eq(pair?.days, 59, 'and the gap between them is the same 59 days it always was');
  ok(comparePair(mixed, ['a']) === null, 'one photo is still not a comparison');
  ok(comparePair(mixed, ['a', 'a']) === null, 'the same photo twice is still not a comparison');
  ok(comparePair(mixed, ['a', 'zz']) === null, 'a photo that is not there is still not a comparison');
}

// A pair whose gap cannot be read carries null rather than a number, and the
// two photographs are still returned — an unreadable date is not a reason to
// refuse the comparison.
{
  const bad = [ph('a', '2026-01-01T00:00:00Z'), ph('b', 'nonsense')];
  const pair = comparePair(bad, ['a', 'b']);
  ok(pair !== null, 'a pair with one unreadable date is still a pair');
  eq(pair?.days, null, 'and its gap is null rather than a number nobody can stand behind');
}

// Untouched, and asserted here so a change to this module cannot quietly take
// them with it.
eq(photosNote(null), null, 'not loaded yet still claims nothing');
eq(photosNote([]), null, 'loaded and empty still claims nothing either');
eq(photosNote([ph('a', '2026-01-01T00:00:00Z')]), '1 saved', 'one saved photo still says saved');
eq(missingFileCount(null), null, 'nothing loaded is still not zero missing');
eq(missingFileCount([ph('a', '2026-01-01T00:00:00Z', null)]), 1,
  'a row whose file would not sign still counts as missing');

if (errors.length) {
  console.error(`progressPhotos.test: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log('progressPhotos.test: all assertions passed');
