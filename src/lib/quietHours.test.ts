// "Not at eleven at night", and the refusal to offer it where it would not work.
// Compile with tsc, run with node.
//
// Two things are asserted hardest here. First, the wrap: 22 → 7 has to mean 22,
// 23, 0 … 6 with the end exclusive, and it has to agree with the CASE in
// notify_quiet_now (supabase/parts/530) and with NotifyPrefs, because a
// disagreement costs somebody either an hour of sleep or an hour of silence.
// Second, that a server which does not apply quiet hours produces no switch —
// and that "could not find out" is a third answer rather than a rounding of
// the second.
import {
  hourInWindow, inQuiet, quietFromRow, quietAvailability, hourLabel, windowLabel,
  zoneMovedNote, deviceZone, SUGGESTED_QUIET,
  QUIET_HELD_NOT_DELAYED, QUIET_ZONE_NOTE, QUIET_ORDER_NOTE, type QuietHours,
} from './quietHours';
import { inQuietHours, DEFAULT_NOTIFY_PREFS } from './notifyPrefs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const W = (fromHour: number, toHour: number, tz = 'Europe/London'): QuietHours => ({ fromHour, toHour, tz });

/* ── the wrap ──────────────────────────────────────────────────────────── */

ok(hourInWindow(23, 22, 7), '23:00 is inside 22 → 7');
ok(hourInWindow(0, 22, 7), 'and so is midnight');
ok(hourInWindow(6, 22, 7), 'and 06:00');
ok(!hourInWindow(7, 22, 7), 'but 07:00 is not — the end is EXCLUSIVE');
ok(!hourInWindow(21, 22, 7), 'and neither is the hour before it begins');
ok(hourInWindow(22, 22, 7), 'while the hour it begins is, because the start is inclusive');

ok(hourInWindow(13, 12, 14), 'an ordinary same-day window works too');
ok(!hourInWindow(14, 12, 14), 'with the same exclusive end');

// A zero-length window is not twenty-four silent hours. The database refuses to
// store one; this is the arithmetic agreeing with it.
ok(!hourInWindow(5, 9, 9), 'a zero-length window silences nothing rather than everything');

ok(!hourInWindow(-1, 22, 7), 'an hour off the clock is not inside anything');
ok(!hourInWindow(24, 22, 7), 'at either end');
ok(!hourInWindow(Number.NaN, 22, 7), 'nor an unreadable one');

// The whole reason `hourInWindow` was lifted out: two copies of this rule are
// two chances to disagree about an hour.
for (let h = 0; h < 24; h++) {
  eq(inQuietHours(h, { ...DEFAULT_NOTIFY_PREFS, quiet: true, quietFromHour: 22, quietToHour: 7 }),
    hourInWindow(h, 22, 7),
    `hour ${h}: the member's local rule and the coach's server rule agree`);
}

eq(inQuiet(23, null), false, 'a coach with no window is quiet at no hour');
ok(inQuiet(23, W(22, 7)), 'and one with a window is');

/* ── reading a stored row ──────────────────────────────────────────────── */

eq(quietFromRow(null), null, 'no row is no window');
eq(quietFromRow({ from_hour: 22, to_hour: 7, tz: 'Europe/London' })?.fromHour, 22, 'a complete row reads back');
// Every one of these is a half-answer, and reading one as a window would
// silence somebody's notifications on the strength of a bad write.
eq(quietFromRow({ from_hour: 22, to_hour: 7, tz: '  ' }), null, 'a blank zone is not a window');
eq(quietFromRow({ from_hour: 22, to_hour: 22, tz: 'UTC' }), null, 'nor a zero-length one');
eq(quietFromRow({ from_hour: 24, to_hour: 7, tz: 'UTC' }), null, 'nor an hour off the clock');
eq(quietFromRow({ from_hour: '22', to_hour: 7, tz: 'UTC' } as any), null, 'nor an hour that is not a number');
eq(quietFromRow({ to_hour: 7, tz: 'UTC' }), null, 'nor a missing one');

/* ── WHETHER THE CONTROL MAY EXIST ─────────────────────────────────────── */

const live = quietAvailability(true);
ok(live.available, 'a server that applies quiet hours gets the switch');
eq(live.note, null, 'and no paragraph explaining a control that is right there');

const notYet = quietAvailability(false);
ok(!notYet.available, 'a server that does not apply them gets NO switch — one that did nothing would be worse');
ok(notYet.note !== null && /not switched on/i.test(notYet.note), 'and is told so');
ok(notYet.note !== null && /still work/i.test(notYet.note),
  'and that the category switches above are unaffected, so this does not read as the whole page being broken');

const unread = quietAvailability(null);
ok(!unread.available, 'an unread rollout offers nothing either');
ok(unread.note !== null && /could not be read/i.test(unread.note),
  'but says the app could not find out — not that the server does not support it, which would be a claim about somebody’s installation made from a failed select');
ok(unread.note !== notYet.note, 'the two are different sentences, because they are different facts');

/* ── the words ─────────────────────────────────────────────────────────── */

eq(hourLabel(0), 'midnight', 'midnight is not "0am"');
eq(hourLabel(12), 'midday', 'and midday is not "0pm"');
eq(hourLabel(22), '10pm', 'and 22 is what a coach thinks in');
eq(hourLabel(7), '7am', 'as is 7');
eq(windowLabel(W(22, 7)), '10pm to 7am', 'the window reads as a sentence');

eq(SUGGESTED_QUIET.fromHour, 22, 'the offered starting point is an ordinary night');
ok(!/held back|in the morning/i.test(QUIET_HELD_NOT_DELAYED.split('but')[0] ?? ''),
  'the note does not open by promising a later delivery');
ok(/not held back|not.*delivered in the morning/i.test(QUIET_HELD_NOT_DELAYED),
  'it says plainly that nothing is delivered later, because a push already handed over cannot be held');
ok(/notifications list/i.test(QUIET_HELD_NOT_DELAYED), 'and that the record survives, which is what makes it safe to offer');
ok(/timezone/i.test(QUIET_ZONE_NOTE) && /server/i.test(QUIET_ZONE_NOTE),
  'the zone note says why a zone is stored at all');
ok(/muted/i.test(QUIET_ORDER_NOTE) && /Push Notifications/i.test(QUIET_ORDER_NOTE),
  'and the ordering note says what still outranks this');

/* ── moving ────────────────────────────────────────────────────────────── */

eq(zoneMovedNote('Europe/London', 'Europe/London'), null, 'no note while the coach is where they set them');
eq(zoneMovedNote(null, 'Asia/Dubai'), null, 'and none raised by a zone we could not read');
eq(zoneMovedNote('Europe/London', null), null, 'at either end');
const moved = zoneMovedNote('Europe/London', 'Asia/Dubai');
ok(moved !== null && /Europe\/London/.test(moved) && /Asia\/Dubai/.test(moved),
  'but both zones are named when they differ, because the phone going off at midnight is otherwise unexplainable');

// The suites run under six zones (`npm run test:zones`), so this is a real
// answer in each of them rather than a constant.
const z = deviceZone();
ok(z === null || (typeof z === 'string' && z.includes('/')),
  'the device zone is either an IANA name or an honest null — never a guessed UTC');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`quietHours: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('quietHours: ok (the wrap agrees with the member’s rule, and a server that cannot apply this offers no switch)');
