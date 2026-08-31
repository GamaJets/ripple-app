// A standing appointment. Compile with tsc, run with node.
//
// One assertion in here matters more than all the others and it is the reason
// the file exists: ENDING A SERIES MUST NEVER CHARGE. The obvious
// implementation of "stop this repeating" is a loop over the future occurrences
// calling the ordinary cancellation, and on a year-long arrangement that bills
// somebody a late-cancellation fee for every session in the horizon — for a
// decision they took two months in advance. So `charges` on the series option
// is swept across every policy, every notice window and every distance from the
// session below, and it has to come back false every single time.
//
// The mirror of it is asserted just as hard: cancelling ONE occurrence must
// still cost exactly what an ordinary cancellation costs, and must still say it
// affects one session. A rule that made the series safe by making the single
// cancellation free would have moved the bug rather than fixed it.
import {
  DOW_NAMES, RECURRING_CLASH_NOTE, RECURRING_CREDIT_NOTE, RECURRING_END_RULE,
  SERIES_HORIZON_DAYS, cancelOptions, clashLine, clockLabel, createdLine,
  occurrenceDetail, seriesDates, seriesDetail, seriesLabel, shapeSeries,
  type RawSeries,
} from './recurring';
import type { CancellationPolicy } from './booking';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-09-01T06:00:00Z');
const inWindow = new Date(NOW + 3 * 3_600_000).toISOString();   // 3 hours away
const farOff = new Date(NOW + 30 * 24 * 3_600_000).toISOString(); // a month away

const policy = (over: Partial<CancellationPolicy> = {}): CancellationPolicy => ({
  applies: true, noticeHours: 24, fee: 40, currency: 'NZD', ...over,
});

const pick = (opts: ReturnType<typeof cancelOptions>, scope: 'occurrence' | 'series') => {
  const o = opts.find((x) => x.scope === scope);
  if (!o) throw new Error(`no ${scope} option`);
  return o;
};

/* ── THE RULE: ending a series never charges ──────────────────────────────── */

// Every combination that could possibly make somebody think a fee is due:
// inside the window, outside it, a live policy, a dead one, an unpriced one, an
// unreadable one, one session on the books and fifty-two.
let sweep = 0;
for (const startsAt of [inWindow, farOff, new Date(NOW - 600_000).toISOString()]) {
  for (const p of [
    policy(),
    policy({ applies: false, fee: null }),
    policy({ fee: null }),
    policy({ noticeHours: 168 }),
    policy({ fee: 250, currency: 'GBP' }),
    null,
  ]) {
    for (const upcoming of [0, 1, 2, 8, 52]) {
      const opts = cancelOptions({ startsAt, policy: p, upcoming, now: NOW });
      const series = pick(opts, 'series');
      sweep++;
      ok(series.charges === false,
        `ending a series charged with policy ${JSON.stringify(p)} at ${startsAt} over ${upcoming} sessions`);
      ok(series.verdict === null,
        'ending a series carries no fee verdict — there is no fee to have a verdict about');
      // It removes the LATER ones, never the one in front of them. This is the
      // second half of the rule: the next session stays booked so that if it
      // also has to go, it goes through the ordinary cancellation and is priced
      // once, on its own.
      eq(series.affects, Math.max(0, upcoming - 1),
        'ending a series affects every occurrence except the next one');
      // It may say the word "charged" — it says nothing IS charged. What it
      // must never contain is an amount or a currency, because quoting one on
      // the button that costs nothing is how somebody taps the other one.
      ok(!/fee of|[$£€]|NZD|GBP|AED|USD/.test(series.detail),
        'and the sentence for it quotes no amount and no currency');
    }
  }
}
ok(sweep === 90, `the sweep covered ${sweep} combinations, not the 90 it was written for`);

// Said in prose as well, because the thing most likely to go wrong is that
// somebody rewrites the screen and the promise drifts from what part 135 does.
ok(/never charges a cancellation fee/i.test(RECURRING_END_RULE), 'the rule says plainly that ending charges nothing');
ok(/however much notice is left/i.test(RECURRING_END_RULE), 'and that the notice window does not change that');
ok(/next session stays booked/i.test(RECURRING_END_RULE), 'and that the next session survives it');

/* ── The mirror: one occurrence is still an ordinary cancellation ─────────── */

{
  const opts = cancelOptions({ startsAt: inWindow, policy: policy(), upcoming: 8, now: NOW });
  const one = pick(opts, 'occurrence');
  eq(one.charges, true, 'cancelling one occurrence inside the window still records the fee');
  eq(one.affects, 1, 'and affects exactly one session, never the size of the series');
  eq(one.verdict?.kind, 'fee', 'and carries the ordinary fee verdict');
  ok(/40/.test(one.detail), 'and names the amount the coach set');
  // The two options must not be the same object dressed differently.
  ok(one.charges !== pick(opts, 'series').charges,
    'the two choices are priced differently — that difference IS the feature');
}
{
  const one = pick(cancelOptions({ startsAt: farOff, policy: policy(), upcoming: 8, now: NOW }), 'occurrence');
  eq(one.charges, false, 'outside the window one occurrence costs nothing either');
  eq(one.verdict?.kind, 'in-time', 'and says why');
}
// A policy that applies with no amount behind it, and a policy that could not be
// read, are both inside the window and neither produces a row. Reporting them as
// charged would print a figure nobody chose; reporting them as free would tell
// somebody they owe nothing when they might.
{
  const unpriced = pick(cancelOptions({ startsAt: inWindow, policy: policy({ fee: null }), upcoming: 4, now: NOW }), 'occurrence');
  eq(unpriced.charges, false, 'an unpriced policy records no fee, because the server writes none');
  eq(unpriced.verdict?.kind, 'unpriced', 'but it is not reported as "no policy" either');
  ok(/ask them/i.test(unpriced.detail), 'and the client is told to ask rather than shown a number');

  const unknown = pick(cancelOptions({ startsAt: inWindow, policy: null, upcoming: 4, now: NOW }), 'occurrence');
  eq(unknown.charges, false, 'an unreadable policy records no fee');
  eq(unknown.verdict?.kind, 'unknown', 'and is not silently downgraded to "no fee"');
  ok(/couldn’t read/i.test(unknown.detail), 'and says so');
}
// A session already in progress is inside the window and is priced. Getting
// this wrong hands somebody their slot back while their coach stands in an
// empty gym — the distinction part 126 spells out between `insideNoticeWindow`
// and `isLateCancellation`.
{
  const started = pick(cancelOptions({
    startsAt: new Date(NOW - 600_000).toISOString(), policy: policy(), upcoming: 3, now: NOW,
  }), 'occurrence');
  eq(started.charges, true, 'a session that has already started is inside the notice window');
}

// Every branch of the single-cancellation sentence says the arrangement itself
// survives. That is the sentence that stops somebody tapping the wrong button.
for (const kind of ['in-time', 'no-policy', 'unknown', 'unpriced'] as const) {
  const line = occurrenceDetail({ kind } as any, 24);
  ok(/rest of the standing appointment is untouched/i.test(line),
    `the '${kind}' sentence says the series survives`);
}
ok(/rest of the standing appointment is untouched/i.test(
  occurrenceDetail({ kind: 'fee', amount: 40, currency: 'NZD' }, 24)),
  "the 'fee' sentence says it too");
// Repple records the fee and does not take it. A member who thinks the app has
// charged them will not pay their coach.
ok(/Repple doesn’t take this payment/.test(occurrenceDetail({ kind: 'fee', amount: 40, currency: 'NZD' }, 24)),
  'and the fee sentence says who actually collects it');

/* ── No hardcoded money, anywhere ─────────────────────────────────────────── */

// White-label means per-tenant currency. A fee printed in a currency this file
// chose would be a different number to the reader, not a formatting slip.
{
  const nzd = occurrenceDetail({ kind: 'fee', amount: 40, currency: 'NZD' }, 24);
  const gbp = occurrenceDetail({ kind: 'fee', amount: 40, currency: 'GBP' }, 24);
  ok(nzd !== gbp, 'the same amount in two currencies reads differently');
  const none = occurrenceDetail({ kind: 'fee', amount: 40, currency: null }, 24);
  ok(/\b40\b/.test(none) && !/[$£€]/.test(none),
    'an unknown currency prints the bare figure and invents no symbol');
  // Inventing no symbol was only ever half of it. This sentence is prose, not a
  // slot with a heading over it, so a naked 40 is an amount in whatever money
  // the reader happens to think in — the failure money() withholds an amount to
  // avoid. The bare figure is allowed here because the clause below is what
  // makes it honest, and this is the assertion that notices if it goes missing.
  ok(/currency/i.test(none), 'and the sentence says the currency was never set, rather than leaving 40 to be read as anything');
  ok(!/currency/i.test(nzd) && !/currency/i.test(gbp),
    'while a fee in a currency the gym did choose carries no such clause');
}
ok(!/AED|USD|\$/.test(RECURRING_END_RULE + RECURRING_CREDIT_NOTE + RECURRING_CLASH_NOTE),
  'none of the standing sentences names a currency');

/* ── Credits are not drawn eight weeks in advance ─────────────────────────── */

ok(/doesn’t draw credits/i.test(RECURRING_CREDIT_NOTE), 'the credit note says a series does not draw a pack down');
ok(/settles/i.test(RECURRING_CREDIT_NOTE), 'and says who does settle it');

/* ── A clash skips a date, it does not sink the series ────────────────────── */

eq(clashLine(0, []), null, 'nothing clashed, so no line is drawn at all');
eq(clashLine(0, ['2026-09-08']), null, 'and a stray date with a zero count draws nothing either');
{
  const line = clashLine(1, ['2026-09-08']);
  ok(!!line && /1 date was skipped/.test(line), 'one clash reads as one');
  ok(!!line && /2026-09-08/.test(line), 'and names the date, because the coach has to place it by hand');
  ok(!!line && /Everything else was created/.test(line),
    'and says the rest went in — a clash is not a failure of the arrangement');
}
ok(/2 dates were skipped/.test(clashLine(2, ['a', 'b']) ?? ''), 'two clashes read as two');
ok(/skipped rather than double-booked/i.test(RECURRING_CLASH_NOTE), 'the clash note states the policy');

eq(createdLine(0), null, 'nothing created says nothing, rather than announcing a success it did not have');
ok(/1 session booked/.test(createdLine(1) ?? ''), 'one occurrence reads as one');
ok(/8 sessions booked/.test(createdLine(8) ?? ''), 'eight read as eight');
ok(/next 8 weeks/.test(createdLine(8) ?? ''), 'and the horizon is the one the server actually uses');
eq(SERIES_HORIZON_DAYS, 56, 'the horizon matches run_session_series_materialiser’s default');

/* ── Reading a series back ────────────────────────────────────────────────── */

const raw = (over: Partial<RawSeries> = {}): RawSeries => ({
  id: 's1', trainer_id: 't1', client_id: 'c1', client_name: 'Ana',
  dow: 2, hour: 7, minute: 0, duration_min: 60, tz: 'Pacific/Auckland',
  starts_on: '2026-09-01', ends_on: null, status: 'active',
  upcoming: 8, next_at: '2026-08-31T19:00:00+00:00', ...over,
});

eq(shapeSeries(null).length, 0, 'no rows shape to no series');
eq(shapeSeries([]).length, 0, 'and an empty read is empty, not a crash');
{
  const shaped = shapeSeries([
    raw({ id: 'ended', status: 'ended', dow: 1 }),
    raw({ id: 'fri', dow: 5, hour: 18, minute: 45 }),
    raw({ id: 'tue', dow: 2, hour: 7 }),
  ]);
  eq(shaped.length, 3, 'three rows shape');
  eq(shaped[0].id, 'tue', 'active before ended, then earliest in the week first');
  eq(shaped[1].id, 'fri', 'and Friday after Tuesday');
  eq(shaped[2].id, 'ended', 'an ended arrangement sorts last whatever day it was on');
  eq(shaped[0].active, true, 'active is a boolean, not a status string the screen has to know');
  eq(shaped[2].active, false, 'and ended is the other one');
}
// `count(*)::int` through a definer function has arrived as a string before, and
// a screen that prints `upcoming` would render "8" either way but compare wrong.
eq(shapeSeries([raw({ upcoming: '8' as any })])[0].upcoming, 8, 'a numeric string count is a number');
eq(shapeSeries([raw({ upcoming: null })])[0].upcoming, 0, 'an absent count is zero, not NaN');
eq(shapeSeries([raw({ client_name: '  ' })])[0].clientName, null,
  'a blank name is nothing to draw, not a row of spaces');
eq(shapeSeries([raw({ client_name: null })])[0].clientName, null,
  'and a client reading their own arrangement is handed null rather than their own name');
eq(shapeSeries([raw({ minute: 45 })])[0].minute, 45, 'quarter hours survive the shaping');

/* ── How it reads on the screen ───────────────────────────────────────────── */

eq(clockLabel(7, 0), '7:00 am', 'seven in the morning');
eq(clockLabel(18, 45), '6:45 pm', 'quarter to seven in the evening');
eq(clockLabel(0, 0), '12:00 am', 'midnight is twelve, not zero');
eq(clockLabel(12, 30), '12:30 pm', 'and half past noon is pm');
eq(seriesLabel({ dow: 2, hour: 7, minute: 0 }), 'Every Tuesday at 7:00 am', 'the whole arrangement in one line');
eq(DOW_NAMES[0], 'Sunday', 'Sunday-first, matching Date.getDay() and extract(dow)');
eq(DOW_NAMES.length, 7, 'seven days');

/* ── The preview, in every zone the suite runs in ─────────────────────────── */

// TZ=America/Los_Angeles, Pacific/Auckland and Asia/Dubai all run this file.
// The assertions are about the reader's local clock, because that is what the
// preview is.
{
  const from = new Date(2026, 8, 1, 6, 0, 0); // 1 September 2026, local
  const dates = seriesDates(2, 7, 0, 8, from);
  eq(dates.length, 8, 'eight weeks of a weekly series is eight dates');
  ok(dates.every((d) => d.getDay() === 2), 'every one of them is a Tuesday, locally');
  ok(dates.every((d) => d.getHours() === 7 && d.getMinutes() === 0),
    'and every one is at seven in the morning — which is the daylight-saving assertion: '
    + 'stepping by seven days of MILLISECONDS would have produced a six or an eight');
  ok(dates.every((d, i) => i === 0 || d.getTime() > dates[i - 1].getTime()), 'in order');
  ok(dates[0].getTime() > from.getTime(), 'and the first is in the future');
}
{
  // The first candidate is today when today is the day and the hour has not
  // passed — a coach agreeing a Tuesday appointment on a Tuesday morning.
  const tuesdayEarly = new Date(2026, 8, 1, 5, 0, 0);
  eq(tuesdayEarly.getDay(), 2, 'the fixture really is a Tuesday');
  const dates = seriesDates(2, 7, 0, 2, tuesdayEarly);
  eq(dates[0].getDate(), 1, 'this morning still counts');
  // And is not, when it has.
  const tuesdayLate = new Date(2026, 8, 1, 9, 0, 0);
  ok(seriesDates(2, 7, 0, 2, tuesdayLate)[0].getDate() !== 1, 'an hour that has passed does not');
}
eq(seriesDates(2, 7, 0, 0, new Date(2026, 8, 1)).length, 0, 'zero weeks is zero dates');

/* ── The sentence for ending, at both ends of the count ───────────────────── */

ok(/nothing is removed and nothing is charged/i.test(seriesDetail(0, farOff)),
  'ending an arrangement with nothing after it removes nothing and says so');
ok(/removes 1 later session/.test(seriesDetail(1, farOff)), 'one later session reads as one');
ok(/removes 51 later sessions/.test(seriesDetail(51, farOff)), 'fifty-one read as fifty-one');
ok(/No cancellation fee is charged for any of them, however close they are/.test(seriesDetail(51, farOff)),
  'and the count does not change the price, which is nothing');
ok(/next session stays booked/i.test(seriesDetail(51, farOff)),
  'and the next one is explicitly said to survive, so nobody taps this meaning to cancel it');

// ── The promise that must not be made when there is nothing to promise ─────
//
// Every branch of this sentence used to end "The next session stays booked —
// cancel that one separately if you need to", including the branch for an
// arrangement with NOTHING on the books. There is no next session there: the
// horizon has not been written, or every occurrence was cancelled singly. A
// member reading it goes to their calendar for a Tuesday that is not on it,
// and the one sentence they were given to act on describes a session that does
// not exist. The caller's own screens hand this an empty string when they have
// no next occurrence (`s.nextAt ?? ''`), so the empty string is the case that
// actually reaches it.
for (const none of ['', '   ', null, undefined, 'next Tuesday'] as const) {
  const line = seriesDetail(0, none as any);
  ok(!/stays booked/i.test(line),
    `no next occurrence (${JSON.stringify(none)}) promises no surviving session`);
  ok(/no sessions on the books at all/i.test(line),
    'and says plainly that there are none, rather than implying one is left');
  ok(/nothing is removed and nothing is charged/i.test(line),
    'and still states the price, which is nothing');
}
// The mirror, so the fix cannot be "delete the sentence". A real next
// occurrence still gets the promise, at both ends of the count.
ok(/next session stays booked/i.test(seriesDetail(0, farOff)),
  'one session on the books and nothing after it: that one still survives, and is said to');
ok(/no sessions after this one/i.test(seriesDetail(0, farOff)),
  'and "after this one" is only said when there IS a this one');
ok(/next session stays booked/i.test(seriesDetail(3, inWindow)),
  'a next occurrence inside the notice window survives too — that is the whole point of it');
// Straight through `cancelOptions`, because that is what the screens call and
// the empty string is what they pass.
ok(!/stays booked/i.test(pick(cancelOptions({ startsAt: '', policy: policy(), upcoming: 0, now: NOW }), 'series').detail),
  'and the option built for a series with no next occurrence carries no such promise either');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`recurring: ok (${sweep} end-series combinations swept, none of them charged)`);
