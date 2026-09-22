// Pausing a membership. Compile with tsc, run with node.
//
// Two failures this guards, and both cost a member something real: a freeze
// that never ends because nobody remembered to lift it, and a freeze that does
// not give back the days it took — which is a cancellation with extra steps.
import { freezeState, frozenDays, thawedEndsOn, freezeLine, freezeRefusal } from './membershipFreeze';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const f = (from: string | null, to: string | null) => ({ from, to });

/* ── where a membership stands, today ─────────────────────────────────────── */

eq(freezeState(null, '2026-06-10'), 'none', 'no freeze recorded is none');
eq(freezeState(f(null, null), '2026-06-10'), 'none', 'and so is a row with both dates empty');
eq(freezeState(f('2026-06-12', '2026-06-26'), '2026-06-10'), 'scheduled', 'a freeze in the future is scheduled');
eq(freezeState(f('2026-06-12', '2026-06-26'), '2026-06-20'), 'frozen', 'and inside it, frozen');
eq(freezeState(f('2026-06-12', '2026-06-26'), '2026-06-27'), 'thawed', 'and after it, thawed');

// Inclusive at BOTH ends. The last day of a freeze is a day the member could
// not train, so a member turned away on the 26th because the app called it
// thawed would be right to complain.
eq(freezeState(f('2026-06-12', '2026-06-26'), '2026-06-12'), 'frozen', 'the first day is inside the freeze');
eq(freezeState(f('2026-06-12', '2026-06-26'), '2026-06-26'), 'frozen', 'and so is the last');

// Half a range, a backwards range, and rubbish are all unreadable — and
// unreadable is never 'none'. A membership whose freeze could not be read must
// not be described as one that was never frozen: that is somebody's access to
// a building.
eq(freezeState(f('2026-06-12', null), '2026-06-20'), 'unreadable', 'half a range is unreadable');
eq(freezeState(f('2026-06-26', '2026-06-12'), '2026-06-20'), 'unreadable', 'a backwards range is not silently swapped');
eq(freezeState(f('12/06/2026', '2026-06-26'), '2026-06-20'), 'unreadable', 'another date format is not read as though it parsed');

/* ── the days, counted the way a member counts them ───────────────────────── */

eq(frozenDays(f('2026-06-12', '2026-06-12')), 1, 'a one-day freeze is one day, not zero');
eq(frozenDays(f('2026-06-12', '2026-06-26')), 15, 'the twelfth to the twenty-sixth is fifteen days');
eq(frozenDays(f('2026-06-26', '2026-06-12')), null, 'a backwards range counts nothing');
eq(frozenDays(null), null, 'and neither does no range at all');

// Across a month end and across a year end — the arithmetic walks calendar
// days through `addDays`, so neither is special.
eq(frozenDays(f('2026-01-30', '2026-02-02')), 4, 'a freeze across a month end counts the real days');
eq(frozenDays(f('2026-12-30', '2027-01-02')), 4, 'and so does one across a year end');
// A leap day is a day.
eq(frozenDays(f('2028-02-28', '2028-03-01')), 3, 'February 29th 2028 is counted');

/* ── the end date moves, which is the whole point ─────────────────────────── */

eq(thawedEndsOn('2026-06-30', f('2026-06-12', '2026-06-26')), '2026-07-15',
  'fifteen frozen days push a 30 June end date to 15 July');
eq(thawedEndsOn('2026-06-30', f('2026-06-12', '2026-06-12')), '2026-07-01',
  'and one frozen day moves it by one');

// An open-ended membership has no term to extend, and inventing one would sell
// somebody an end date nobody agreed.
eq(thawedEndsOn(null, f('2026-06-12', '2026-06-26')), null, 'an open-ended membership gains no end date');
// Moving an end date on a range we cannot read is worse than not moving it.
eq(thawedEndsOn('2026-06-30', f('2026-06-26', '2026-06-12')), null, 'a backwards range moves nothing');
eq(thawedEndsOn('2026-06-30', null), null, 'and no freeze moves nothing');

/* ── what somebody is told ────────────────────────────────────────────────── */

eq(freezeLine('none', {}), null, 'nothing to say about a membership that was never paused');
{
  const line = freezeLine('frozen', { to: '26 Jun', days: 15, newEndsOn: '15 Jul' }) ?? '';
  ok(/Paused until 26 Jun/.test(line), 'a frozen membership says when it lifts');
  ok(/by itself/.test(line), 'and that nobody has to do anything for it to');
  ok(/15 days are added back/.test(line), 'and that the days come back');
  ok(/runs to 15 Jul/.test(line), 'and where they push the end date to');
}
{
  const one = freezeLine('frozen', { to: '12 Jun', days: 1, newEndsOn: '1 Jul' }) ?? '';
  ok(/The day is added back/.test(one), 'one day is singular, not "1 days are"');
}
{
  // The unreadable sentence is the one that must never be silence.
  const line = freezeLine('unreadable', {}) ?? '';
  ok(line.length > 0, 'an unreadable freeze still says something');
  ok(/could not be read/.test(line), 'and says that is what happened');
  ok(/Ask the gym/.test(line), 'and sends them to somebody who can answer');
}

/* ── the two mistakes two dates can make ──────────────────────────────────── */

eq(freezeRefusal('2026-06-12', '2026-06-26', '2026-06-01'), null, 'an ordinary future pause is fine');
ok(/other order/.test(freezeRefusal('2026-06-26', '2026-06-12', '2026-06-01') ?? ''), 'backwards says so');
ok(/Pick both dates/.test(freezeRefusal('', '2026-06-26', '2026-06-01') ?? ''), 'a missing date is named as missing');
ok(/already passed/.test(freezeRefusal('2026-05-01', '2026-05-08', '2026-06-01') ?? ''),
  'a pause wholly in the past is refused rather than written to do nothing');
ok(/longer than a year/.test(freezeRefusal('2026-01-01', '2027-06-01', '2025-12-01') ?? ''),
  'and a pause longer than a year is told to be a cancellation instead');
// A pause that has started and not finished is still editable — refusing it
// would strand a member who wants theirs to end sooner.
eq(freezeRefusal('2026-06-01', '2026-06-30', '2026-06-15'), null, 'a pause already running can still be changed');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('membershipFreeze: ok (both ends inclusive, the days come back, and an unreadable pause is never silence)');
