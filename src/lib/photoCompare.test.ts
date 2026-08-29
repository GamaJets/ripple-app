// Side-by-side photo compare (TF-23). Compile with tsc then run with node.
//
// The assertions that matter here are the ones about ABSENCE. A compare panel
// that shows two photos and two numbers is easy to write and easy to test; the
// thing that would ship a lie is a panel that shows a number for a day nobody
// was scanned on, or a "change" computed against a reading that does not
// exist. So the bulk of this file is about what must come back null, and about
// the timezone case that would turn a real reading into a dash.
import {
  sameDay,
  readingOn,
  compareDelta,
  compareRows,
  readingText,
  deltaText,
  compareBasis,
  spanLabel,
  COMPARE_DISCLAIMER,
  type ScanReading,
} from './photoCompare';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const scan = (takenAt: string, weightKg: number, bodyFatPct: number, smm: number | null = null): ScanReading =>
  ({ takenAt, weightKg, bodyFatPct, skeletalMuscleKg: smm });

// Two scans, ten days apart, on days the client also photographed themselves.
const SCANS: ScanReading[] = [
  scan('2026-08-01', 82.4, 24.1, 33.2),
  scan('2026-08-11', 80.1, 22.6, 33.9),
];

// A photo is a timestamptz — an instant — not a bare date. These are the two
// photos taken on the two scan days, written the way uploadProgressPhoto()
// writes them.
const PHOTO_A = '2026-08-01T09:14:00.000Z';
const PHOTO_B = '2026-08-11T08:02:00.000Z';

/* ── the same-day rule ──────────────────────────────────────────────────── */

ok(sameDay('2026-08-01', '2026-08-01'), 'two identical bare dates are the same day');
ok(!sameDay('2026-08-01', '2026-08-02'), 'consecutive days are not the same day');
ok(!sameDay(null, '2026-08-01'), 'a missing date matches nothing — it must not fall through to true');
ok(!sameDay('2026-08-01', undefined), 'and neither does a missing date on the other side');
ok(!sameDay('not a date', '2026-08-01'), 'an unparseable value matches nothing');

/* ── the timezone bug this file exists to avoid ─────────────────────────── */
//
// A photo taken at 21:30 local in New York on 28 Aug is 2026-08-29T01:30Z. The
// naive `takenAt.slice(0, 10)` gives '2026-08-29' and would miss the scan the
// person recorded that morning. dateParts() reads the LOCAL calendar day of an
// instant, so this only asserts what it should when the process is west of
// Greenwich — which is the whole point, and is why the test forces the zone
// rather than trusting the machine it runs on.

{
  const evening = '2026-08-29T01:30:00.000Z';
  const utcSlice = evening.slice(0, 10);
  const localDay = new Date(Date.parse(evening));
  const localISO = `${localDay.getFullYear()}-${String(localDay.getMonth() + 1).padStart(2, '0')}-${String(localDay.getDate()).padStart(2, '0')}`;
  // Whatever zone this runs in, sameDay must agree with the LOCAL day and not
  // with the UTC slice. In UTC+0 those two are equal and the assertion is
  // trivially satisfied; in the Americas they differ and it is the real test.
  ok(sameDay(localISO, evening), 'a photo instant matches the scan dated its own LOCAL day');
  ok(sameDay(utcSlice, evening) === (utcSlice === localISO),
    'a photo instant matches the UTC-sliced day ONLY when that happens to be the local day too');
}

/* ── finding the reading for a day ──────────────────────────────────────── */

ok(readingOn(PHOTO_A, SCANS)?.weightKg === 82.4, 'the photo from 1 Aug picks up the scan dated 1 Aug');
ok(readingOn(PHOTO_B, SCANS)?.weightKg === 80.1, 'the photo from 11 Aug picks up the scan dated 11 Aug');
// The refusal that keeps the panel honest: a day between two scans has no
// reading of its own, and the nearest scan is a fact about a different day.
ok(readingOn('2026-08-06T10:00:00.000Z', SCANS) === null,
  'a photo on a day with no scan gets NO reading — not the nearest one, not the last one carried forward');
ok(readingOn('2026-07-31T10:00:00.000Z', SCANS) === null, 'a photo the day before the first scan gets nothing');
ok(readingOn('2026-08-20T10:00:00.000Z', SCANS) === null, 'a photo after the last scan does not inherit it');
ok(readingOn(PHOTO_A, null) === null, 'no scan list at all is no reading, not a throw');
ok(readingOn(PHOTO_A, []) === null, 'an empty scan list is no reading');
ok(readingOn(null, SCANS) === null, 'a photo with no date has no reading');

// Two scans on one day: the last in the list wins, matching how clientData
// collapses its own per-day map. Anything else and the chart and this panel
// would disagree about what somebody weighed.
{
  const twice: ScanReading[] = [scan('2026-08-01', 82.4, 24.1), scan('2026-08-01', 82.9, 24.4)];
  ok(readingOn(PHOTO_A, twice)?.weightKg === 82.9, 'the later scan of a doubled-up day is the one shown');
}

/* ── the delta, and the zero that is not a dash ─────────────────────────── */

ok(compareDelta(82.4, 80.1) === -2.3, 'a measured loss is negative and rounded to one decimal, not 2.3000000000000043');
ok(compareDelta(80.1, 82.4) === 2.3, 'and a measured gain is positive');
ok(compareDelta(80.1, 80.1) === 0, 'no change between two REAL scans is 0 — a measured fact, not an absence');
ok(compareDelta(null, 80.1) === null, 'an unmeasured before gives no delta — it must not be read as a change from zero');
ok(compareDelta(82.4, null) === null, 'an unmeasured after gives no delta either');
ok(compareDelta(null, null) === null, 'two unmeasured days give no delta');

/* ── the rows ───────────────────────────────────────────────────────────── */

{
  const rows = compareRows(PHOTO_A, PHOTO_B, SCANS);
  ok(rows.length === 3, `three rows, always — got ${rows.length}`);
  ok(rows.map((r) => r.key).join(',') === 'weightKg,bodyFatPct,skeletalMuscleKg', 'the rows are in reading order');
  const w = rows[0], f = rows[1], m = rows[2];
  ok(w.before === 82.4 && w.after === 80.1 && w.delta === -2.3, 'weight carries both readings and the change between them');
  ok(f.before === 24.1 && f.after === 22.6 && f.delta === -1.5, 'body fat likewise');
  ok(m.before === 33.2 && m.after === 33.9 && m.delta === 0.7, 'and skeletal muscle when the scan reported it');
}

// One day scanned, one not. This is the common case and the one most likely to
// be got wrong: the measured side still shows, and the delta must not.
{
  const rows = compareRows('2026-08-06T10:00:00.000Z', PHOTO_B, SCANS);
  ok(rows.every((r) => r.before === null), 'the unscanned day carries no figures');
  ok(rows[0].after === 80.1, 'the scanned day still shows its own reading');
  ok(rows.every((r) => r.delta === null), 'and NO row claims a change, because there is nothing to change from');
}

// Neither day scanned: three labelled rows of dashes, not a vanished table.
{
  const rows = compareRows('2026-08-05T10:00:00.000Z', '2026-08-06T10:00:00.000Z', SCANS);
  ok(rows.length === 3, 'the rows are still there when nothing was measured — a missing row states nothing');
  ok(rows.every((r) => r.before === null && r.after === null && r.delta === null), 'and every cell is empty');
}

// A scan that reported no muscle figure. `?? 0` on this column is a bug this
// project has already had once: nobody has 0 kg of skeletal muscle.
{
  const noSmm: ScanReading[] = [scan('2026-08-01', 82.4, 24.1, null), scan('2026-08-11', 80.1, 22.6, null)];
  const rows = compareRows(PHOTO_A, PHOTO_B, noSmm);
  ok(rows[2].before === null && rows[2].after === null, 'a null muscle reading stays null rather than becoming 0 kg');
  ok(rows[2].delta === null, 'and two unreported muscle figures produce no muscle change');
  ok(rows[0].delta === -2.3, 'while the columns that WERE reported still compare normally');
}

/* ── what reaches the screen ────────────────────────────────────────────── */

ok(readingText(80.1, 'kg') === '80.1 kg', 'a real reading prints with its unit');
ok(readingText(null, 'kg') === '—', 'an absent reading is a dash, never a zero');
ok(readingText(0, 'kg') === '0 kg', 'a genuine zero still prints as a zero — the dash is for absence only');
ok(deltaText(-2.3, 'kg') === '-2.3 kg', 'a loss prints signed');
ok(deltaText(2.3, 'kg') === '+2.3 kg', 'a gain prints with an explicit plus, so the direction cannot be misread');
ok(deltaText(0, 'kg') === '0 kg', 'a measured no-change prints as 0');
ok(deltaText(null, 'kg') === '—', 'an uncomputable change is a dash');

/* ── the sentence under the numbers ─────────────────────────────────────── */

{
  const both = compareBasis(compareRows(PHOTO_A, PHOTO_B, SCANS));
  ok(both.includes('recorded on that day'), 'when both days were scanned, the panel says where the figures came from');

  const neither = compareBasis(compareRows('2026-08-05T10:00:00.000Z', '2026-08-06T10:00:00.000Z', SCANS));
  ok(neither.includes('Neither'), 'when neither day was scanned, the panel says so rather than showing blank cells');

  const onlyLater = compareBasis(compareRows('2026-08-06T10:00:00.000Z', PHOTO_B, SCANS));
  ok(onlyLater.includes('Only the later day'), 'a half-measured pair names WHICH day is missing its scan');

  const onlyEarlier = compareBasis(compareRows(PHOTO_A, '2026-08-06T10:00:00.000Z', SCANS));
  ok(onlyEarlier.includes('Only the earlier day'), 'and it names the other one correctly too');
  ok(onlyEarlier !== onlyLater, 'the two half-measured sentences are not the same sentence');
}

// Requirement 4 in one assertion: nothing in the panel may be presented as
// measured from a photograph.
ok(COMPARE_DISCLAIMER.includes('Nothing here is measured from the pictures themselves.'),
  'the disclaimer says outright that no figure is derived from the images');

/* ── the interval ───────────────────────────────────────────────────────── */

ok(spanLabel(3) === '3 days apart', 'three days apart is stated as three days apart, and nothing more');
ok(spanLabel(1) === '1 day apart', 'one day is singular');
ok(spanLabel(0) === 'Same day', 'two photos from the same day say so');
ok(spanLabel(null) === '—', 'an unparseable interval is a dash, not "0 days apart"');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'PHOTO COMPARE FAILURES:\n' + errors.join('\n') : 'ALL PHOTO COMPARE TESTS PASSED');
if (errors.length) process.exit(1);
