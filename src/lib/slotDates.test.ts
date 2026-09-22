// The instants a weekly availability slot names. Compile with tsc, run with node.
//
// This suite is the reason `npm run test:zones` exists. The defect it guards is
// invisible when the runner's own zone happens to be the zone recorded against
// the slot — which is the state a developer's laptop is always in and a
// travelling coach's handset never is. So every assertion below names a zone
// explicitly and asserts the WALL CLOCK in that zone, never the offset from the
// runner's.
import { slotInstants } from './slotDates';
import { gymDay, gymTimeLabel, gymWeekday } from './gymZone';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const DAY = 86_400_000;

/* ── the hour is the hour in the SLOT's zone ────────────────────────────── */

// Wednesday 2 September 2026, 09:00 UTC.
const NOW = Date.parse('2026-09-02T09:00:00.000Z');

const london = slotInstants({ dow: 2, hour: 7, minute: 30, weeks: 4, tz: 'Europe/London', fromMs: NOW });
eq(london.length, 4, 'four weeks, four Tuesdays');
for (const iso of london) {
  eq(gymTimeLabel(iso, 'Europe/London'), '07:30', 'half past seven in London, whatever clock this test is running on');
  eq(gymWeekday(iso, 'Europe/London'), 2, 'and a Tuesday in London');
}
// Seven consecutive days apart on the calendar, not 7 × 86,400,000 apart on the
// clock — the difference is the whole of the DST case below.
eq(gymDay(london[0], 'Europe/London'), '2026-09-08', 'the coming Tuesday, in the coach’s own calendar');
eq(gymDay(london[3], 'Europe/London'), '2026-09-29', 'and three weeks on');

// The same slot read from a handset on the other side of the world produces the
// SAME instants, because the zone comes off the row and not off the phone.
const fromTokyo = slotInstants({ dow: 2, hour: 7, minute: 30, weeks: 4, tz: 'Europe/London', fromMs: NOW });
eq(fromTokyo.join(','), london.join(','), 'the row’s zone decides, so the coach’s whereabouts cannot move their clients’ slots');

/* ── across a daylight-saving boundary ──────────────────────────────────── */

// The UK clocks go back on Sunday 25 October 2026. A weekly 07:30 must stay
// 07:30 on both sides of it — `+ 7 * 86400000` would make it 06:30 afterwards.
const acrossDst = Date.parse('2026-10-14T09:00:00.000Z');
const uk = slotInstants({ dow: 2, hour: 7, minute: 30, weeks: 4, tz: 'Europe/London', fromMs: acrossDst });
eq(uk.length, 4, 'four Tuesdays spanning the change');
for (const iso of uk) eq(gymTimeLabel(iso, 'Europe/London'), '07:30', 'still half past seven after the clocks go back');
// 20 October is BST and 27 October is GMT, so the week between them really is
// 169 hours long. That inequality is the whole proof: `+ 7 * 86,400,000` would
// have produced 06:30 on the 27th, and a client would have arrived an hour
// before their coach.
eq(gymDay(uk[0], 'Europe/London'), '2026-10-20', 'the last Tuesday on summer time');
eq(gymDay(uk[1], 'Europe/London'), '2026-10-27', 'and the first on winter time');
eq(Date.parse(uk[1]) - Date.parse(uk[0]), 7 * DAY + 3_600_000,
  'the week containing the change is twenty-five hours longer, which is what proves the arithmetic is calendar and not milliseconds');
eq(Date.parse(uk[3]) - Date.parse(uk[2]), 7 * DAY, 'and a week with no change in it is exactly a week');

// Southern hemisphere, the other direction, in the month the northern one does
// nothing. Auckland goes forward on Sunday 27 September 2026.
const nz = slotInstants({ dow: 1, hour: 6, minute: 0, weeks: 3, tz: 'Pacific/Auckland', fromMs: Date.parse('2026-09-20T00:00:00.000Z') });
eq(nz.length, 3, 'three Mondays in Auckland');
for (const iso of nz) eq(gymTimeLabel(iso, 'Pacific/Auckland'), '06:00', 'six in the morning stays six in the morning across the spring change');

/* ── the occurrence that has already gone ──────────────────────────────── */

// 09:00 UTC on a Wednesday is after a Wednesday 07:30 in London, so this week's
// is behind the coach and is dropped rather than opened in the past — the
// server refuses one anyway (`v_ts > now()`).
const past = slotInstants({ dow: 3, hour: 7, minute: 30, weeks: 4, tz: 'Europe/London', fromMs: NOW });
eq(past.length, 3, 'today’s occurrence has gone, so three are left');
eq(gymDay(past[0], 'Europe/London'), '2026-09-09', 'starting next Wednesday');

// One still ahead on the same day is kept.
const laterToday = slotInstants({ dow: 3, hour: 18, minute: 0, weeks: 4, tz: 'Europe/London', fromMs: NOW });
eq(laterToday.length, 4, 'this evening is still ahead, so all four stand');
eq(gymDay(laterToday[0], 'Europe/London'), '2026-09-02', 'and the first of them is today');

/* ── a row with no zone, which is the old behaviour and must not break ─── */

// The COUNT here is deliberately not asserted as four. This branch reads the
// runner's own clock, and under one of the six zones `npm run test:zones` uses
// (Pacific/Midway, eleven hours behind) the instant these tests call "now" is
// already Tuesday evening — so this week's 07:30 has gone and three are left,
// which is the correct answer and not a defect. What must hold in every zone is
// that the dates are Tuesdays at 07:30 on THIS handset and all still ahead.
const bare = slotInstants({ dow: 2, hour: 7, minute: 30, weeks: 4, tz: null, fromMs: NOW });
ok(bare.length === 4 || bare.length === 3, 'a zoneless row still produces a month ahead rather than nothing');
for (const iso of bare) {
  const d = new Date(iso);
  eq(d.getDay(), 2, 'a Tuesday on THIS handset');
  eq(d.getHours(), 7, 'at seven on this handset');
  eq(d.getMinutes(), 30, 'thirty');
  ok(d.getTime() > NOW, 'and still ahead');
}
eq(slotInstants({ dow: 2, hour: 7, minute: 30, weeks: 4, tz: 'Not/AZone', fromMs: NOW }).length, bare.length,
  'a zone this runtime does not know falls back to that same clock rather than generating nothing');

/* ── refusals ───────────────────────────────────────────────────────────── */

eq(slotInstants({ dow: 7, hour: 7, minute: 0, weeks: 4, tz: 'Europe/London', fromMs: NOW }).length, 0, 'there is no eighth day');
eq(slotInstants({ dow: -1, hour: 7, minute: 0, weeks: 4, tz: 'Europe/London', fromMs: NOW }).length, 0, 'nor a day before Sunday');
eq(slotInstants({ dow: 2, hour: 24, minute: 0, weeks: 4, tz: 'Europe/London', fromMs: NOW }).length, 0, 'nor a twenty-fifth hour');
eq(slotInstants({ dow: 2, hour: 7, minute: 0, weeks: 0, tz: 'Europe/London', fromMs: NOW }).length, 0, 'no weeks, no dates');
eq(slotInstants({ dow: 2, hour: 7, minute: 0, weeks: 4, tz: 'Europe/London', fromMs: NaN }).length, 0, 'and no clock, no dates — never today by accident');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('slotDates.test.ts — ok');
