// Provenance, dates and staleness for body figures. Compile with tsc, run with
// node, under all three zones the suite runs in.
//
// Two families of assertion carry this file.
//
// The first is about the DISAGREEMENT that prompted it: Progress showed the
// most recent of {weigh-in, scan} and the composition screen showed the last
// scan, and they were both called "Weight". The tests below pin that a logged
// weigh-in is the latest reading when there is one, that it is labelled a
// weigh-in and not a scan, and — the case that broke the tempting alternative
// implementation — that a weigh-in logged on a day the client was ALSO scanned
// is still classified as a weigh-in.
//
// The second is about dates. `scans.taken_at` is a bare postgres DATE, and
// every one of these assertions is wrong by a day in at least one timezone if
// anything here reaches for `new Date(iso)` arithmetic.
import {
  bodyReadings,
  latestBodyReading,
  daysBetween,
  todayISO,
  dayLabel,
  agoLabel,
  sourceLabel,
  measuredNote,
  stalenessNote,
  mixedSourceNote,
  readingsLabel,
  STALE_AFTER_DAYS,
  type SeriesPoint,
  type BodyReading,
} from './bodyFigures';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── provenance: the whole of report 2 ─────────────────────────────────── */

// Three InBody scans and nothing else. clientData appends no manual point, so
// every reading is a scan and the latest is the newest scan.
const SCANS_ONLY: SeriesPoint[] = [
  { t: '2026-06-01', v: 86.2 },
  { t: '2026-07-01', v: 84.7 },
  { t: '2026-08-01', v: 83.9 },
];
{
  const r = bodyReadings(SCANS_ONLY, 3);
  eq(r.length, 3, 'three scan points give three readings');
  ok(r.every((x) => x.source === 'scan'), 'with no weigh-in appended every reading is a scan');
  eq(latestBodyReading(SCANS_ONLY, 3)?.value, 83.9, 'the latest reading is the newest scan');
  eq(latestBodyReading(SCANS_ONLY, 3)?.source, 'scan', 'and it is labelled a scan');
}

// The same client after a weekly check-in. clientData appends ONE point past
// the scans. This is the state in which the two screens disagreed.
const WITH_WEIGH_IN: SeriesPoint[] = [...SCANS_ONLY, { t: '2026-08-20T07:12:00.000Z', v: 82.1 }];
{
  const latest = latestBodyReading(WITH_WEIGH_IN, 3);
  eq(latest?.value, 82.1, 'the logged weigh-in is the current weight, matching cd.weightKg');
  eq(latest?.source, 'weigh-in', 'and it must not claim to be a scan');
  const asScans = bodyReadings(WITH_WEIGH_IN, 3).filter((r) => r.source === 'scan');
  eq(asScans.length, 3, 'only the first scanCount points are scans');
}

// The case that rules out classifying by the shape of the date string. A client
// scanned on the 20th who also logs a weigh-in that afternoon has a bare-date
// scan and a timestamp weigh-in on the SAME calendar day — and a fourth point
// past three scans is still a weigh-in.
{
  const sameDay: SeriesPoint[] = [
    { t: '2026-06-01', v: 86.2 },
    { t: '2026-07-01', v: 84.7 },
    { t: '2026-08-20', v: 83.9 },
    { t: '2026-08-20T16:40:00.000Z', v: 83.1 },
  ];
  eq(latestBodyReading(sameDay, 3)?.source, 'weigh-in', 'a weigh-in on a scan day is still a weigh-in');
  eq(latestBodyReading(sameDay, 3)?.value, 83.1, 'and it is the figure Progress shows');
}

// Nothing measured is null, never a zero and never a borrowed figure.
eq(latestBodyReading([], 0), null, 'an empty series has no latest reading');
eq(latestBodyReading(null, 0), null, 'and neither does a series that is not there');
eq(measuredNote(null, '2026-08-30'), 'Not measured yet.', 'a missing reading says so rather than printing a date');
eq(stalenessNote(null, '2026-08-30'), null, 'and it cannot be stale, because it does not exist');

// A NaN or a missing date is dropped rather than rendered as a reading.
{
  const dirty: SeriesPoint[] = [{ t: '2026-08-01', v: 83.9 }, { t: '', v: 82 }, { t: '2026-08-05', v: NaN }];
  eq(bodyReadings(dirty, 3).length, 1, 'a point with no date and a point with no number are not readings');
}

/* ── dates, in every timezone the suite runs in ────────────────────────── */

// The bug localDate exists for. Counted from a bare DATE to a bare DATE, these
// are exact whole days wherever the reader is standing.
eq(daysBetween('2026-08-01', '2026-08-01'), 0, 'a day is zero days from itself');
eq(daysBetween('2026-08-01', '2026-08-31'), 30, 'August 1st to the 31st is thirty days');
eq(daysBetween('2026-08-31', '2026-08-01'), -30, 'and the other way round it is negative, not absolute');
// Across the spring-forward boundary in America/Los_Angeles (8 March 2026) one
// of these local midnights is 23 hours from its neighbour, so the span is 167
// hours rather than 168 and `Math.floor` would report six days for seven.
eq(daysBetween('2026-03-05', '2026-03-12'), 7, 'seven days stays seven across a DST boundary');
eq(daysBetween('2026-10-30', '2026-11-06'), 7, 'and across the autumn one, where the span is 169 hours');
eq(daysBetween(null, '2026-08-01'), null, 'a missing date gives no day count');
eq(daysBetween('2026-08-01', 'not a date'), null, 'and neither does an unreadable one');

// A logged weigh-in is a timestamp, not a bare date, and it must be counted
// from the LOCAL calendar day of that instant — which is what "how long ago did
// I weigh myself" means to the person holding the phone. 09:00 UTC on the 20th
// is mid-morning in Los Angeles, evening in Auckland and afternoon in Dubai, so
// the calendar day is the 20th in all three and the answer is the same ten days
// everywhere. Subtracting the two instants and flooring gives nine: the
// clock-time remainder eats a whole day, and a client is told their weigh-in is
// older than it is.
eq(daysBetween('2026-08-20T09:00:00.000Z', '2026-08-30'), 10, 'a weigh-in is counted from its own local day, not from its time of day');

eq(agoLabel('2026-08-30', '2026-08-30'), 'today', 'a reading taken today says today');
eq(agoLabel('2026-08-29', '2026-08-30'), 'yesterday', 'and one from the day before says yesterday');
eq(agoLabel('2026-08-12', '2026-08-30'), '18 days ago', 'otherwise it counts the days');
ok((agoLabel('2026-09-02', '2026-08-30') ?? '').includes('still to come'), 'a back-dated sheet can produce a future date, and it must not print "−3 days ago"');
eq(agoLabel(null, '2026-08-30'), null, 'no date, no claim about age');

// todayISO is the LOCAL day. toISOString().slice(0,10) is the UTC day, which is
// tomorrow in Auckland every evening — so this must agree with the local getters.
{
  const d = new Date(2026, 7, 30, 23, 30);
  eq(todayISO(d), '2026-08-30', 'todayISO reads the local calendar day, not the UTC one');
}

// A bare date renders as the day that was written, in every zone.
ok(dayLabel('2026-08-01').includes('1'), 'a bare date labels as its own day, never the day before');
eq(dayLabel(null), '—', 'no date is a dash');

/* ── staleness: how stale, not merely "old" ────────────────────────────── */

const scanRead = (at: string, value = 83.9): BodyReading => ({ at, value, source: 'scan' });

eq(stalenessNote(scanRead('2026-08-30'), '2026-08-30'), null, "today's scan carries no staleness note");
eq(stalenessNote(scanRead('2026-08-02'), '2026-08-30'), null, `a reading ${STALE_AFTER_DAYS} days old is still inside the window`);
{
  const note = stalenessNote(scanRead('2026-06-01'), '2026-08-30');
  ok(!!note && note.includes('90 days'), 'a stale reading says exactly how stale it is, in days');
  ok(!!note && note.includes('InBody scan'), 'and names what kind of reading has gone stale');
}
{
  const note = stalenessNote({ at: '2026-06-01', value: 82.1, source: 'weigh-in' }, '2026-08-30');
  ok(!!note && note.includes('weigh-in'), 'a stale weigh-in is not described as a stale scan');
}

/* ── saying so on screen ───────────────────────────────────────────────── */

eq(sourceLabel('scan'), 'InBody scan', 'a scan is called a scan');
eq(sourceLabel('weigh-in'), 'weigh-in you logged', 'and a weigh-in is not called a scan');
{
  const note = measuredNote({ at: '2026-08-12', value: 83.9, source: 'scan' }, '2026-08-30');
  ok(note.includes('InBody scan'), 'the note under a figure names its instrument');
  ok(note.includes('18 days ago'), 'and how long ago it was taken');
}

// The sentence that explains a disagreement instead of leaving it to be found.
eq(mixedSourceNote([]), null, 'nothing on screen, nothing to explain');
eq(mixedSourceNote([scanRead('2026-08-12')]), null, 'one figure cannot disagree with anything');
eq(
  mixedSourceNote([scanRead('2026-08-12'), scanRead('2026-08-12', 24.1)]),
  null,
  'two figures off the same scan on the same day need no explanation',
);
{
  const mixed = mixedSourceNote([{ at: '2026-08-20T07:12:00.000Z', value: 82.1, source: 'weigh-in' }, scanRead('2026-08-12', 33.2)]);
  ok(!!mixed && mixed.includes('skeletal muscle'), 'a weigh-in beside a scan explains why muscle is older');
}
{
  const twoDays = mixedSourceNote([scanRead('2026-08-12'), scanRead('2026-06-01', 33.2)]);
  ok(!!twoDays && twoDays.includes('same day'), 'two scans of different dates say so');
}

eq(readingsLabel([]), 'No readings yet', 'an empty metric says it has nothing, not "0 scans"');
eq(readingsLabel([scanRead('2026-08-01'), scanRead('2026-08-12')]), '2 scans', 'scan-only series count scans');
eq(
  readingsLabel([scanRead('2026-08-01'), { at: '2026-08-20', value: 82.1, source: 'weigh-in' }]),
  '1 scan · 1 weigh-in',
  'a mixed series must not be headed "2 scans"',
);
eq(readingsLabel([{ at: '2026-08-20', value: 82.1, source: 'weigh-in' }]), '1 weigh-in', 'and a weigh-in-only series names weigh-ins');

/* ── report ───────────────────────────────────────────────────────────── */

if (errors.length) {
  console.error(`bodyFigures.test: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log('bodyFigures.test: all assertions passed');
