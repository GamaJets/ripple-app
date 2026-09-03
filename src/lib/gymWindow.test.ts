// Tests for gymWindow — whose clock a reporting period is cut on.
//
// ── What this is protecting ────────────────────────────────────────────────
//
// /tax and /accounting both printed "{firstDay} to {lastDay}, in the gym’s own
// timezone" over bounds built by `new Date(y, mo - 1, 1)` — the clock of
// whichever laptop was open. Those bounds are the filter on the takings, so two
// people exported two different quarters out of one database on the two screens
// whose entire purpose is a filing deadline.
//
// The assertions are of two kinds and both matter:
//
//   · the INSTANTS are the gym's. Asserted as absolute UTC strings, so this
//     file is worth the same under `npm run test:zones` — a test that agreed
//     with the device would be the bug written down as an expectation.
//   · the SENTENCE never outruns the basis. A period cut on the device may not
//     be captioned as the gym's, which is the half of the defect that made it
//     dangerous rather than merely wrong.
//
// Compile with tsc, run with node.
import { cutAtGym, type DayBounded } from './gymWindow';
import { NO_ZONE_NOTE } from './gymZone';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A window as `monthWindow` and `taxPeriod` hand one over. The instants are
 *  deliberately nonsense: nothing may read them when a zone is known. */
const win = (label: string, firstDay: string, lastDay: string): DayBounded => ({
  label, firstDay, lastDay,
  fromIso: '1999-01-01T00:00:00.000Z',
  toIso: '1999-01-01T00:00:00.000Z',
});

/* ── a gym four hours ahead ────────────────────────────────────────────────── */
{
  const at = cutAtGym(win('August 2026', '2026-08-01', '2026-08-31'), 'Asia/Dubai');
  eq(at.basis, 'gym', 'a gym with a zone gets its own clock');
  eq(at.window.fromIso, '2026-07-31T20:00:00.000Z',
    'August in Dubai starts at 20:00 UTC on 31 July, not at midnight UTC and not at midnight in London');
  eq(at.window.toIso, '2026-08-31T20:00:00.000Z',
    'and ends when the gym’s 1 September starts — exclusive, so a payment at that instant is September’s');
  ok(at.note.includes('Asia/Dubai'), 'the caption names the clock it used');
  ok(!at.note.includes(NO_ZONE_NOTE), 'and carries no caveat, because there is nothing to caveat');
  eq(at.window.firstDay, '2026-08-01', 'the calendar days are untouched — a date is a date in any zone');
  eq(at.window.lastDay, '2026-08-31', 'both of them');
}

/* ── a quarter containing a clock change ───────────────────────────────────── */
{
  // Q1 2026 in London: 1 January is GMT, 31 March is BST. Adding twenty-four
  // hours to the last day's midnight would end the quarter an hour late.
  const at = cutAtGym(win('Q1 2026', '2026-01-01', '2026-03-31'), 'Europe/London');
  eq(at.basis, 'gym', 'still the gym’s clock across a clock change');
  eq(at.window.fromIso, '2026-01-01T00:00:00.000Z', 'the quarter opens on GMT midnight');
  eq(at.window.toIso, '2026-03-31T23:00:00.000Z',
    'and closes on BST midnight — 23:00 UTC, which is what makes the last day 23 hours long rather than 24');
}

/* ── a gym that has not said, and one nobody could ask ─────────────────────── */
{
  for (const zone of [null, undefined, '', '   ', 'Mars/Olympus_Mons', 'GMT+4']) {
    const base = win('August 2026', '2026-08-01', '2026-08-31');
    const at = cutAtGym(base, zone);
    eq(at.basis, 'device', `${JSON.stringify(zone)} is not a zone this can cut a period on`);
    eq(at.window.fromIso, base.fromIso, 'so the bounds are left exactly as the caller built them');
    eq(at.window.toIso, base.toIso, 'both ends');
    ok(at.note.includes(NO_ZONE_NOTE),
      'and the caption says whose clock it is, in the one wording the rest of the console uses');
    ok(!/in the gym.s own timezone|cut on the gym/.test(at.note),
      'and never claims the gym’s — that claim over the device’s clock IS the defect');
  }
}

/* ── the window is copied, never edited in place ───────────────────────────── */
{
  const base = win('August 2026', '2026-08-01', '2026-08-31');
  const at = cutAtGym(base, 'Asia/Dubai');
  eq(base.fromIso, '1999-01-01T00:00:00.000Z',
    'the caller’s own window is untouched — a memoised `monthWindow` is shared, and mutating it would move a month under a second reader');
  ok(at.window !== base, 'the returned window is a new object');
}

/* ── extra fields survive ──────────────────────────────────────────────────── */
{
  // `TaxPeriod` carries `key` and `months` beyond `DayBounded`, and /tax reads
  // both off the value this returns.
  const base = { ...win('Q3 2026', '2026-07-01', '2026-09-30'), key: '2026-Q3', months: ['2026-07', '2026-08', '2026-09'] };
  const at = cutAtGym(base, 'Asia/Dubai');
  eq(at.window.key, '2026-Q3', 'a period keeps its key');
  eq(at.window.months.length, 3, 'and its months');
}

if (errors.length) {
  console.error(`gymWindow: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymWindow ok');
