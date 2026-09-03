// The gym's own timezone, and the six ways a screen can quietly substitute the
// reader's. Compile with tsc, run with node.
//
// This suite is the reason `npm run test:zones` exists, so almost nothing here
// is allowed to depend on the runner's own zone. Every assertion below names
// the zone it is about, and the handful that are ABOUT the runner's zone say so
// and assert a relationship rather than a value — `TZ=Pacific/Kiritimati` and
// `TZ=Pacific/Midway` are a day apart, and a hard-coded expectation would be
// wrong in four of the six sweeps.
//
// The three things asserted hardest:
//
//   1. No zone is never an answer. Every function returns null, and `sameGymDay`
//      returns FALSE rather than true — "we cannot tell" answered "yes, the same
//      day" is what merges two days of takings into one.
//   2. The day the clocks move. `gymDayBounds` has to produce a 23-hour and a
//      25-hour day, because a fixed 24 is right for 363 days a year and the two
//      it is wrong on are the two nobody tests.
//   3. That this agrees with the CASE in supabase/parts/710. The database is the
//      authority; a renderer that disagrees with it is worse than no renderer.
import {
  parseGymZone, isZone, readerZone, gymDay, gymHour, sameGymDay, gymTimeLabel,
  gymMinutesAhead, zoneGapNote, gymDayBounds, zoneOptions, fetchGymZone,
  instantAtGym, gymWallValue, NO_ZONE_NOTE,
} from './gymZone';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const LONDON = 'Europe/London';
const DUBAI = 'Asia/Dubai';
const LA = 'America/Los_Angeles';
const KIRITIMATI = 'Pacific/Kiritimati';

/* ── what a zone is ────────────────────────────────────────────────────── */

ok(isZone(LONDON), 'an IANA name is a zone');
ok(isZone(DUBAI), 'and so is one east of Greenwich');
ok(isZone('UTC'), 'UTC is a zone — it is the wrong DEFAULT, not an invalid value');
// ── the abbreviations, which Intl accepts and this must not ────────────────
//
// `new Intl.DateTimeFormat(undefined, { timeZone: 'EST' })` CONSTRUCTS on a
// current runtime, because EST, MST, HST, CET, EST5EDT and PST8PDT are real
// IANA *backward* entries. `isZone` returned true for all of them while
// `parseGymZone`'s refusal message said "not an abbreviation such as GMT or
// PST" and `isZone`'s own comment said "False for … an abbreviation".
//
// They are FIXED OFFSET. A New York gym stored as 'EST' observes no daylight
// saving, so every day boundary and every hour label in the console is an hour
// out from mid-March to early November — silently, with the screen asserting
// the gym has a timezone. That is the failure part 710 and this file's header
// both say an offset must never be allowed to cause; an abbreviation caused it
// by another door.
ok(!isZone('EST'), 'EST is a fixed-offset backward entry, not a place — and would be an hour out for eight months of the year');
ok(!isZone('PST'), 'and so is PST');
ok(!isZone('MST'), 'and MST');
ok(!isZone('HST'), 'and HST');
ok(!isZone('CET'), 'and CET');
ok(!isZone('GMT'), 'GMT names an offset, not a place');
ok(!isZone('EST5EDT'), 'EST5EDT keeps daylight saving and is still not a place — one rule, no list of exceptions');
ok(!isZone('PST8PDT'), 'nor is PST8PDT');
// Deliberately stricter than "is it dangerous". These behave correctly and are
// still refused, because each is a deprecated link to a slashed name the owner
// can type instead — and a rule with a list of exceptions is a rule somebody
// adds EST to later.
ok(!isZone('Japan'), 'a single-word alias is refused even when it behaves — Asia/Tokyo is the name');
ok(!isZone('Israel'), 'and so is Israel — Asia/Jerusalem is the name');
ok(isZone('America/New_York'), 'the name that actually keeps daylight saving is accepted');
ok(isZone('America/Indiana/Indianapolis'), 'and a three-segment name is still a name');

// And the message says the thing that is now true of the code.
{
  const bad = parseGymZone('EST');
  eq(bad.kind, 'bad', 'parseGymZone refuses an abbreviation, as its own message promised');
  ok(bad.kind === 'bad' && /abbreviation/i.test(bad.reason), 'and the reason names it');
}

ok(!isZone(''), 'an empty string is not a zone');
ok(!isZone(null), 'and neither is nothing at all');
ok(!isZone('Europe/Londn'), 'a typo is refused rather than resolved to something near it');
// `Intl` itself accepts this one — ES2024 offset identifiers — so the refusal
// is this module's, deliberately, and it has to be asserted or it will be
// "simplified" back out.
ok(!isZone('+04:00'), 'an offset is not a zone — it stops being right when the clocks move');
ok(!isZone('-08:00'), 'in either direction');

// 'GMT' and 'PST' resolve in some runtimes and not others, so what is asserted
// is the thing that matters either way: whatever the runtime thinks of them,
// this module never invents an answer for one it cannot resolve.
eq(gymDay('2026-06-15T12:00:00Z', 'PST8PDT7'), null, 'an unresolvable zone yields no day rather than a guessed one');

/* ── parsing what an owner typed ───────────────────────────────────────── */

eq(parseGymZone('').kind, 'clear', 'an emptied field CLEARS — the owner is saying they no longer know');
eq(parseGymZone('   ').kind, 'clear', 'and whitespace is empty');
eq(parseGymZone(null).kind, 'clear', 'as is nothing');
const good = parseGymZone(` ${DUBAI} `);
eq(good.kind, 'zone', 'a real zone parses');
eq(good.kind === 'zone' ? good.zone : null, DUBAI, 'and is trimmed but not otherwise touched — zone names are case-sensitive');
eq(parseGymZone('GMT+4').kind, 'bad', 'an offset is refused at the field rather than at the round trip');
eq(parseGymZone('London').kind, 'bad', 'and so is a city on its own');
const bad = parseGymZone('Europe/Londn');
ok(bad.kind === 'bad' && /IANA/.test(bad.reason), 'and the refusal says what shape the answer takes');
ok(bad.kind === 'bad' && /offset/.test(bad.reason),
  'and names the offset case, because that is the one that looks right and rots');

/* ── no zone is never an answer ────────────────────────────────────────── */

const NOON = '2026-06-15T12:00:00Z';

eq(gymDay(NOON, null), null, 'no zone, no day');
eq(gymDay(NOON, ''), null, 'an empty zone is no zone');
eq(gymDay(NOON, 'Europe/Londn'), null, 'and a zone this runtime cannot resolve is no zone');
eq(gymHour(NOON, null), null, 'no zone, no hour — this is the door histogram’s whole finding');
eq(gymTimeLabel(NOON, null), null, 'no zone, no clock');
eq(gymDayBounds('2026-06-15', null), null, 'no zone, no day bounds — a query filtered on nothing returns nothing');
eq(gymMinutesAhead(NOON, null, LONDON), null, 'no gym zone, no comparison');
eq(gymMinutesAhead(NOON, LONDON, null), null, 'and no reader zone, no comparison either');
eq(zoneGapNote(null, LONDON), null, 'and nothing to say about a gap that cannot be measured');

// The one that would do damage silently.
ok(!sameGymDay(NOON, NOON, null),
  'two instants are NOT "the same gym day" when there is no gym day — false, never true');
ok(sameGymDay(NOON, NOON, LONDON), 'while with a zone, an instant is the same day as itself');

eq(gymDay(null, LONDON), null, 'an absent instant has no day');
eq(gymDay('not a date', LONDON), null, 'nor an unreadable one');
eq(gymHour('not a date', LONDON), null, 'at either end');

/* ── the day and the hour, per zone ────────────────────────────────────── */

// 22:00 UTC on the 15th. Three gyms, three different dates, one instant — this
// is the whole item in four lines.
const LATE = '2026-06-15T22:00:00Z';
eq(gymDay(LATE, LA), '2026-06-15', 'Los Angeles is still on the 15th at 22:00 UTC');
eq(gymDay(LATE, LONDON), '2026-06-15', 'so is London, at 23:00 its own time');
eq(gymDay(LATE, DUBAI), '2026-06-16', 'and Dubai is already on the 16th');
eq(gymDay(LATE, KIRITIMATI), '2026-06-16', 'as is Kiritimati, fourteen hours ahead');

eq(gymHour(LATE, LA), 15, 'the hour a Los Angeles gym files that entry under');
eq(gymHour(LATE, LONDON), 23, 'and London, on summer time');
eq(gymHour(LATE, DUBAI), 2, 'and Dubai, two in the morning');

eq(gymTimeLabel('2026-06-15T22:07:00Z', DUBAI), '02:07', 'the clock on the wall, zero-padded');
eq(gymTimeLabel('2026-06-15T22:07:00Z', LONDON), '23:07', 'in twenty-four hour time whatever the locale');

// Summer time is the case a stored offset gets wrong, so it is asserted twice.
eq(gymHour('2026-01-15T12:00:00Z', LONDON), 12, 'London in January is UTC');
eq(gymHour('2026-06-15T12:00:00Z', LONDON), 13, 'and in June it is not');
eq(gymHour('2026-01-15T12:00:00Z', DUBAI), 16, 'Dubai does not move at all in January');
eq(gymHour('2026-06-15T12:00:00Z', DUBAI), 16, 'or in June — which is why it is the zone the mistakes show up in');

// Dubai is UTC+4 all year, so its midnight is 20:00 UTC. Two instants an hour
// either side of it are the case a UTC-bucketed day gets wrong every night.
ok(!sameGymDay('2026-06-15T19:00:00Z', '2026-06-15T21:00:00Z', DUBAI),
  '19:00 and 21:00 UTC straddle Dubai’s midnight and are different gym days');
ok(sameGymDay('2026-06-15T19:00:00Z', '2026-06-15T21:00:00Z', LA),
  'and are the same afternoon in Los Angeles');

/* ── the two days a year that are not 24 hours ─────────────────────────── */

const HOUR = 3_600_000;
const span = (day: string, zone: string): number | null => {
  const b = gymDayBounds(day, zone);
  return b ? (Date.parse(b.toISO) - Date.parse(b.fromISO)) / HOUR : null;
};

eq(span('2026-06-15', LONDON), 24, 'an ordinary London day is 24 hours');
eq(span('2026-06-15', DUBAI), 24, 'and so is every Dubai day, all year');
// 29 March 2026 is the last Sunday in March: the UK springs forward at 01:00.
eq(span('2026-03-29', LONDON), 23, 'the day the clocks go forward is 23 hours long');
// 25 October 2026 is the last Sunday in October.
eq(span('2026-10-25', LONDON), 25, 'and the day they go back is 25');
// The same two Sundays land on different dates in the US, which is the reason
// neither can be special-cased in one place.
eq(span('2026-03-08', LA), 23, 'Los Angeles springs forward three weeks earlier');
eq(span('2026-11-01', LA), 25, 'and falls back a week later');

const june = gymDayBounds('2026-06-15', DUBAI);
eq(june?.fromISO, '2026-06-14T20:00:00.000Z', 'a Dubai day begins at 20:00 UTC the day before');
eq(june?.toISO, '2026-06-15T20:00:00.000Z', 'and ends at 20:00 UTC on the day itself — half open');

eq(gymDayBounds('15/06/2026', DUBAI), null, 'a day that is not an ISO date has no bounds');
eq(gymDayBounds('', DUBAI), null, 'nor an empty one');

// The round trip: every instant inside the bounds belongs to that day, and the
// end instant belongs to the next one. This is what "half open" has to mean or
// two adjacent days both claim the same visit.
for (const zone of [LONDON, DUBAI, LA, KIRITIMATI]) {
  for (const day of ['2026-03-29', '2026-06-15', '2026-10-25', '2026-11-01']) {
    const b = gymDayBounds(day, zone);
    ok(!!b, `${zone} has bounds for ${day}`);
    if (!b) continue;
    eq(gymDay(b.fromISO, zone), day, `${zone}: the first instant of ${day} is on ${day}`);
    eq(gymDay(Date.parse(b.toISO) - 1, zone), day, `${zone}: the last millisecond of ${day} is still ${day}`);
    ok(gymDay(b.toISO, zone) !== day, `${zone}: and the end instant has already moved on from ${day}`);
  }
}

/* ── the write side: a form field is a wall clock ──────────────────────── */

// The whole defect in three lines. A Dubai gym's 06:00 shift, read in London.
const SHIFT = '2026-06-15T02:00:00.000Z'; // 06:00 in Dubai
eq(gymWallValue(SHIFT, DUBAI), '2026-06-15T06:00', 'the field shows the hour the shift actually runs at');
eq(gymWallValue(SHIFT, LONDON), '2026-06-15T03:00', 'and a London gym’s own 03:00 is a different shift');
eq(gymWallValue(SHIFT, null), null, 'no zone, no wall clock — the caller falls back and says so');
eq(gymWallValue(null, DUBAI), null, 'and no instant, nothing to show');

eq(instantAtGym('2026-06-15T06:00', DUBAI), SHIFT, 'and saving it back writes the same instant it was read from');
eq(instantAtGym('2026-06-15T06:00:00', DUBAI), SHIFT, 'seconds on the end are accepted — some browsers add them');
eq(instantAtGym('2026-06-15T06:00', null), null, 'no zone, no instant: the caller must NOT fall back to new Date(), which is this bug');
eq(instantAtGym('2026-06-15', DUBAI), null, 'a date with no time is not a wall clock');
eq(instantAtGym('', DUBAI), null, 'nor an empty field');

// The round trip in both directions, over the two Sundays and four zones. This
// is the assertion that would have caught a shift moving by an hour twice a
// year, which is the failure nobody reports because it looks like a typo.
for (const zone of [LONDON, DUBAI, LA, KIRITIMATI]) {
  for (const wall of ['2026-03-29T09:30', '2026-06-15T06:00', '2026-10-25T09:30', '2026-11-01T09:30', '2026-12-31T23:59']) {
    const iso = instantAtGym(wall, zone);
    ok(!!iso, `${zone}: ${wall} names an instant`);
    if (iso) eq(gymWallValue(iso, zone), wall, `${zone}: ${wall} survives the round trip`);
  }
}

// 01:30 on 29 March 2026 does not exist in London — the clocks go straight from
// 01:00 to 02:00. It must resolve to something rather than to null, and the
// something must be a real instant.
const nonexistent = instantAtGym('2026-03-29T01:30', LONDON);
ok(!!nonexistent && !Number.isNaN(Date.parse(nonexistent)),
  'an hour the clocks skipped still resolves to a real instant rather than to nothing');
eq(gymWallValue(nonexistent, LONDON), '2026-03-29T02:30',
  'and reads back as the hour that does exist, which is what the browser’s own parser would have chosen');

/* ── the gap between the gym's clock and the reader's ──────────────────── */

eq(gymMinutesAhead(NOON, DUBAI, LONDON), 180, 'Dubai is three hours ahead of London in June');
eq(gymMinutesAhead('2026-01-15T12:00:00Z', DUBAI, LONDON), 240, 'and four in January');
eq(gymMinutesAhead(NOON, LONDON, DUBAI), -180, 'and the sign is the other way round from Dubai');
eq(gymMinutesAhead(NOON, LONDON, LONDON), 0, 'a gym in the reader’s own zone is zero, which is an answer');
// India is half an hour off the hour, which is the case an "hours ahead"
// integer would silently round away.
eq(gymMinutesAhead(NOON, 'Asia/Kolkata', LONDON), 270, 'and a half-hour zone is carried as minutes, not rounded to hours');

eq(zoneGapNote(LONDON, LONDON), null, 'no note when the two clocks agree');
eq(zoneGapNote(null, LONDON), null, 'and none when the gym has no clock — that is a different sentence');
const gap = zoneGapNote(DUBAI, LONDON);
ok(!!gap && gap.includes(DUBAI) && gap.includes(LONDON),
  'the note names both zones, so two colleagues comparing two screens can work out why they differ');
ok(!!gap && /behind/.test(gap), 'and says which way round it is');
const back = zoneGapNote(LA, LONDON);
ok(!!back && /ahead of/.test(back), 'in both directions');
const half = zoneGapNote('Asia/Kolkata', LONDON);
ok(!!half && /30m|30 minutes/.test(half), 'and a half-hour gap is stated as one');

/* ── the reader's own zone ─────────────────────────────────────────────── */

// About the runner, so it asserts a relationship rather than a value. Under
// `npm run test:zones` this runs in six zones and must pass in all six.
const mine = readerZone();
ok(mine === null || isZone(mine), 'the reader’s zone is either unknown or a zone this runtime resolves');
if (mine) {
  eq(gymMinutesAhead(NOON, mine, mine), 0, 'and it is zero minutes from itself');
  eq(gymDay(NOON, mine), gymDay(NOON, mine), 'and stable across two reads');
}

/* ── the picker ────────────────────────────────────────────────────────── */

const opts = zoneOptions();
ok(Array.isArray(opts), 'the options are a list even where the runtime has none');
// Not "the list is long": a runtime without `supportedValuesOf` honestly has
// none, and the caller's job is to fall back to a text field.
ok(opts.length === 0 || opts.every((z) => isZone(z)), 'and everything in it is a zone this runtime can resolve');
ok(opts.length === 0 || opts.includes(LONDON), 'and a populated list holds the ordinary ones');

/* ── the note ──────────────────────────────────────────────────────────── */

ok(/timezone/i.test(NO_ZONE_NOTE), 'the silence names what is missing');
ok(/your own device|device’s/i.test(NO_ZONE_NOTE),
  'and says whose clock the screen is therefore drawing — not that the figures are unavailable');

/* ── reading the column ────────────────────────────────────────────────── */

const sbWith = (row: unknown, error: unknown = null) => ({
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: row, error }) }) }) }),
});

(async () => {
  const set = await fetchGymZone(sbWith({ timezone: DUBAI }), 't');
  eq(set.zone, DUBAI, 'a stored zone reads back');
  eq(set.error, null, 'with no error');

  const unset = await fetchGymZone(sbWith({ timezone: null }), 't');
  eq(unset.zone, null, 'a gym that has not said has no zone');
  eq(unset.error, null, 'and that is not an error — it is a setting nobody has made');

  const blank = await fetchGymZone(sbWith({ timezone: '   ' }), 't');
  eq(blank.zone, null, 'and whitespace is the same as nothing');

  // The one that would put a timezone on screen that nothing can render in.
  const junk = await fetchGymZone(sbWith({ timezone: 'Europe/Londn' }), 't');
  eq(junk.zone, null, 'a stored value this runtime cannot resolve is reported as no zone');
  eq(junk.error, null, 'and not as a failed read, because the read succeeded');

  // supabase-js RESOLVES on a database error, so this is the case that turns a
  // refused read into "the gym has not set a timezone" and sends an owner to
  // change a setting that was already right.
  const failed = await fetchGymZone(sbWith(null, { message: 'permission denied' }), 't');
  eq(failed.zone, null, 'a failed read has no zone');
  ok(!!failed.error && /permission/.test(failed.error), 'and says so, separately from the value');

  if (errors.length) {
    console.error(`gymZone: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log('gymZone ok');
})();
