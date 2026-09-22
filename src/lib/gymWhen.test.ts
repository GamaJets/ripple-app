// A date is written in the reader's locale and the gym's zone.
// Compile with tsc, run with node.
//
// This suite runs under six timezones (`test:zones`), which is the only way the
// assertions below mean anything at all: the whole defect is that the runner's
// own zone was leaking into the answer, so a test that passes only under the
// machine it was written on would be testing nothing.
//
// The locale half is deliberately NOT asserted as a string. `en-GB` renders
// 1 September 2026 as "01/09/2026" and `en-US` as "9/1/2026", and pinning
// either would be pinning the very thing this module refuses to decide. What is
// pinned instead is the property that survives every locale: the same instant,
// read in two zones that are on different calendar days, produces two different
// dates, and the one drawn for the gym matches the gym's own day.
import {
  gymWhenDate, gymWhenDateTime, gymWhenTime,
  gymDateText, gymDateTimeText, gymTimeText,
  calendarDateText, drawnAtGym, whoseClockNote, NO_ZONE_NOTE,
} from './gymWhen';
import { gymDay, gymTimeLabel } from './gymZone';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the case the module exists for ────────────────────────────────────── */

// 21:30 UTC on 31 August 2026. In Dubai (UTC+4) that is 01:30 on 1 SEPTEMBER;
// in Los Angeles it is 14:30 on 31 August. One instant, two months.
const MONTH_EDGE = '2026-08-31T21:30:00.000Z';

eq(gymDay(MONTH_EDGE, 'Asia/Dubai'), '2026-09-01', 'the instant is September at the Dubai gym');
eq(gymDay(MONTH_EDGE, 'Europe/London'), '2026-08-31', 'and August in London');

{
  // Numeric parts only, so the assertion holds whatever the runner's locale
  // orders them as. This is the accountant's line: the same payment, on the
  // same screen, filed in two different months.
  const dubai = gymDateText(MONTH_EDGE, 'Asia/Dubai') ?? '';
  const london = gymDateText(MONTH_EDGE, 'Europe/London') ?? '';
  ok(dubai !== london, 'the same instant renders as two different dates in two zones');
  ok(/\b0?9\b/.test(dubai), `the Dubai gym's date carries month 9 — got ${dubai}`);
  ok(/\b0?8\b/.test(london), `the London gym's date carries month 8 — got ${london}`);
  ok(/2026/.test(dubai) && /2026/.test(london), 'both carry the year');
}

// And it does not matter where the reader is. This is the assertion `test:zones`
// makes worth having: the answer is a function of the GYM's zone and the
// instant, and of nothing else about the machine.
eq(gymDateText(MONTH_EDGE, 'Asia/Dubai'), gymDateText(MONTH_EDGE, 'Asia/Dubai'),
  'the same question twice gives the same answer');
{
  // Derived from gymZone's own day arithmetic rather than restated, so the two
  // modules cannot drift into disagreeing about what day it is at the gym.
  for (const z of ['Asia/Dubai', 'Europe/London', 'America/Los_Angeles', 'Pacific/Auckland', 'UTC']) {
    const day = gymDay(MONTH_EDGE, z) ?? '';
    const [y, m, d] = day.split('-');
    const text = gymDateText(MONTH_EDGE, z) ?? '';
    ok(text.includes(y), `${z}: the rendered date carries the gym's own year`);
    ok(new RegExp(`\\b0?${Number(m)}\\b`).test(text), `${z}: and the gym's own month — ${text} vs ${day}`);
    ok(new RegExp(`\\b0?${Number(d)}\\b`).test(text), `${z}: and the gym's own day — ${text} vs ${day}`);
  }
}

/* ── the time half, which is where the four hours actually go ──────────── */

{
  for (const z of ['Asia/Dubai', 'Europe/London', 'America/Los_Angeles']) {
    const label = gymTimeLabel(MONTH_EDGE, z) ?? '';
    const [hh, mm] = label.split(':');
    const text = gymTimeText(MONTH_EDGE, z, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) ?? '';
    ok(text.includes(hh) && text.includes(mm), `${z}: the clock reads ${label}, rendered ${text}`);
  }
}

/* ── no zone means the reader's clock, and it says so ──────────────────── */

ok(drawnAtGym('Asia/Dubai'), 'a real zone is a zone');
ok(!drawnAtGym(null), 'a missing one is not');
ok(!drawnAtGym(''), 'nor is an empty string');
// The two gymZone already refuses, and for the reasons it gives: an offset
// stops being right when the clocks move, and a bare abbreviation is a FIXED
// offset that never moves at all.
ok(!drawnAtGym('+04:00'), 'an offset is not a place');
ok(!drawnAtGym('EST'), 'and an abbreviation is a fixed offset pretending to be one');

eq(whoseClockNote('Asia/Dubai'), null, 'a gym with a zone needs no caveat');
eq(whoseClockNote(null), NO_ZONE_NOTE, 'a gym without one gets the shared sentence');
eq(whoseClockNote('EST'), NO_ZONE_NOTE, 'and so does a gym whose stored value cannot be drawn in');

{
  const w = gymWhenDate(MONTH_EDGE, 'Asia/Dubai');
  ok(w != null && w.atGym, 'a rendered date knows it is the gym’s own');
  const r = gymWhenDate(MONTH_EDGE, null);
  ok(r != null && !r.atGym, 'and one drawn without a zone knows it is not');
  ok((r?.text ?? '').length > 0, 'but still draws something — refusing every date on every screen is not a fix');
}

/* ── nothing is not a date ─────────────────────────────────────────────── */

eq(gymWhenDate(null, 'Asia/Dubai'), null, 'null is not a date');
eq(gymWhenDate(undefined, 'Asia/Dubai'), null, 'nor is undefined');
eq(gymWhenDate('', 'Asia/Dubai'), null, 'nor is an empty string');
eq(gymWhenDate('not a date', 'Asia/Dubai'), null, 'and an unparseable string renders nothing');
eq(gymDateText('not a date', 'Asia/Dubai'), null,
  'never the words "Invalid Date", which is what toLocaleDateString would have put in the cell');

/* ── the three shapes carry what they say they carry ───────────────────── */

{
  // The trap in the migration: `Intl.DateTimeFormat` with no options gives a
  // DATE and no time, while `toLocaleString()` gives both. A helper that
  // forgot that would have dropped the time off every timestamp in the console
  // and nothing would have failed.
  const dt = gymDateTimeText(MONTH_EDGE, 'Asia/Dubai') ?? '';
  const d = gymDateText(MONTH_EDGE, 'Asia/Dubai') ?? '';
  const t = gymTimeText(MONTH_EDGE, 'Asia/Dubai') ?? '';
  ok(dt.length > d.length, `the date-and-time form carries more than the date — ${dt} vs ${d}`);
  ok(/[0-9]/.test(t) && t.length < dt.length, `and the time form carries less — ${t}`);
  ok(!/:/.test(d), `while the date form carries no clock at all — ${d}`);
  ok(/:/.test(dt), `and the date-and-time form does — ${dt}`);
}

{
  // A caller that asks for components gets those components and no others —
  // the default is filled in only where nothing was asked for.
  const only = gymDateText(MONTH_EDGE, 'Asia/Dubai', { year: 'numeric' }) ?? '';
  eq(only.trim(), '2026', 'asking for a year alone gives a year alone');
}

{
  // The gym's zone cannot be overridden per call. A caller passing its own
  // timeZone is exactly how one screen ends up on a different clock from the
  // rest, which is the defect this module was written to end.
  const forced = gymDateText(MONTH_EDGE, 'Asia/Dubai', { timeZone: 'America/Los_Angeles' } as Intl.DateTimeFormatOptions) ?? '';
  eq(forced, gymDateText(MONTH_EDGE, 'Asia/Dubai'), 'a per-call timeZone is ignored — the gym’s zone wins');
}

/* ── a calendar date is not an instant ─────────────────────────────────── */

{
  // The whole point: the same three numbers come back out, whatever zone the
  // runner is in and whatever zone the gym is in. Under `test:zones` this file
  // runs from Kiritimati (+14) to Midway (-11), which is a 25-hour spread — a
  // local-midnight parse would land on a different day at one of the ends.
  const t = calendarDateText('2026-09-06') ?? '';
  ok(/\b0?9\b/.test(t), `month 9 survives — got ${t}`);
  ok(/\b0?6\b/.test(t), `day 6 survives — got ${t}`);
  ok(/2026/.test(t), `and the year — got ${t}`);

  eq(calendarDateText('2026-09-06', { month: 'long', year: 'numeric' })?.includes('2026'), true,
    'and a month-and-year label carries its year');

  // The first of a month is where a local-midnight parse loses a whole month
  // for a reader east of the gym. Asserted separately because it is the label
  // the sessions and payroll pickers print.
  const jan = calendarDateText('2026-01-01', { month: 'numeric', year: 'numeric' }) ?? '';
  ok(/\b0?1\b/.test(jan) && /2026/.test(jan), `1 January stays January 2026 — got ${jan}`);
  const dec = calendarDateText('2026-12-31', { month: 'numeric', day: 'numeric' }) ?? '';
  ok(/\b12\b/.test(dec) && /\b31\b/.test(dec), `31 December stays 31 December — got ${dec}`);

  // A caller that asks for ONE component gets that component and not the whole
  // date with it. Every assertion above happens to name two or three parts, and
  // the default set is exactly year-month-day — so with the defaults wrongly
  // merged back in they all still pass, and the month-heading case is the only
  // shape that can tell the difference.
  const heading = calendarDateText('2026-03-04', { month: 'short' }) ?? '';
  ok(heading.length > 0, 'a month-only label is drawn');
  ok(!/2026/.test(heading), `a caller asking only for a month gets no year bolted on — got ${heading}`);
  ok(!/\b0?4\b/.test(heading), `nor the day — got ${heading}`);

  // And the other direction, so this is a statement about what the caller asked
  // for rather than about short months: asking for nothing gets the full
  // default date.
  const whole = calendarDateText('2026-03-04') ?? '';
  ok(/2026/.test(whole) && /\b0?3\b/.test(whole) && /\b0?4\b/.test(whole),
    `a caller asking for nothing gets the whole date — got ${whole}`);
}

eq(calendarDateText(null), null, 'nothing is not a calendar date');
eq(calendarDateText('2026-09'), null, 'and neither is half of one');
eq(calendarDateText('2026-09-06T10:00:00Z'), null,
  'and neither is an instant — that is what gymWhenDate is for, and it needs the gym’s zone');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('gymWhen: ok');
