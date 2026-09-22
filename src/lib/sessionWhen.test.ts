// When the session a coach is typing up actually happened. Compile with tsc,
// run with node.
//
// The bug this guards: `const at = new Date().toISOString()` at the moment Save
// was pressed, with no way to say otherwise. A Monday evening session written
// up on the Tuesday landed on the Tuesday in the client's own log, streak,
// weekly report and plan-versus-actual — four things that all bucket by day.
//
// Run under six timezones by `test:zones`. Every day here is a day in the
// coach's own life, so every assertion is made in local time.
import {
  LOG_BACK_DAYS, hourLabel, logDayOptions, logStamp, logStampProblem, logWhenLine,
} from './sessionWhen';
import { isoDay } from './weekStart';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the days on offer ──────────────────────────────────────────────────── */

const now = new Date(2026, 8, 2, 9, 30, 12, 345);   // Wed 2 Sep 2026, 9:30am local
const days = logDayOptions(now);

eq(days.length, LOG_BACK_DAYS + 1, 'today and the fortnight behind it');
eq(days[0].day, isoDay(now), 'the first option is today, in the coach’s own zone');
eq(days[0].label, 'Today', 'and it is called that');
eq(days[1].label, 'Yesterday', 'the one behind it is called that');
eq(days[0].daysAgo, 0, 'today is nought days ago');
eq(days[2].daysAgo, 2, 'and the third is two');
ok(!/Today|Yesterday/.test(days[2].label), 'everything further back is written as a date');

// Every option distinct, and every one exactly one calendar day behind the one
// before it. This is the assertion that fails if the arithmetic ever becomes a
// subtraction of 86,400,000ms: across a clocks change that repeats one day and
// skips another, and a coach would file a session on the wrong one.
const seen = new Set(days.map((d) => d.day));
eq(seen.size, days.length, 'no day is offered twice');
for (let i = 1; i < days.length; i++) {
  const prev = new Date(`${days[i - 1].day}T12:00:00`);
  const here = new Date(`${days[i].day}T12:00:00`);
  const gapDays = Math.round((prev.getTime() - here.getTime()) / 86400000);
  eq(gapDays, 1, `option ${i} is exactly one calendar day behind option ${i - 1}`);
}

// The same, walked over a fortnight that contains a clocks change in the zones
// that have one. November in the Americas, March in Europe — one of the six
// zones the suite runs under crosses each.
for (const start of [new Date(2026, 10, 8, 9), new Date(2026, 2, 15, 9), new Date(2026, 3, 12, 9)]) {
  const run = logDayOptions(start);
  eq(new Set(run.map((d) => d.day)).size, run.length,
    `every day is distinct across the fortnight ending ${isoDay(start)}`);
}

eq(logDayOptions(now, 0).length, 1, 'asking for no history still offers today');
eq(logDayOptions(now, -3).length, 1, 'and a nonsense window does not produce a negative list');

/* ── the stamp ──────────────────────────────────────────────────────────── */

const monday = days[2].day;                       // Mon 31 Aug 2026, local
const stamp = logStamp(monday, 18, now);
ok(stamp != null, 'a readable day produces a stamp');
const back = new Date(stamp!);
eq(isoDay(back), monday, 'the stamp lands on the day the coach picked, read back locally');
eq(back.getHours(), 18, 'at the hour they picked');
eq(back.getMinutes(), 0, 'on the hour, because an hour is what they were asked for');

// The seconds are the moment of saving, and they are load-bearing: they are
// what keeps two sessions typed on the same evening two rows rather than one.
// See `supersedeKey` in src/lib/floorQueue.ts, which keys a queued log on its
// contents.
eq(back.getSeconds(), now.getSeconds(), 'the second of saving is carried through');
eq(back.getMilliseconds(), now.getMilliseconds(), 'and so is the millisecond');
const later = new Date(now.getTime());
later.setMilliseconds(now.getMilliseconds() + 1);
ok(logStamp(monday, 18, later) !== stamp, 'two saves a moment apart are two different instants');

eq(logStamp('not a day', 18, now), null, 'a day that cannot be read produces no stamp');

// An hour off the end of the clock is brought back onto it rather than rolling
// the write into the next day.
eq(new Date(logStamp(monday, 24, now)!).getHours(), 0, 'hour 24 is midnight, not tomorrow');
eq(new Date(logStamp(monday, -1, now)!).getHours(), 23, 'and a negative hour wraps to the end of the day');
eq(isoDay(new Date(logStamp(monday, 24, now)!)), monday, 'either way it stays on the chosen day');

/* ── what cannot be filed ───────────────────────────────────────────────── */

eq(logStampProblem(monday, 18, now), null, 'an hour that has been lived is fine');
eq(logStampProblem(days[0].day, 8, now), null, 'and so is earlier today');

// A workout dated into the future counts towards a streak nobody has earned,
// and the client cannot correct it because they did not type it.
const ahead = logStampProblem(days[0].day, 22, now) ?? '';
ok(ahead.length > 0, 'later today is refused');
ok(/has not happened yet/.test(ahead), 'and says why in the coach’s own terms');
ok(!/undefined|NaN/.test(ahead), 'without rendering an hour as a word');

ok((logStampProblem('not a day', 18, now) ?? '').length > 0, 'an unreadable day is refused too');

/* ── the sentence under the picker ──────────────────────────────────────── */

const line = logWhenLine(monday, 18, now, 'Priya');
ok(/Priya/.test(line), 'the sentence names who it is going to');
ok(/streak/.test(line) && /plan-versus-actual/.test(line),
  'and names what turns on the day, which is why the field is there');
ok(/not as the moment you are typing it/.test(line),
  'a back-dated session says outright that it is not stamped now');

const today = logWhenLine(days[0].day, 9, now, 'Priya');
ok(/today/.test(today), 'today is called today');
ok(!/not as the moment/.test(today), 'and needs no correction, because it is not being corrected');

ok(logWhenLine('not a day', 9, now, 'Priya').length > 0, 'an unreadable day still says something');

/* ── how an hour is written ─────────────────────────────────────────────── */

ok(hourLabel(18).length > 0, 'every hour has a label');
ok(hourLabel(0) !== hourLabel(12), 'midnight and midday are not the same label');
ok(hourLabel(25) === hourLabel(1), 'and an hour off the clock is brought back onto it');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sessionWhen: ok');
