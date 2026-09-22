// Tests for gymMonth — which month it is at the GYM, not on the reader's laptop.
//
// ── Why these assertions are shaped the way they are ───────────────────────
//
// `npm run test:zones` re-runs this suite under six `TZ` values, which catches
// a function that answers differently on different machines. It cannot catch
// this defect on its own: a month boundary drawn on the device clock is
// ZONE-INDEPENDENT in the sense that matters — every reader gets a
// self-consistent answer, they just get six different ones out of one database,
// and a test that only checks "the same in every TZ" would have passed on the
// broken code as long as the expectation was computed the same wrong way.
//
// So every assertion here pins the GYM's zone against a READER's, both named
// explicitly, with absolute UTC instants and absolute expected keys. Nothing in
// this file asks the runtime what time it is except where the reader's clock is
// the thing under test, and there the expectation is compared against
// `monthKeyOf`/`recentMonths` — the local-calendar functions the fallback is
// documented to be identical to.
//
// The instant used throughout is 2026-08-31T21:00:00Z. At that moment it is
// 01:00 on 1 September in Dubai and 22:00 on 31 August in London: the gym's
// month has turned over and the reader's has not. That four-hour strip is where
// a payment gets filed into the wrong month permanently once /close writes the
// snapshot.
//
// Compile with tsc, run with node.
import {
  gymMonthKey, gymMonthNow, gymRecentMonths, gymMonthEnded, monthAtGym,
} from './gymMonth';
import { monthKeyOf, recentMonths } from './monthEnd';
import { NO_ZONE_NOTE } from './gymZone';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** 01:00 on 1 September in Dubai. 22:00 on 31 August in London. */
const TURNOVER = Date.parse('2026-08-31T21:00:00Z');
/** 05:00 on 1 January in Dubai, for the year rollover. */
const NEW_YEAR = Date.parse('2027-01-01T01:00:00Z');

/* ── the gym's month, pinned against a reader's ────────────────────────────── */
{
  eq(gymMonthKey(TURNOVER, 'Asia/Dubai'), '2026-09',
    'at 21:00 UTC on 31 August the Dubai gym is already in September');
  eq(gymMonthKey(TURNOVER, 'Europe/London'), '2026-08',
    'and a reader in London is still in August — the same instant, two months, which is the whole defect');
  eq(gymMonthKey(TURNOVER, 'America/Los_Angeles'), '2026-08',
    'and so is a reader in Los Angeles, further behind still');
  eq(gymMonthKey(TURNOVER, 'UTC'), '2026-08',
    'UTC is a reader like any other here and is nobody’s gym unless a gym says so');
}

/* ── the three nothings ────────────────────────────────────────────────────── */
{
  for (const zone of [null, undefined, '', '   ', 'Mars/Olympus_Mons', 'EST', '+04:00']) {
    eq(gymMonthKey(TURNOVER, zone), null,
      `${JSON.stringify(zone)} is not a zone a month can be cut on`);
  }
  eq(gymMonthKey(null, 'Asia/Dubai'), null, 'and no instant is no month');
  eq(gymMonthKey('not a date', 'Asia/Dubai'), null, 'nor is an unreadable one');
}

/* ── gymMonthNow: the gym's, and the reader's said out loud ────────────────── */
{
  const gym = gymMonthNow('Asia/Dubai', TURNOVER);
  eq(gym.key, '2026-09', 'the month running at the gym');
  eq(gym.basis, 'gym', 'cut on the gym’s own clock');
  eq(gym.zone, 'Asia/Dubai', 'which is named');
  eq(gym.note, null, 'and needs no caveat, because there is nothing to caveat');

  // TODAY'S ONLY PATH: `tenants.timezone` is NULL on all 20 tenants in
  // production, so this arm is not an edge case, it is what every gym gets.
  for (const zone of [null, undefined, '', 'EST']) {
    const reader = gymMonthNow(zone, TURNOVER);
    eq(reader.basis, 'reader', `${JSON.stringify(zone)} falls back to the reader`);
    eq(reader.key, monthKeyOf(TURNOVER),
      'to exactly the month `monthKeyOf` gives — the fallback is documented as identical and must stay so');
    eq(reader.zone, null,
      'and claims no zone: the reader’s zone is a fact about a laptop, never about the gym');
    eq(reader.note, NO_ZONE_NOTE,
      'and SAYS SO, in the one wording the rest of the console uses. A silent fallback is the same defect with a nicer signature');
  }
}

/* ── gymMonthEnded ─────────────────────────────────────────────────────────── */
{
  eq(gymMonthEnded('2026-08', 'Asia/Dubai', TURNOVER), true,
    'August is over at the Dubai gym at 21:00 UTC on the 31st');
  eq(gymMonthEnded('2026-08', 'Europe/London', TURNOVER), false,
    'and is not over for a gym in London at the same instant — /close must refuse it there');
  eq(gymMonthEnded('2026-09', 'Asia/Dubai', TURNOVER), false,
    'the month that has just started is not over');
  eq(gymMonthEnded('2026-07', 'Asia/Dubai', TURNOVER), true, 'and one before that is');
  eq(gymMonthEnded('2026-13', 'Asia/Dubai', TURNOVER), false,
    'a key that is not a month is not a month that ended');
  eq(gymMonthEnded('August', 'Asia/Dubai', TURNOVER), false, 'nor is a word');
}

/* ── gymRecentMonths ───────────────────────────────────────────────────────── */
{
  eq(gymRecentMonths(3, 'Asia/Dubai', TURNOVER).keys.join(','), '2026-09,2026-08,2026-07',
    'the picker at the Dubai gym already offers September');
  eq(gymRecentMonths(3, 'Europe/London', TURNOVER).keys.join(','), '2026-08,2026-07,2026-06',
    'and the London gym’s does not — newest first, both of them');
  eq(gymRecentMonths(3, 'Asia/Dubai', NEW_YEAR).keys.join(','), '2027-01,2026-12,2026-11',
    'stepping back across a year end is arithmetic on two integers, not a Date');
  eq(gymRecentMonths(0, 'Asia/Dubai', TURNOVER).keys.length, 0, 'a picker of no months is empty');
  eq(gymRecentMonths(1, 'Asia/Dubai', TURNOVER).keys.join(','), '2026-09', 'a picker of one is the month running');

  const reader = gymRecentMonths(4, null, TURNOVER);
  eq(reader.basis, 'reader', 'with no zone the list is the reader’s');
  eq(reader.keys.join(','), recentMonths(4, TURNOVER).join(','),
    'and is exactly `recentMonths` — the fallback changes whose clock is DISCLOSED, never which months are offered');
  eq(reader.note, NO_ZONE_NOTE, 'with the sentence that discloses it');
}

/* ── monthAtGym: the bounds a payments read is filtered on ─────────────────── */
{
  const at = monthAtGym('2026-08', 'Asia/Dubai');
  ok(at != null, 'August 2026 is a month');
  eq(at!.basis, 'gym', 'cut on the gym’s clock');
  eq(at!.window.fromIso, '2026-07-31T20:00:00.000Z',
    'August at a Dubai gym opens at 20:00 UTC on 31 July — not UTC midnight and not London midnight');
  eq(at!.window.toIso, '2026-08-31T20:00:00.000Z',
    'and closes when the gym’s 1 September starts, exclusive');
  eq(at!.window.firstDay, '2026-08-01', 'the calendar days are untouched, in any zone');
  eq(at!.window.lastDay, '2026-08-31', 'both of them');
  eq(at!.window.key, '2026-08', 'and the key comes through');
  ok(at!.note.includes('Asia/Dubai'), 'the caption names the clock it used');

  // A month containing a clock change. London's October 2026 ends on BST's last
  // Sunday, so the closing bound is 23:00 UTC and not midnight: a fixed 24-hour
  // step would end the month an hour late and file an hour of takings twice.
  const oct = monthAtGym('2026-10', 'Europe/London');
  eq(oct!.window.fromIso, '2026-09-30T23:00:00.000Z', 'October opens on BST midnight');
  eq(oct!.window.toIso, '2026-11-01T00:00:00.000Z',
    'and closes on GMT midnight — one hour longer than 31 × 24 from its own start, which is what the clock change means');
}

/* ── monthAtGym with no zone: usable bounds, honest caption ────────────────── */
{
  for (const zone of [null, undefined, '', 'EST']) {
    const at = monthAtGym('2026-08', zone);
    ok(at != null, `${JSON.stringify(zone)} still gets a window — refusing the screen over an unset setting is the worse answer`);
    eq(at!.basis, 'device', 'built on the device’s clock');
    ok(at!.note.includes(NO_ZONE_NOTE), 'and captioned as the device’s, in the shared wording');
    ok(!/cut on the gym/.test(at!.note),
      'and never as the gym’s — that claim over the device’s clock IS the defect');
    eq(at!.window.firstDay, '2026-08-01',
      'the calendar days are still right, which is why a screen comparing day STRINGS needs no zone at all');
    eq(at!.window.lastDay, '2026-08-31', 'both ends');
  }
}

/* ── a key that is not a month ─────────────────────────────────────────────── */
{
  eq(monthAtGym('2026-13', 'Asia/Dubai'), null, 'month thirteen opens nothing');
  eq(monthAtGym('August', 'Asia/Dubai'), null, 'nor does a word');
  eq(monthAtGym('2026-00', null), null, 'nor month zero, zone or no zone');
}

if (errors.length) {
  console.error(`gymMonth: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymMonth ok');
