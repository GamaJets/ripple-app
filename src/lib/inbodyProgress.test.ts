import { verdictOf, scanSummary, trendSeries, segmentalOf, segmentOfLayer, compareScans, signed, type ProgressScan } from './inbodyProgress';

const errors: string[] = [];
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const scan = (takenAt: string, w: number, bf: number, smm: number, metrics: ProgressScan['metrics'] = {}): ProgressScan =>
  ({ takenAt, weightKg: w, bodyFatPct: bf, skeletalMuscleKg: smm, metrics });

/* direction per metric */
eq(verdictOf('down', -1.2, 1), 'good', 'fat down is good');
eq(verdictOf('down', 0.8, 1), 'bad', 'fat up is bad');
eq(verdictOf('up', 0.5, 1), 'good', 'muscle up is good');
eq(verdictOf('up', -0.5, 1), 'bad', 'muscle down is bad');
eq(verdictOf('up', 0.04, 1), 'neutral', 'rounds to nothing at the printed grain');
eq(verdictOf('goal', -2, 1, 'fatloss'), 'good', 'weight down on fat loss');
eq(verdictOf('goal', 2, 1, 'fatloss'), 'bad', 'weight up on fat loss');
eq(verdictOf('goal', 2, 1, 'muscle'), 'good', 'weight up on a muscle goal');
eq(verdictOf('goal', 2, 1, null), 'neutral', 'no goal, no verdict on weight');
eq(verdictOf('none', 3, 1), 'neutral', 'none never judged');
eq(verdictOf('down', null, 1), 'neutral', 'no delta');

/* summary vs previous and first, in any input order */
const s1 = scan('2026-06-01', 84, 24, 34, { fatMassKg: 20.2, visceralFat: 9, inbodyScore: 72, bmr: 1690 });
const s2 = scan('2026-08-01', 82, 22, 34.6, { fatMassKg: 18, visceralFat: 8, inbodyScore: 76, bmr: 1712 });
const s3 = scan('2026-10-01', 81.2, 21.1, 35.1, { fatMassKg: 17.1, visceralFat: 8, inbodyScore: 79, bmr: 1725 });
const sum = scanSummary([s3, s1, s2], 'fatloss');
eq(sum.latest?.takenAt, '2026-10-01', 'latest');
eq(sum.previous?.takenAt, '2026-08-01', 'previous');
eq(sum.first?.takenAt, '2026-06-01', 'first');
const row = (k: string) => sum.rows.find((r) => r.def.key === k)!;
eq(row('bodyFatPct').vsPrevious, { value: 22, delta: -0.9, verdict: 'good' }, 'bf vs previous');
eq(row('bodyFatPct').vsFirst.delta, -2.9, 'bf vs first');
eq(row('skeletalMuscleKg').vsFirst.verdict, 'good', 'smm up vs first');
eq(row('visceralFat').vsPrevious.verdict, 'neutral', 'visceral unchanged');
eq(row('weightKg').vsPrevious.verdict, 'good', 'weight down on fat loss');
eq(row('bmr').vsFirst.delta, 35, 'bmr vs first');
eq(scanSummary([s1, s2]).first, null, 'with two scans the first IS the previous: not repeated');
eq(scanSummary([]).rows, [], 'empty');

/* trends skip absence */
const tr = trendSeries([s2, scan('2026-09-01', 81.5, 21.5, 35, {}), s1]);
eq(tr.find((x) => x.def.key === 'weightKg')!.values, [84, 82, 81.5], 'weight trend oldest first');
eq(tr.find((x) => x.def.key === 'bmr')!.dates, ['2026-06-01', '2026-08-01'], 'bmr dates skip the scan without it');

/* segmental */
const seg = segmentalOf([
  scan('2026-08-01', 82, 22, 34.6, { leanArmLKg: 3.4, leanArmRKg: 3.5, leanTrunkKg: 27, leanLegLKg: 9.6, leanLegRKg: 9.7 }),
  scan('2026-10-01', 81, 21, 35, { leanArmLKg: 3.5, leanArmRKg: 3.8, leanTrunkKg: 27.4, leanLegLKg: 9.8, leanLegRKg: 9.8 }),
])!;
eq(seg.at, '2026-10-01', 'segmental newest');
eq(seg.segments.find((s) => s.seg === 'armR')!.delta, 0.3, 'arm delta');
eq(seg.segments.find((s) => s.seg === 'armR')!.verdict, 'good', 'lean up good');
eq(seg.imbalances, [{ pair: 'arms', pct: 7.9, heavier: 'right' }], 'arm imbalance flagged, legs not');
eq(seg.shade.legL, 1, 'heaviest limb full shade');
eq(segmentalOf([s1]), null, 'no segmental');
eq(segmentOfLayer('front_biceps_brachii_L'), 'armL', 'layer arm');
eq(segmentOfLayer('vastus_lateralis_R'), 'legR', 'layer leg');
eq(segmentOfLayer('front_abdominals_L'), 'trunk', 'layer trunk');

/* compare */
const c = compareScans(s3, s1, 'fatloss');
eq(c.a.takenAt, '2026-06-01', 'earlier is a');
const fm = c.rows.find((r) => r.label === 'Fat Mass')!;
eq([fm.delta, fm.verdict], [-3.1, 'good'], 'fat mass compare');
eq(c.rows.filter((r) => r.label === 'Fat Mass').length, 1, 'no duplicate rows');

eq(signed(-0.9, 1), '−0.9', 'minus sign'); eq(signed(1, 0), '+1', 'plus'); eq(signed(0.01, 1), '0', 'zero');

if (errors.length) { console.error(errors.join('\n')); throw new Error(`inbodyProgress: ${errors.length} failed`); }
console.log('inbodyProgress: all passed');
