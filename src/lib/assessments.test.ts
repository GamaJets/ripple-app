// Coach assessments. Compile with tsc, run with node.
//
// The bugs these guard:
//   · an unscored pattern or ungraded check counted as zero in a total;
//   · a lower-is-better test (a row time) shown as improving when it got slower;
//   · a total unreadable off the wire becoming 0 and a change being computed off it.
import {
  MOVEMENT_PATTERNS, MOBILITY_CHECKS, MOVEMENT_TOTAL_MAX, buildRecord, readAssessments,
  compareToPrevious, groupSeries, totalLabel, changeLabel, slug, detailLines,
  type Assessment, type AssessmentWire,
} from './assessments';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── movement screen ────────────────────────────────────────────────────── */

const allTwos = Object.fromEntries(MOVEMENT_PATTERNS.map((p) => [p.key, 2]));
const m = buildRecord({ kind: 'movement', scores: allTwos });
ok(m.ok, 'a fully scored screen saves');
if (m.ok) { eq(m.row.total, 14, 'seven twos total fourteen'); eq(m.row.test_key, 'fms', 'one series for the screen'); }
eq(MOVEMENT_TOTAL_MAX, 21, 'the screen is out of 21');
const missing = buildRecord({ kind: 'movement', scores: { ...allTwos, deep_squat: null } });
ok(!missing.ok, 'an unscored pattern is refused, not counted as zero');
ok(!buildRecord({ kind: 'movement', scores: { ...allTwos, hurdle_step: 4 } }).ok, 'a 4 is off the 0-3 scale');
ok(!buildRecord({ kind: 'movement', scores: { ...allTwos, hurdle_step: 1.5 } }).ok, 'a half is not a score');
ok(buildRecord({ kind: 'movement', scores: { ...allTwos, hurdle_step: 0 } }).ok, 'a real zero is a score');

/* ── strength ───────────────────────────────────────────────────────────── */

const s = buildRecord({ kind: 'strength', lift: 'back_squat', weightKg: 100, reps: 5 });
ok(s.ok, 'a lift with load and reps saves');
if (s.ok) { eq(s.row.total, 117, 'Epley 100 kg x 5 is 117'); eq(s.row.unit, 'kg', 'stored in kilograms'); }
ok(!buildRecord({ kind: 'strength', lift: 'back_squat', weightKg: null, reps: 5 }).ok, 'no load, no estimate');
ok(!buildRecord({ kind: 'strength', lift: 'back_squat', weightKg: 100, reps: 31 }).ok, 'past 30 reps is refused');
ok(!buildRecord({ kind: 'strength', lift: 'curl', weightKg: 20, reps: 5 }).ok, 'an unknown lift is refused');

/* ── mobility ───────────────────────────────────────────────────────────── */

const grades = Object.fromEntries(MOBILITY_CHECKS.map((c) => [c.key, 'pass' as const]));
const mob = buildRecord({ kind: 'mobility', grades: { ...grades, hip_rotation: 'partial', hamstring_length: 'fail' } });
ok(mob.ok, 'a fully graded check saves');
if (mob.ok) eq(mob.row.total, 7, 'three passes, a partial and a fail are 7 of 10');
ok(!buildRecord({ kind: 'mobility', grades: { ...grades, hip_rotation: null } }).ok, 'an ungraded check is refused');

/* ── custom ─────────────────────────────────────────────────────────────── */

const c = buildRecord({ kind: 'custom', name: ' Row 2km ', value: 7.5, unit: 'min', direction: 'lower' });
ok(c.ok, 'a named custom test saves');
if (c.ok) { eq(c.row.test_key, 'row_2km', 'the key is the slug'); eq(c.row.results.name, 'Row 2km', 'the name is trimmed'); }
eq(slug('ROW 2KM'), 'row_2km', 'case does not split a series');
ok(!buildRecord({ kind: 'custom', name: '  ', value: 1, unit: '', direction: 'higher' }).ok, 'an unnamed test is refused');
ok(!buildRecord({ kind: 'custom', name: 'Plank', value: null, unit: 's', direction: 'higher' }).ok, 'no value is refused');

/* ── reading and comparing ──────────────────────────────────────────────── */

const wire = (id: string, at: string, total: unknown, extra: Partial<AssessmentWire> = {}): AssessmentWire =>
  ({ id, client_id: 'c', coach_id: 'k', kind: 'custom', test_key: 'row_2km', recorded_at: at, total, unit: 'min', results: { name: 'Row 2km', direction: 'lower' }, ...extra });

const rows = readAssessments([
  wire('b', '2026-09-01T10:00:00Z', '7.4'),
  wire('a', '2026-08-01T10:00:00Z', 7.9),
  wire('x', 'not a date', 7),
  wire('y', '2026-08-02T10:00:00Z', 7, { kind: 'dance' }),
]);
eq(rows.length, 2, 'undated and unknown-kind rows are dropped');
eq(rows[0].id, 'a', 'oldest first');
eq(rows[1].total, 7.4, 'a numeric string is the number it says');

const cmp = compareToPrevious(rows)!;
ok(Math.abs((cmp.change ?? 0) + 0.5) < 1e-9, 'change is latest minus previous');
eq(cmp.verdict, 'better', 'a faster row is an improvement on a lower-is-better test');
eq(compareToPrevious(rows, 'higher')!.verdict, 'worse', 'and the same drop is worse when higher is better');
eq(changeLabel(cmp, 'kg', null), '−0.5 min', 'the change states its unit and sign');

const unknown = readAssessments([wire('a', '2026-08-01T10:00:00Z', null), wire('b', '2026-09-01T10:00:00Z', 7)]);
eq(unknown[0].total, null, 'a missing total is null, not zero');
const uc = compareToPrevious(unknown)!;
eq(uc.change, null, 'no change is computed off an unknown');
eq(uc.verdict, null, 'and no verdict');

const single = compareToPrevious(rows.slice(0, 1))!;
eq(single.previous, null, 'a first result has nothing before it');
eq(changeLabel(single, 'kg', null), 'First result on record', 'and says so');
eq(compareToPrevious([]), null, 'no history, no comparison');

const flat = readAssessments([wire('a', '2026-08-01T10:00:00Z', 7), wire('b', '2026-09-01T10:00:00Z', 7)]);
eq(compareToPrevious(flat)!.verdict, 'same', 'no movement is the same');

/* ── strength in the viewer's unit ──────────────────────────────────────── */

const lifts = readAssessments([
  { id: '1', kind: 'strength', test_key: 'deadlift', recorded_at: '2026-08-01T00:00:00Z', total: 100, unit: 'kg', results: { weightKg: 90, reps: 4 } },
  { id: '2', kind: 'strength', test_key: 'deadlift', recorded_at: '2026-09-01T00:00:00Z', total: 110, unit: 'kg', results: { weightKg: 100, reps: 3 } },
]);
const lc = compareToPrevious(lifts)!;
eq(lc.verdict, 'better', 'a heavier estimate is better');
eq(totalLabel(lc.latest, 'kg'), 'Est. 1RM 110 kg', 'kilograms for a kilogram reader');
eq(totalLabel(lc.latest, 'lb'), 'Est. 1RM 243 lb', 'pounds for a pound reader');
eq(changeLabel(lc, 'lb', null), '+22 lb', 'the change converts too');
eq(detailLines(lc.latest, 'kg')[0], '100 kg × 3 reps', 'the set it came from');

/* ── series ─────────────────────────────────────────────────────────────── */

const series = groupSeries([...rows, ...lifts]);
eq(series.length, 2, 'one series per test');
eq(series[0].label, 'Row 2km', 'most recently recorded first, labelled by name');
eq(series[0].direction, 'lower', 'the direction comes from the test');
eq(series[1].label, 'Deadlift', 'a strength series is named for its lift');

const mv = readAssessments([{ id: 'm', kind: 'movement', test_key: 'fms', recorded_at: '2026-09-01T00:00:00Z', total: 15, unit: 'points', results: { scores: {} } }]);
eq(totalLabel(mv[0], 'kg'), '15/21', 'a movement screen reads out of 21');
eq(detailLines(mv[0], 'kg')[0], 'Deep Squat not scored', 'a missing score is said, not zeroed');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('assessments: ok');
