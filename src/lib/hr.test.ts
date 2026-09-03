// The heart-rate scale, and the age it is drawn against.
//
// Compile with tsc, then run under plain node.
//
// This file exists for one defect and keeps the rest of the module honest while
// it is here. The defect: `maxHr` fell back to an age of thirty for anybody the
// app had no date of birth for, and nothing anywhere said so. A member of
// fifty-five reading their live heart rate mid-set was shown a zone 5 that
// starts 23 bpm above the top of their own range — the app telling the person
// least able to afford it to push harder.
//
// So the assertions below are about the seam between a measured age and a
// guessed one:
//
//   · the guess is still made, because zones with no colour on them are a worse
//     product than approximate ones (see the note on ASSUMED_AGE);
//   · the guess is always REPORTABLE, so no screen can print a zone without
//     being able to say where the scale came from;
//   · every shape of missing age lands on the guess and none of them lands on
//     it silently — a zero, a negative, a NaN and an absent value are all
//     "nobody told us" and none of them is an age.
//
// Nothing here asserts a formatted date or a locale: `npm test` runs under six
// timezones and this module has no dates in it.
import {
  ZONES, ZONE_NOS, ASSUMED_AGE, maxHr, hrScaleBasis, hrScaleNote, zoneOf, zoneBands,
  zoneDef, zoneName, splatPoints, emptyZoneSeconds, zoneSecondsTotal, timeInZones,
  hrStats, hrZoneLabel, hrZoneNo, ageFromDob,
} from './hr';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── 1. the scale, and where it came from ─────────────────────────────────── */

eq(maxHr(55), 165, 'a member of 55 is scaled against their own age');
eq(maxHr(30), 190, 'and so is a member of exactly the assumed age');
eq(hrScaleBasis(55), 'age', 'a real age is reported as a real age');
eq(hrScaleNote(55), null, 'and says nothing on screen, because there is nothing to admit');

// The fallback itself. Kept, and named, rather than removed — see ASSUMED_AGE.
eq(maxHr(null), 220 - ASSUMED_AGE, 'no age falls back to the assumed one');
eq(maxHr(undefined), 220 - ASSUMED_AGE, 'and so does an absent one');
eq(maxHr(0), 220 - ASSUMED_AGE, 'a zero is nobody\'s age, so it is the guess too');
eq(maxHr(-4), 220 - ASSUMED_AGE, 'and so is a negative');
eq(maxHr(NaN), 220 - ASSUMED_AGE, 'and so is a NaN, which is what an unparsed date of birth becomes');

for (const missing of [null, undefined, 0, -4, NaN]) {
  eq(hrScaleBasis(missing as number | null | undefined), 'assumed',
    `a missing age (${String(missing)}) is reported as assumed`);
  ok(typeof hrScaleNote(missing as number | null | undefined) === 'string',
    `and carries a sentence a screen can print (${String(missing)})`);
}

// THE assertion this file was written for. The gap is real and it is large, and
// the point is that it can now be stated rather than that it is gone.
const guessedZ5 = zoneBands(null).find((z) => z.no === 5)!;
const realZ5 = zoneBands(55).find((z) => z.no === 5)!;
ok(guessedZ5.loBpm - realZ5.loBpm >= 20,
  'the guessed scale really does put zone 5 more than 20 bpm above a 55-year-old\'s own');
ok((hrScaleNote(null) ?? '').includes(String(ASSUMED_AGE)),
  'and the sentence names the age it used, so the member can see why');

/* ── 2. which zone a reading falls in ─────────────────────────────────────── */

// Boundaries at a 30-year-old's 190 bpm max: z2 at 61%, z3 at 71%, z4 at 84%,
// z5 at 92%. Written as fractions of maxHr rather than as hand-computed bpm, so
// this stays true if the percentages are ever re-argued.
const m = maxHr(30);
eq(zoneOf(m * 0.50, 30), 1, 'half of max is zone 1');
eq(zoneOf(m * 0.61, 30), 2, 'the bottom of a band is IN that band');
eq(zoneOf(m * 0.83, 30), 3, 'just under 84% is still base');
eq(zoneOf(m * 0.84, 30), 4, 'and 84% is push');
eq(zoneOf(m * 0.92, 30), 5, '92% is all out');
eq(zoneOf(m * 1.30, 30), 5, 'and a reading above max stays in zone 5 rather than falling off the end');
eq(zoneOf(0, 30), 1, 'a zero reading does not index past the start of the scale');

// Every zone the type allows has a definition and a name. A ZoneNo with no
// entry would be an undefined dereference inside a live workout.
for (const no of ZONE_NOS) {
  ok(!!zoneDef(no), `zone ${no} has a definition`);
  ok(zoneName(no).length > 0, `zone ${no} has a name to print beside its colour`);
}
eq(ZONES.length, ZONE_NOS.length, 'the scale and the list of its numbers are the same length');

/* ── 3. the bands a chart draws ───────────────────────────────────────────── */

const bands = zoneBands(40);
eq(bands.length, 5, 'five bands');
for (let i = 1; i < bands.length; i++) {
  ok(bands[i].loBpm >= bands[i - 1].loBpm, `band ${i + 1} starts at or above band ${i}`);
  ok(bands[i].hiBpm > bands[i].loBpm, `band ${i + 1} has width`);
}

/* ── 4. time in zone, and the splat points that come off it ───────────────── */

const empty = emptyZoneSeconds();
eq(zoneSecondsTotal(empty), 0, 'an empty zone tally totals nothing');
eq(splatPoints(empty), 0, 'and earns nothing');

// One per whole minute at or above zone 4, and a part minute is not a splat.
eq(splatPoints({ ...empty, z4: 59 }), 0, 'fifty-nine seconds of push is not a splat point');
eq(splatPoints({ ...empty, z4: 60 }), 1, 'a whole minute is one');
eq(splatPoints({ ...empty, z4: 90, z5: 90 }), 3, 'zone 4 and zone 5 count together');
eq(splatPoints({ ...empty, z1: 6000, z2: 6000, z3: 6000 }), 0, 'and nothing below zone 4 counts at all');

// Seconds are inferred from the gap between samples, and an impossible gap — a
// watch paused in a pocket for an hour — is clamped rather than filed as an
// hour in whatever zone the member happened to be in when they stopped.
const zs = timeInZones([
  { t: '2026-09-01T10:00:00.000Z', bpm: 120 },
  { t: '2026-09-01T10:00:30.000Z', bpm: 175 },
  { t: '2026-09-01T11:30:00.000Z', bpm: 175 },
], 30);
eq(zs.z2 + zs.z3, 30, 'the gap between two samples is credited to the first one\'s zone');
ok(zs.z4 + zs.z5 <= 20, 'and a ninety-minute gap is clamped, not counted');

// Order is not the caller's problem: samples arrive out of order from a merge
// of two devices, and a negative gap would otherwise subtract time.
const unsorted = timeInZones([
  { t: '2026-09-01T10:00:30.000Z', bpm: 120 },
  { t: '2026-09-01T10:00:00.000Z', bpm: 120 },
], 30);
ok(zoneSecondsTotal(unsorted) > 0, 'out-of-order samples still total forwards');

/* ── 5. reading a series, and reading one number out of it ────────────────── */

eq(hrStats([]), null, 'no samples is null, never a zero average');
const stats = hrStats([
  { t: 'a', bpm: 100 }, { t: 'b', bpm: 0 }, { t: 'c', bpm: 160 },
])!;
eq(stats.low, 100, 'a zero reading is dropped rather than becoming the low');
eq(stats.high, 160, 'the high is the high');
eq(stats.avg, 130, 'and the average is over the readings that exist');

eq(hrZoneLabel(null), '—', 'no reading draws a dash rather than a zone');
eq(hrZoneNo(null), null, 'and has no numeral');
ok(hrZoneLabel(m * 0.92, 30).startsWith('Zone 5'), 'the label leads with the number, because colour alone is not enough');

/* ── 6. age off a date of birth ───────────────────────────────────────────── */

eq(ageFromDob(null), null, 'no date of birth is no age — never a zero, which would read as a real age of the assumed one');
eq(ageFromDob('not a date'), null, 'and neither is a string that is not one');
eq(ageFromDob('1971-09-01', Date.parse('2026-09-01T12:00:00.000Z')), 55, 'a birthday reads as the age it is');
eq(ageFromDob('1800-01-01', Date.parse('2026-09-01T12:00:00.000Z')), null, 'and an impossible age is refused rather than scaled against');

if (errors.length) {
  console.error(`hr.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('hr.test.ts — ok');
