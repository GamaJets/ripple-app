// "Today" at a gym, and the three calendars a console can accidentally mean by
// it. Compile with tsc, run with node.
//
// Almost nothing here may depend on the runner's own zone — this suite is in
// the `npm run test:zones` sweep, where TZ is set to Kiritimati and Midway,
// which are a day apart. Every gym-zone assertion names its zone; the handful
// that are ABOUT the reader's zone assert a RELATIONSHIP (the window contains
// now, the day matches the local getters) rather than a literal.
//
// The two things asserted hardest:
//
//   1. That the window is not UTC's. Each of the two headline cases carries the
//      instant the OLD code got wrong and asserts the new window disagrees with
//      it — a Los Angeles gym counting last night's 8pm class as today, and a
//      Dubai gym not counting this morning's 1am arrival at all.
//   2. That a missing zone is disclosed rather than filled in. `basis` says
//      'reader', `zone` is null and `note` is the one shared sentence. No
//      branch of this file may ever return a window it made up a zone for.
import { gymTodayWindow, inWindow } from './gymToday';
import { gymDay, NO_ZONE_NOTE } from './gymZone';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const LA = 'America/Los_Angeles';
const DUBAI = 'Asia/Dubai';
const LONDON = 'Europe/London';

/** What `studio-web/app/page.tsx` used to compute. Kept here, named, so the
 *  assertions below can state exactly which figure changed. */
const utcDayStart = (at: number) => new Date(new Date(at).toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();

const hours = (w: { fromISO: string; toISO: string }) =>
  (Date.parse(w.toISO) - Date.parse(w.fromISO)) / 3600_000;

/* ── west of Greenwich: the evening that was counted twice ──────────────── */

// 09:30 on 1 September in Los Angeles. PDT, so UTC+(-7).
const laMorning = Date.parse('2026-09-01T16:30:00Z');
const la = gymTodayWindow(LA, laMorning);

eq(la.basis, 'gym', 'a gym with a zone gets its own day');
eq(la.zone, LA, 'and the window says which zone it was cut on');
eq(la.note, null, 'with nothing to disclose');
eq(la.day, '2026-09-01', 'the day is the gym’s calendar day');
eq(la.fromISO, '2026-09-01T07:00:00.000Z', 'and it opens at midnight in Los Angeles');
eq(la.toISO, '2026-09-02T07:00:00.000Z', 'and closes at the next one');
ok(inWindow(laMorning, la), 'the instant asked about is inside its own day');

// The class that finished at 8pm the previous evening. UTC's day had already
// turned over by then, so the old window counted it as today's — every day, at
// every gym west of Greenwich, with no way to tell from the tile.
const lastNight = Date.parse('2026-09-01T03:00:00Z');   // 20:00 on 31 Aug, PDT
eq(gymDay(lastNight, LA), '2026-08-31', 'that class ran on the 31st at the gym');
ok(!inWindow(lastNight, la), 'so it is not in today’s window');
ok(lastNight >= Date.parse(utcDayStart(laMorning)),
  'and the UTC window this replaces did count it — which is the bug');

/* ── east of Greenwich: the morning that had not started ────────────────── */

// 06:00 on 1 September in Dubai. UTC+4, so UTC's day does not turn over until
// 04:00 local and these four hours belonged to yesterday as far as the tile
// was concerned.
const dubaiMorning = Date.parse('2026-09-01T02:00:00Z');
const dxb = gymTodayWindow(DUBAI, dubaiMorning);

eq(dxb.basis, 'gym', 'the same for a gym east of Greenwich');
eq(dxb.day, '2026-09-01', 'whose day is already the 1st');
eq(dxb.fromISO, '2026-08-31T20:00:00.000Z', 'opening at midnight in Dubai');
eq(dxb.toISO, '2026-09-01T20:00:00.000Z', 'and closing at the next one');
eq(hours(dxb), 24, 'a day with no clock change is 24 hours long');

const earlyBird = Date.parse('2026-08-31T21:00:00Z');   // 01:00 on 1 Sep, +04
eq(gymDay(earlyBird, DUBAI), '2026-09-01', 'a 1am arrival is on the 1st at the gym');
ok(inWindow(earlyBird, dxb), 'and is counted in today');
ok(earlyBird < Date.parse(utcDayStart(dubaiMorning)),
  'where the UTC window this replaces dropped it — the same bug pointing the other way');

/* ── the two days a year that are not 24 hours ──────────────────────────── */

const back = gymTodayWindow(LONDON, Date.parse('2026-10-25T12:00:00Z'));
eq(back.day, '2026-10-25', 'the Sunday the clocks go back in London');
eq(hours(back), 25, 'is a 25-hour day, not 24');
eq(back.fromISO, '2026-10-24T23:00:00.000Z', 'opening at midnight BST');
eq(back.toISO, '2026-10-26T00:00:00.000Z', 'and closing at midnight GMT');

const fwd = gymTodayWindow(LONDON, Date.parse('2026-03-29T12:00:00Z'));
eq(fwd.day, '2026-03-29', 'the Sunday they go forward');
eq(hours(fwd), 23, 'is a 23-hour day');

/* ── no zone is disclosed, never filled in ──────────────────────────────── */

// WHAT COUNTS as a zone is `isZone` in src/lib/gymZone.ts and is deliberately
// not re-decided here — two answers to that question is how one screen's day
// and another's come apart. So this only asserts the handful nothing could call
// a zone. Bare abbreviations are the one live disagreement and are left out on
// purpose: `parseGymZone`'s own doc says GMT and PST are refused, and the
// runtime resolves both, so `isZone('PST')` is true today. Asserting either way
// here would be this file taking a position on another module's bug.
for (const [label, z] of [
  ['null', null],
  ['undefined', undefined],
  ['blank', ''],
  ['an offset', '+04:00'],
  ['a name no IANA database holds', 'Mars/Olympus_Mons'],
] as [string, string | null | undefined][]) {
  const w = gymTodayWindow(z, laMorning);
  eq(w.basis, 'reader', `${label} is not a zone, so the day is the reader’s`);
  eq(w.zone, null, `${label} leaves no zone on the window`);
  eq(w.note, NO_ZONE_NOTE, `${label} carries the shared sentence saying so`);
  ok(inWindow(laMorning, w), `${label} still produces a window containing the instant`);
}

// The reader's day, asserted as a relationship because the runner's TZ moves.
// This is the one place the machine's own calendar is the right answer, and it
// has to be the machine's — not UTC's, which is what it replaced.
{
  const w = gymTodayWindow(null, laMorning);
  const d = new Date(laMorning);
  const p2 = (n: number) => String(n).padStart(2, '0');
  eq(w.day, `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    'the fallback day is the local calendar day');
  eq(w.fromISO, new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString(),
    'and it opens at local midnight');
  ok(hours(w) >= 23 && hours(w) <= 25, 'and is a day long, give or take a clock change');
}

/* ── the window is half-open ────────────────────────────────────────────── */

ok(inWindow(la.fromISO, la), 'midnight belongs to the day it opens');
ok(!inWindow(la.toISO, la), 'and the next midnight belongs to the next day, not both');
ok(!inWindow(null, la), 'nothing is not inside a window');
ok(!inWindow('not a date', la), 'and neither is an unreadable instant');
ok(inWindow(new Date(laMorning), la), 'a Date is accepted as well as an ISO string');

/* ── it agrees with the module that owns the calendar ───────────────────── */

for (const z of [LA, DUBAI, LONDON]) {
  for (const at of [laMorning, dubaiMorning, Date.parse('2026-12-31T23:30:00Z')]) {
    const w = gymTodayWindow(z, at);
    eq(w.day, gymDay(at, z), `${z} at ${new Date(at).toISOString()}: the day is gymDay’s day`);
    ok(inWindow(at, w), `${z} at ${new Date(at).toISOString()}: and the window contains it`);
  }
}

// A Date and the millisecond count it holds are the same instant.
eq(gymTodayWindow(LA, new Date(laMorning)).fromISO, la.fromISO, 'a Date argument is the same as a number');

if (errors.length) {
  console.error(`gymToday: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('gymToday ok');
