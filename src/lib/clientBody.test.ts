// Reading somebody else's body composition off the wire. Compile with tsc, run
// with node.
//
// The assertions divide in two, and the second half is the half worth having.
// The first says the mapping is right — three columns become three series,
// oldest first, in the coach's unit. The second says the module refuses to
// produce a reading, a change or an empty answer that the rows do not support:
// a scan with no muscle figure contributes NO point rather than a zero, a
// single reading is not a change of zero, a failed read is a different value
// from a client who has never been scanned, and a typed figure is never
// silently mixed into a machine-measured series. A test that only checked the
// happy path would pass just as well against the version of this that showed a
// coach a whole body's worth of muscle lost overnight.
import {
  readBodyHistory, seriesOf, bodyBoard, movementOf, readingLine,
  seriesAgeDays, seriesAgeLine, isSeriesStale, metricUnit, metricValue, metricDelta,
  readManual, manualIsCurrent, manualLine, manualFigures, bodyLine, sourceLabel, storedUnit,
  BODY_METRICS, SCAN_STALE_DAYS, DIRECTION_CAVEAT,
  type BodyScanRow, type ManualRow,
} from './clientBody';

const errors: string[] = [];
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) errors.push(msg); };

const scan = (over: Partial<BodyScanRow> = {}): BodyScanRow => ({
  taken_at: '2026-06-01',
  weight_kg: 82,
  body_fat_pct: 18,
  skeletal_muscle_kg: 35,
  source: 'InBody (OCR)',
  ...over,
});

// ── rows into series ───────────────────────────────────────────────────────

const three = readBodyHistory([
  scan({ taken_at: '2026-08-01', weight_kg: 80, body_fat_pct: 16.2, skeletal_muscle_kg: 36 }),
  scan({ taken_at: '2026-06-01', weight_kg: 82, body_fat_pct: 18, skeletal_muscle_kg: 35 }),
  scan({ taken_at: '2026-07-01', weight_kg: 81, body_fat_pct: 17, skeletal_muscle_kg: 35.5 }),
]);

ok(three.scans === 3, 'three readable rows are three scans');
ok(three.skipped === 0, 'and none of them was skipped');
ok(three.weight.readings.length === 3, 'every scan carries a weight');
ok(three.bodyfat.readings.length === 3, 'and a body fat');
ok(three.muscle.readings.length === 3, 'and a muscle figure');
// Sorted here, not trusted from the caller's `.order()`.
ok(three.weight.readings[0].atISO === '2026-06-01', 'the series is oldest first');
ok(three.weight.readings[2].atISO === '2026-08-01', 'whatever order the rows arrived in');
ok(three.latestScanISO === '2026-08-01', 'and the newest scan date is the newest one');
ok(three.weight.readings[0].source === 'InBody (OCR)', 'the source comes through');

// Postgres numeric reaches supabase-js as a string down some driver paths.
const asStrings = readBodyHistory([scan({ weight_kg: '82.4', body_fat_pct: '18.1', skeletal_muscle_kg: '35.2' })]);
ok(asStrings.weight.readings[0].v === 82.4, 'a numeric column arriving as a string is still a number');
ok(asStrings.muscle.readings[0].v === 35.2, 'including the muscle column');

// ── THE BUG: a null muscle reading is not a zero ───────────────────────────

const noMuscle = readBodyHistory([
  scan({ taken_at: '2026-06-01', weight_kg: 82, body_fat_pct: 18, skeletal_muscle_kg: 35 }),
  scan({ taken_at: '2026-07-01', weight_kg: 81, body_fat_pct: 17, skeletal_muscle_kg: null }),
]);
ok(noMuscle.scans === 2, 'a scan with no muscle figure is still a scan');
ok(noMuscle.weight.readings.length === 2, 'and still contributes a weight');
ok(noMuscle.bodyfat.readings.length === 2, 'and still contributes a body fat');
ok(noMuscle.muscle.readings.length === 1, 'but contributes NO point to the muscle series');
ok(
  noMuscle.muscle.readings.every((r) => r.v !== 0),
  'no zero-kilogram muscle reading is ever produced',
);
// The consequence the `?? 0` version got wrong: with one real point and one
// fabricated zero there would have been a "change" of −35 kg.
ok(movementOf(noMuscle.muscle) === null, 'one muscle reading is not a change');
ok(
  readingLine(noMuscle.muscle, 'kg').startsWith('One reading only'),
  'and it says so in words rather than printing a zero',
);
// An empty muscle series and a measured one are different sentences.
const neverMuscle = readBodyHistory([scan({ skeletal_muscle_kg: null })]);
ok(neverMuscle.muscle.readings.length === 0, 'a lone muscle-less scan leaves the series empty');
ok(
  readingLine(neverMuscle.muscle, 'kg').includes('rather than a zero'),
  'and the empty series says why it is empty',
);
ok(
  readingLine(neverMuscle.weight, 'kg').startsWith('One reading only'),
  'while the weight from that same scan is a reading',
);
// The date the muscle figure carries is its OWN, not the newest scan's.
ok(seriesAgeDays(noMuscle.muscle, '2026-07-01') === 30, 'muscle is aged from its own last reading');
ok(seriesAgeDays(noMuscle.weight, '2026-07-01') === 0, 'and weight from its own, which is newer');

// A zero on the record is a bad row, not a light client.
const zeroed = readBodyHistory([scan({ weight_kg: 0, body_fat_pct: 0, skeletal_muscle_kg: 0 })]);
ok(zeroed.scans === 0, 'a row that measured nothing usable is not counted as a scan');
ok(zeroed.skipped === 1, 'it is counted as skipped instead of vanishing');
ok(zeroed.latestScanISO === null, 'and it does not set a last-scanned date');
const undated = readBodyHistory([scan({ taken_at: 'not a date' })]);
ok(undated.scans === 0 && undated.skipped === 1, 'a reading with no readable date is not a point');

// ── one reading versus several ─────────────────────────────────────────────

const one = readBodyHistory([scan()]);
ok(movementOf(one.weight) === null, 'one weight reading yields no movement');
ok(bodyBoard(one).state === 'scanned', 'though it is still a client who has been scanned');

const mv = movementOf(three.weight)!;
ok(mv != null, 'three readings do yield a movement');
ok(Math.round(mv.deltaStored * 10) / 10 === -2, 'the change is last minus first, in stored units');
ok(mv.days === 61, 'and it knows how long that took');
ok(mv.first.atISO === '2026-06-01' && mv.last.atISO === '2026-08-01', 'across the ends of the series');

const line = readingLine(three.weight, 'kg');
ok(line.startsWith('3 readings'), 'the line counts the readings');
ok(line.includes('−2 kg'), 'and signs the change');
ok(line.includes('1 Jun'), 'and dates what it is measured from');
// Never "since their first scan": under a truncated read the oldest scans are
// the ones that did not arrive, so a date is true where that claim would not be.
ok(!line.includes('first scan'), 'without claiming the earliest reading is their first ever');

const flat = readBodyHistory([
  scan({ taken_at: '2026-06-01', weight_kg: 82 }),
  scan({ taken_at: '2026-07-01', weight_kg: 82 }),
]);
ok(readingLine(flat.weight, 'kg').includes('unchanged'), 'a real zero change reads as unchanged');

// ── units: the coach's, converted as a span ────────────────────────────────

ok(metricUnit('weight', 'lb') === 'lb', 'weight reads in the coach’s unit');
ok(metricUnit('muscle', 'lb') === 'lb', 'so does skeletal muscle');
ok(metricUnit('bodyfat', 'lb') === '%', 'body fat is a percentage in every unit system');
ok(metricValue(18.2, 'bodyfat', 'lb') === 18.2, 'and never converts');
ok(storedUnit('weight') === 'kg' && storedUnit('bodyfat') === '%', 'the stored units are named');
ok(metricValue(80, 'weight', 'kg') === 80, 'kilograms pass through');
ok(metricValue(80, 'weight', 'lb') === 176, '80 kg is 176 lb');

// The span is converted once. Converting the two ENDS and subtracting is the
// bug `weightDeltaIn` exists to prevent: 0.4 kg is 0.88 lb, and two ends
// straddling a pound boundary would report either 0 lb or 2 lb.
const smallStep = readBodyHistory([
  scan({ taken_at: '2026-06-01', weight_kg: 81.9 }),
  scan({ taken_at: '2026-07-01', weight_kg: 82.3 }),
]);
const step = movementOf(smallStep.weight)!;
const spanLb = metricDelta(step.deltaStored, 'weight', 'lb');
const endsLb = metricValue(step.last.v, 'weight', 'lb') - metricValue(step.first.v, 'weight', 'lb');
ok(spanLb === 1, 'a 0.4 kg gain is one pound when the span is converted');
ok(endsLb === 0, 'and would have been reported as no change at all off the two ends');
ok(spanLb !== endsLb, 'which is exactly the difference this module is built to keep');

// ── three empty screens that mean three different things ───────────────────

ok(bodyBoard(null).state === 'unreadable', 'a read that did not come back is unreadable');
ok(bodyBoard(readBodyHistory([])).state === 'none', 'a read that came back empty is none');
ok(bodyBoard(three).state === 'scanned', 'and rows are rows');
ok(
  bodyBoard(null).state !== bodyBoard(readBodyHistory([])).state,
  'a refused read is never the same answer as a client who has never been scanned',
);

// ── staleness ──────────────────────────────────────────────────────────────

ok(SCAN_STALE_DAYS === 42, 'six weeks, matching the tape on the goals screen');
ok(!isSeriesStale(three.weight, '2026-08-20'), '19 days on is not stale');
ok(isSeriesStale(three.weight, '2026-09-20'), '50 days on is');
ok(seriesAgeLine(three.weight, '2026-08-04').includes('3 days ago'), 'the age is printed at every distance');
ok(!seriesAgeLine(three.weight, '2026-08-04').includes('training block'), 'and only fresh readings skip the warning');
ok(seriesAgeLine(three.weight, '2026-09-20').includes('training block'), 'while an old one says how old');
ok(seriesAgeLine(neverMuscle.muscle, '2026-08-04') === 'Never measured.', 'an unmeasured metric has no age');
ok(DIRECTION_CAVEAT.includes('does not colour it in'), 'and nothing here judges the direction');

// ── the client's typed figures are not machine readings ────────────────────

const manualRow = (over: Partial<ManualRow> = {}): ManualRow => ({
  manual_weight_kg: 79.5,
  manual_body_fat_pct: 17.5,
  manual_at: '2026-08-15T08:00:00.000Z',
  ...over,
});

const typed = readManual(manualRow())!;
ok(typed != null, 'a typed weight and body fat is read');
ok(typed.weightKg === 79.5 && typed.bodyFatPct === 17.5, 'with both figures');
ok(readManual(manualRow({ manual_at: null })) === null, 'an undated typed figure is not shown as current');
ok(readManual(manualRow({ manual_weight_kg: null, manual_body_fat_pct: null })) === null, 'and nothing typed is nothing');
ok(readManual(null) === null, 'as is no client row at all');
ok(readManual(manualRow({ manual_weight_kg: 0, manual_body_fat_pct: null })) === null, 'a zero is not a body');

// The typed figures never enter the measured series.
ok(three.weight.readings.every((r) => r.atISO !== typed.atISO), 'a typed weight is never a point on the scan trend');
ok(sourceLabel(three.weight.readings[0]) === 'InBody (OCR)', 'a scan reading names the machine');
ok(sourceLabel({ atISO: '2026-01-01', v: 80, source: null }) === 'source not recorded', 'and an unrecorded source says so');

ok(manualIsCurrent(typed, '2026-08-01'), 'a figure typed after the last scan is what the client is reading');
ok(!manualIsCurrent(typed, '2026-08-20'), 'and a newer scan takes over from it');
ok(manualIsCurrent(typed, null), 'with no scan at all, the typed figure is all there is');
const ml = manualLine(typed, '2026-08-01', 'kg', 'Sam');
ok(ml.includes('typed'), 'the line says the figure was typed');
ok(ml.includes('79.5 kg') && ml.includes('17.5%'), 'and repeats it in the coach’s unit');
ok(ml.includes('their own app is showing them'), 'and says which figure the client is looking at');
ok(manualLine(typed, '2026-08-20', 'kg', 'Sam').includes('only history'), 'or that the scan has overtaken it');
ok(manualLine(typed, '2026-08-01', 'lb', 'Sam').includes('175 lb'), 'the typed weight converts for the coach');
ok(manualLine(typed, null, 'kg', 'Sam').includes('no scan on record'), 'with nothing measured it says so');
// The figures on their own claim nothing about the scans, so a screen whose
// scan read failed can still show them without asserting there are none.
const bare = manualFigures(typed, 'kg', 'Sam');
ok(bare.includes('79.5 kg') && bare.includes('17.5%'), 'the figures alone are the figures');
ok(!bare.includes('scan'), 'and say nothing whatever about the scan record');
ok(manualLine(typed, '2026-08-01', 'kg', 'Sam').startsWith(bare), 'the compared line is built from them');
const onlyWeight = readManual(manualRow({ manual_body_fat_pct: null }))!;
ok(!manualFigures(onlyWeight, 'kg', 'Sam').includes('body fat'), 'a typed weight alone does not invent a body fat');

// ── the summary line on the client screen ──────────────────────────────────

ok(bodyLine(true, false, null, false, '2026-08-20', 'Sam').includes('unknown rather than none'), 'a failed read is not an empty one');
ok(bodyLine(false, true, null, false, '2026-08-20', 'Sam') === 'Reading their scans…', 'a read in flight says so');
ok(bodyLine(false, false, null, false, '2026-08-20', 'Sam').includes('No InBody scan on record'), 'never scanned is its own answer');
ok(bodyLine(false, false, '2026-08-18', false, '2026-08-20', 'Sam').includes('A second one'), 'one scan is a reading, not a trend');
ok(bodyLine(false, false, '2026-08-18', true, '2026-08-20', 'Sam').includes('earlier scans'), 'two or more is a trend');
ok(bodyLine(false, false, '2026-08-18', true, '2026-08-20', 'Sam').includes('2 days ago'), 'and it dates the newest one');

// ── the metric list the screen walks ───────────────────────────────────────

ok(BODY_METRICS.length === 3, 'three metrics');
ok(BODY_METRICS.map((m) => m.key).join(',') === 'weight,bodyfat,muscle', 'in the order the client sees them');
ok(seriesOf(three, 'muscle').label === 'Skeletal muscle', 'and each names itself');
ok(seriesOf(three, 'bodyfat').readings.length === 3, 'seriesOf picks the right one');

if (errors.length) {
  console.error(`clientBody: ${errors.length} of ${checks} checks failed:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`clientBody ok — ${checks} checks`);
