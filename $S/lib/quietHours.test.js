"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const quietHours_1 = require("./quietHours");
const notifyPrefs_1 = require("./notifyPrefs");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const W = (fromHour, toHour, tz = 'Europe/London') => ({ fromHour, toHour, tz });
/* ── the wrap ──────────────────────────────────────────────────────────── */
ok((0, quietHours_1.hourInWindow)(23, 22, 7), '23:00 is inside 22 → 7');
ok((0, quietHours_1.hourInWindow)(0, 22, 7), 'and so is midnight');
ok((0, quietHours_1.hourInWindow)(6, 22, 7), 'and 06:00');
ok(!(0, quietHours_1.hourInWindow)(7, 22, 7), 'but 07:00 is not — the end is EXCLUSIVE');
ok(!(0, quietHours_1.hourInWindow)(21, 22, 7), 'and neither is the hour before it begins');
ok((0, quietHours_1.hourInWindow)(22, 22, 7), 'while the hour it begins is, because the start is inclusive');
ok((0, quietHours_1.hourInWindow)(13, 12, 14), 'an ordinary same-day window works too');
ok(!(0, quietHours_1.hourInWindow)(14, 12, 14), 'with the same exclusive end');
// A zero-length window is not twenty-four silent hours. The database refuses to
// store one; this is the arithmetic agreeing with it.
ok(!(0, quietHours_1.hourInWindow)(5, 9, 9), 'a zero-length window silences nothing rather than everything');
ok(!(0, quietHours_1.hourInWindow)(-1, 22, 7), 'an hour off the clock is not inside anything');
ok(!(0, quietHours_1.hourInWindow)(24, 22, 7), 'at either end');
ok(!(0, quietHours_1.hourInWindow)(Number.NaN, 22, 7), 'nor an unreadable one');
// The whole reason `hourInWindow` was lifted out: two copies of this rule are
// two chances to disagree about an hour.
for (let h = 0; h < 24; h++) {
    eq((0, notifyPrefs_1.inQuietHours)(h, { ...notifyPrefs_1.DEFAULT_NOTIFY_PREFS, quiet: true, quietFromHour: 22, quietToHour: 7 }), (0, quietHours_1.hourInWindow)(h, 22, 7), `hour ${h}: the member's local rule and the coach's server rule agree`);
}
eq((0, quietHours_1.inQuiet)(23, null), false, 'a coach with no window is quiet at no hour');
ok((0, quietHours_1.inQuiet)(23, W(22, 7)), 'and one with a window is');
/* ── reading a stored row ──────────────────────────────────────────────── */
eq((0, quietHours_1.quietFromRow)(null), null, 'no row is no window');
eq((0, quietHours_1.quietFromRow)({ from_hour: 22, to_hour: 7, tz: 'Europe/London' })?.fromHour, 22, 'a complete row reads back');
// Every one of these is a half-answer, and reading one as a window would
// silence somebody's notifications on the strength of a bad write.
eq((0, quietHours_1.quietFromRow)({ from_hour: 22, to_hour: 7, tz: '  ' }), null, 'a blank zone is not a window');
eq((0, quietHours_1.quietFromRow)({ from_hour: 22, to_hour: 22, tz: 'UTC' }), null, 'nor a zero-length one');
eq((0, quietHours_1.quietFromRow)({ from_hour: 24, to_hour: 7, tz: 'UTC' }), null, 'nor an hour off the clock');
eq((0, quietHours_1.quietFromRow)({ from_hour: '22', to_hour: 7, tz: 'UTC' }), null, 'nor an hour that is not a number');
eq((0, quietHours_1.quietFromRow)({ to_hour: 7, tz: 'UTC' }), null, 'nor a missing one');
/* ── WHETHER THE CONTROL MAY EXIST ─────────────────────────────────────── */
const live = (0, quietHours_1.quietAvailability)(true);
ok(live.available, 'a server that applies quiet hours gets the switch');
eq(live.note, null, 'and no paragraph explaining a control that is right there');
const notYet = (0, quietHours_1.quietAvailability)(false);
ok(!notYet.available, 'a server that does not apply them gets NO switch — one that did nothing would be worse');
ok(notYet.note !== null && /not switched on/i.test(notYet.note), 'and is told so');
ok(notYet.note !== null && /still work/i.test(notYet.note), 'and that the category switches above are unaffected, so this does not read as the whole page being broken');
const unread = (0, quietHours_1.quietAvailability)(null);
ok(!unread.available, 'an unread rollout offers nothing either');
ok(unread.note !== null && /could not be read/i.test(unread.note), 'but says the app could not find out — not that the server does not support it, which would be a claim about somebody’s installation made from a failed select');
ok(unread.note !== notYet.note, 'the two are different sentences, because they are different facts');
/* ── the words ─────────────────────────────────────────────────────────── */
eq((0, quietHours_1.hourLabel)(0), 'midnight', 'midnight is not "0am"');
eq((0, quietHours_1.hourLabel)(12), 'midday', 'and midday is not "0pm"');
eq((0, quietHours_1.hourLabel)(22), '10pm', 'and 22 is what a coach thinks in');
eq((0, quietHours_1.hourLabel)(7), '7am', 'as is 7');
eq((0, quietHours_1.windowLabel)(W(22, 7)), '10pm to 7am', 'the window reads as a sentence');
eq(quietHours_1.SUGGESTED_QUIET.fromHour, 22, 'the offered starting point is an ordinary night');
ok(!/held back|in the morning/i.test(quietHours_1.QUIET_HELD_NOT_DELAYED.split('but')[0] ?? ''), 'the note does not open by promising a later delivery');
ok(/not held back|not.*delivered in the morning/i.test(quietHours_1.QUIET_HELD_NOT_DELAYED), 'it says plainly that nothing is delivered later, because a push already handed over cannot be held');
ok(/notifications list/i.test(quietHours_1.QUIET_HELD_NOT_DELAYED), 'and that the record survives, which is what makes it safe to offer');
ok(/timezone/i.test(quietHours_1.QUIET_ZONE_NOTE) && /server/i.test(quietHours_1.QUIET_ZONE_NOTE), 'the zone note says why a zone is stored at all');
ok(/muted/i.test(quietHours_1.QUIET_ORDER_NOTE) && /Push Notifications/i.test(quietHours_1.QUIET_ORDER_NOTE), 'and the ordering note says what still outranks this');
/* ── moving ────────────────────────────────────────────────────────────── */
eq((0, quietHours_1.zoneMovedNote)('Europe/London', 'Europe/London'), null, 'no note while the coach is where they set them');
eq((0, quietHours_1.zoneMovedNote)(null, 'Asia/Dubai'), null, 'and none raised by a zone we could not read');
eq((0, quietHours_1.zoneMovedNote)('Europe/London', null), null, 'at either end');
const moved = (0, quietHours_1.zoneMovedNote)('Europe/London', 'Asia/Dubai');
ok(moved !== null && /Europe\/London/.test(moved) && /Asia\/Dubai/.test(moved), 'but both zones are named when they differ, because the phone going off at midnight is otherwise unexplainable');
// The suites run under six zones (`npm run test:zones`), so this is a real
// answer in each of them rather than a constant.
const z = (0, quietHours_1.deviceZone)();
ok(z === null || (typeof z === 'string' && z.includes('/')), 'the device zone is either an IANA name or an honest null — never a guessed UTC');
if (errors.length) {
    for (const e of errors)
        console.error('  ✗ ' + e);
    console.error(`quietHours: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    process.exit(1);
}
console.log('quietHours: ok (the wrap agrees with the member’s rule, and a server that cannot apply this offers no switch)');
