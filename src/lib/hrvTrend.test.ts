// HRV against the member's own baseline.
//
// Compile with tsc, then run under plain node.
//
// The defect: the app printed "62 ms HRV" and kept nothing, against a type
// whose own documentation says HRV "is deliberately NOT comparable between
// people … every screen that prints it prints it as a trend against that
// member's own history". A bare number is not a smaller version of that. So the
// assertions are about the ways a baseline can be dishonest: too few nights, a
// night compared against itself, one bad night dragging the whole thing, and a
// verdict returned where there is nothing to compare against.
import {
  BASELINE_MIN, BASELINE_NIGHTS, TYPICAL_FLOOR_MS,
  hrvBaseline, hrvTrendOf, hrvTrendLine, hrvBuildingLine, rowToHrvNight, hrvNightToRow,
  type HrvNight,
} from './hrvTrend';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A run of nights ending the day before `2026-09-01`, newest last. */
function nights(values: number[], from = '2026-08-01'): HrvNight[] {
  const [y, m, d] = from.split('-').map(Number);
  return values.map((ms, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const night = dt.toISOString().slice(0, 10);
    return { night, ms, provider: 'whoop' as const, sourceName: 'WHOOP' };
  });
}

/* ── 1. a baseline refuses to exist until it can ──────────────────────────── */

eq(hrvBaseline([], '2026-09-01'), null, 'no nights is no baseline');
eq(hrvBaseline(nights([50, 52, 48]), '2026-09-01'), null,
  'and neither are three — a trend drawn against three readings is a claim the data cannot support');
const seven = hrvBaseline(nights([50, 52, 48, 51, 49, 53, 47]), '2026-09-01');
ok(seven != null, `${BASELINE_MIN} nights is a baseline`);
eq(seven!.nights, 7, 'and it says how many it is made of');
eq(seven!.ms, 50, 'the median of those seven');

/* ── 2. the median, not the mean ──────────────────────────────────────────── */

// One night on a plane. The mean of these is 45.9; the median is 50, which is
// what the member's ordinary night actually is.
const withOutlier = hrvBaseline(nights([50, 52, 48, 51, 49, 53, 20]), '2026-09-01')!;
eq(withOutlier.ms, 50, 'one bad night does not move the baseline, which is the whole reason it is a median');

/* ── 3. tonight is never in its own baseline ──────────────────────────────── */

const run = nights([50, 52, 48, 51, 49, 53, 47]);          // 2026-08-01..07
const tonight = { night: '2026-08-08', ms: 200, provider: 'whoop' as const, sourceName: 'WHOOP' };
const base = hrvBaseline([...run, tonight], '2026-08-08')!;
eq(base.nights, 7, 'tonight is excluded from the set it is being compared against');
eq(base.ms, 50, 'so a wild reading tonight cannot flatten its own verdict');

/* ── 4. one answer per night ──────────────────────────────────────────────── */

const doubled = [...run, { night: '2026-08-01', ms: 999, provider: 'oura' as const, sourceName: 'Ring' }];
eq(hrvBaseline(doubled, '2026-09-01')!.nights, 7, 'two rows for one night are one night, not two');

/* ── 5. the window ────────────────────────────────────────────────────────── */

const long = hrvBaseline(nights(Array.from({ length: 60 }, () => 50)), '2026-12-01')!;
eq(long.nights, BASELINE_NIGHTS, 'the window caps how far back it looks');
// A gap does not destroy a baseline: the window is the last N nights that
// EXIST, not the last N calendar days.
const sparse = [...nights([50, 52, 48, 51, 49, 53, 47], '2026-01-01')];
ok(hrvBaseline(sparse, '2026-09-01') != null, 'nights from months ago still form a baseline if they are all there is');

/* ── 6. the verdict ───────────────────────────────────────────────────────── */

const b = { ms: 50, nights: 30 };
eq(hrvTrendOf(50, b)!.band, 'typical', 'a night on the baseline is typical');
eq(hrvTrendOf(54, b)!.band, 'typical', 'and so is one inside the tolerance');
eq(hrvTrendOf(60, b)!.band, 'above', 'well above is above');
eq(hrvTrendOf(40, b)!.band, 'below', 'and well below is below');
eq(hrvTrendOf(60, b)!.deltaMs, 10, 'the difference is reported as a signed figure');
eq(hrvTrendOf(40, b)!.deltaMs, -10, 'in both directions');

// The floor. Ten per cent of a low baseline is inside what the strap can
// resolve, so the band does not narrow past three milliseconds.
const low = { ms: 20, nights: 30 };
eq(hrvTrendOf(22, low)!.band, 'typical', `two ms off a ${low.ms} ms baseline is noise, not a trend`);
ok(TYPICAL_FLOOR_MS === 3, 'and the floor that makes that true is stated rather than implied');

// Nothing to compare against is never 'typical'.
eq(hrvTrendOf(50, null), null, 'no baseline is no verdict');
eq(hrvTrendOf(null, b), null, 'and no reading is no verdict either');
eq(hrvTrendOf(0, b), null, 'a zero is not a measurement of a heart');

/* ── 7. the sentences ─────────────────────────────────────────────────────── */

const line = hrvTrendLine(hrvTrendOf(60, b)!);
ok(line.includes('10 ms'), 'the line names the size of the difference');
ok(line.includes('50 ms'), 'and the baseline it is a difference from');
ok(line.includes('30 nights'), 'and how many nights that baseline is made of');
ok(hrvTrendLine(hrvTrendOf(50, b)!).toLowerCase().includes('usual'), 'an ordinary night is said plainly rather than left blank');
ok(hrvBuildingLine(3).includes(String(BASELINE_MIN)), 'and a member without a baseline is told what it is counting toward');
ok(hrvBuildingLine(0).length > 0, 'including on the first night');

/* ── 8. the row, both ways ────────────────────────────────────────────────── */

const row = { night: '2026-08-08', hrv_ms: '62.4', provider: 'whoop', source_name: 'WHOOP' };
eq(rowToHrvNight(row)!.ms, 62.4, 'a numeric handed back as a string is still a number');
eq(rowToHrvNight({ ...row, hrv_ms: 0 }), null, 'a zero is not a reading');
eq(rowToHrvNight({ ...row, source_name: '' }), null, 'and a figure with no source is not shown at all');
eq(rowToHrvNight({ ...row, night: 'last tuesday' }), null, 'and neither is one with no readable night');
eq(rowToHrvNight(null), null, 'nothing in, nothing out');

const back = hrvNightToRow('u1', { night: '2026-08-08', ms: 62.4, provider: 'whoop', sourceName: 'WHOOP' });
eq(back.user_id, 'u1', 'the row is written for the caller');
eq(back.hrv_ms, 62.4, 'carrying the figure');
eq(back.source_name, 'WHOOP', 'and who measured it');

if (errors.length) {
  console.error(`hrvTrend.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('hrvTrend.test.ts — ok');
