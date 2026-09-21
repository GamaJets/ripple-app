// InBody composition metrics — the richer field set we extract from a scan and
// trend over time. Kept backend-agnostic so the vision layer, storage and UI
// all share one definition. Every field is optional (a report may omit some).
import { deltaLabel, deltaFigure, movementIsProgress, type BodyMetric } from './deltaLabel';
import type { Goal } from './types';
import type { WeightUnit } from './units';
import {
  isConvertibleMass, compositionUnitOf, compositionDecimals, compositionDeltaIn,
} from './compositionUnit';

export interface ScanMetrics {
  visceralFat?: number;   // level (unitless)
  inbodyScore?: number;   // total points
  bmr?: number;           // basal metabolic rate, kcal
  fatMassKg?: number;     // body fat mass
  leanMassKg?: number;    // lean body mass (fat-free)
  bodyWaterL?: number;    // total body water, L
  proteinKg?: number;
  mineralsKg?: number;
  leanArmLKg?: number; leanArmRKg?: number;   // segmental lean
  leanTrunkKg?: number;
  leanLegLKg?: number; leanLegRKg?: number;
}

export type Dir = 'up' | 'down' | 'none';
export interface MetricDef {
  key: keyof ScanMetrics; label: string; unit: string; better: Dir; group: string; decimals?: number;
  /**
   * The body figure whose direction of travel the MEMBER'S OWN GOAL decides,
   * where this metric is one of those — and absent where it is not.
   *
   * `better` is a property of the metric and is right for most of these: no
   * goal wants less protein, a lower BMR or a higher visceral fat level, and
   * those are health readings rather than physique targets. Fat mass is not
   * like that. `better: 'down'` painted the "moving the right way" mark on a
   * member who had asked the app to help them BUILD, for whom a little fat
   * gained alongside the muscle is the expected cost of the thing they are
   * doing on purpose. That is the exact defect app/(client)/body-trends.tsx
   * was already fixed for on Weight, and it was reintroduced the moment these
   * metrics started being charted beside it.
   *
   * Declared on the metric rather than switched on the key name at the screen,
   * for the reason that file's `MetricDef.from` gives: a metric added later has
   * to say what it is.
   */
  goalMetric?: BodyMetric;
}

// Groups match the four the owner chose to track.
export const METRIC_GROUPS = ['Health & metabolism', 'Fat vs lean', 'Segmental lean', 'Water, protein & minerals'] as const;

export const METRIC_DEFS: MetricDef[] = [
  { key: 'visceralFat', label: 'Visceral Fat', unit: 'lvl', better: 'down', group: 'Health & metabolism' },
  { key: 'inbodyScore', label: 'InBody Score', unit: 'pts', better: 'up', group: 'Health & metabolism' },
  { key: 'bmr', label: 'BMR', unit: 'kcal', better: 'up', group: 'Health & metabolism' },
  { key: 'fatMassKg', label: 'Fat Mass', unit: 'kg', better: 'down', group: 'Fat vs lean', decimals: 1, goalMetric: 'bodyFat' },
  { key: 'leanMassKg', label: 'Lean Mass', unit: 'kg', better: 'up', group: 'Fat vs lean', decimals: 1, goalMetric: 'muscle' },
  { key: 'leanArmLKg', label: 'Left Arm', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
  { key: 'leanArmRKg', label: 'Right Arm', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
  { key: 'leanTrunkKg', label: 'Trunk', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 1 },
  { key: 'leanLegLKg', label: 'Left Leg', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
  { key: 'leanLegRKg', label: 'Right Leg', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
  { key: 'bodyWaterL', label: 'Body Water', unit: 'L', better: 'up', group: 'Water, protein & minerals', decimals: 1 },
  { key: 'proteinKg', label: 'Protein', unit: 'kg', better: 'up', group: 'Water, protein & minerals', decimals: 1 },
  { key: 'mineralsKg', label: 'Minerals', unit: 'kg', better: 'up', group: 'Water, protein & minerals', decimals: 2 },
];

export interface ScanLike { takenAt: string; metrics?: ScanMetrics }
export interface MetricTrend { def: MetricDef; latest: number; prev: number | null; delta: number | null; good: boolean | null; series: number[] }

/** Per-metric latest value, delta vs the previous scan that had it, and the full series. */
export function metricTrends(scans: ScanLike[]): MetricTrend[] {
  const asc = [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const out: MetricTrend[] = [];
  for (const def of METRIC_DEFS) {
    const pts = asc.map((s) => (s.metrics ? s.metrics[def.key] : undefined)).filter((v): v is number => typeof v === 'number');
    if (!pts.length) continue;
    const latest = pts[pts.length - 1];
    const prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const delta = prev != null ? +(latest - prev).toFixed(def.decimals ?? 0) : null;
    let good: boolean | null = null;
    if (delta != null && def.better !== 'none' && delta !== 0) good = def.better === 'up' ? delta > 0 : delta < 0;
    out.push({ def, latest, prev, delta, good, series: pts });
  }
  return out;
}

/** One of the four headings the metric table is laid out under, and the trends
 *  that sit beneath it. A heading with nothing measured under it is dropped
 *  rather than drawn empty. */
export interface MetricGroupTrends { group: string; items: MetricTrend[] }

/**
 * `metricTrends`, arranged into the table both apps draw.
 *
 * The member's own Progress screen and the coach's Body Composition screen show
 * the same thirteen metrics under the same four headings, and the arrangement
 * used to be assembled at each of them — one `METRIC_GROUPS.map` filtering
 * `metricTrends`, written twice. Two copies of a layout is two chances for a
 * heading to be ordered differently, or for an empty group to be drawn on one
 * screen and dropped on the other, and a coach and a client reading the same
 * body down two differently shaped tables is a small, constant, avoidable
 * friction. It is assembled here once instead.
 */
export function trendsByGroup(scans: ScanLike[]): MetricGroupTrends[] {
  const trends = metricTrends(scans);
  return METRIC_GROUPS
    .map((group): MetricGroupTrends => ({ group, items: trends.filter((x) => x.def.group === group) }))
    .filter((g) => g.items.length > 0);
}

/**
 * How many of these scans carried a composition breakdown this build can read.
 *
 * Deliberately not the same number as the scans themselves, and the difference
 * is the whole point of having it. `scans.metrics` is a nullable jsonb column
 * (supabase/parts/03-scan-metrics.sql) written only when a reader actually
 * produced those fields, so a client weighed on a gym scale has scans carrying
 * a weight and a body fat and no breakdown at all. A heading over this table
 * that said "6 scans" would be counting five rows that contribute nothing to
 * it, and a coach would go looking for the trend those five were supposed to
 * make.
 *
 * It matters most at one. A delta needs two readings: a client with a single
 * breakdown has thirteen figures and no change, and neither a dash nor the word
 * "unchanged" says that — both read as "nothing moved" when what is true is
 * that nothing has been measured twice yet.
 */
export function scansWithMetrics(scans: ScanLike[]): number {
  let n = 0;
  for (const s of scans) {
    const m = s.metrics;
    if (!m) continue;
    if (METRIC_DEFS.some((d) => typeof m[d.key] === 'number')) n++;
  }
  return n;
}

/** One dated reading of one metric, in the unit the record stores it in. */
export interface MetricReading { value: number; at: string }

/**
 * Every reading of ONE metric, oldest first, with the day each was taken.
 *
 * `metricTrends` above hands back a bare `series` of numbers, which is enough
 * for a sparkline drawn without an axis and not enough for anything that has to
 * say WHEN. app/(client)/body-trends.tsx charts these nine beside weight, body
 * fat and skeletal muscle, and every figure on that screen carries the date it
 * was measured on — a rule the whole file exists to enforce, after two screens
 * showed different numbers under the same word because one of them had dropped
 * the dates.
 *
 * Scans with no reading for this metric contribute NOTHING rather than a zero.
 * A charted zero is not a low protein figure, it is a cliff that flattens every
 * real reading beside it, and a gym scale writes a weight and a body fat and no
 * breakdown at all — so the gap is the common case, not the edge one.
 *
 * Sorted by comparing the bare `YYYY-MM-DD` as a STRING. `scans.taken_at` is a
 * postgres DATE, and `Date.parse` on one of those reads it as UTC midnight —
 * which is the previous day for every member west of Greenwich, and is how this
 * screen's axis labels came to be a day out.
 */
export function metricReadings(scans: ScanLike[], key: keyof ScanMetrics): MetricReading[] {
  const out: MetricReading[] = [];
  for (const s of scans) {
    const v = s.metrics ? s.metrics[key] : undefined;
    if (typeof v === 'number' && Number.isFinite(v)) out.push({ value: v, at: s.takenAt });
  }
  return out.sort((a, b) => (String(a.at).slice(0, 10) < String(b.at).slice(0, 10) ? -1 : String(a.at).slice(0, 10) > String(b.at).slice(0, 10) ? 1 : 0));
}

/**
 * Whether a movement in this metric is progress FOR THIS MEMBER — or undefined
 * where nothing here can honestly say.
 *
 * Three different answers, in order:
 *
 *   · the member's own goal, where `goalMetric` says their goal has an opinion
 *     (fat mass, lean mass). `movementIsProgress` returns undefined under a
 *     goal that does not settle it, which is the honest answer during a
 *     deliberate bulk and is NOT the same as "this is bad";
 *   · the metric's own `better`, for the health readings no goal disputes;
 *   · undefined for a movement that rounds to nothing at the grain the member
 *     will actually see it printed at. `decimals` is that grain, in the
 *     reader's own unit, so a 0.2 kg change that prints as "no change" in
 *     pounds cannot arrive here wearing a verdict the figure beside it does
 *     not support.
 */
export function metricIsProgress(
  def: MetricDef,
  delta: number | null | undefined,
  goal: Goal | null | undefined,
  decimals: number,
): boolean | undefined {
  if (def.goalMetric) return movementIsProgress(delta, goal, def.goalMetric, decimals);
  return betterSays(def, delta, decimals);
}

/**
 * What the metric's OWN `better` says about a movement the reader can see —
 * with no goal in it.
 *
 * Split out because the two callers differ in one thing only: whether there is
 * a member's goal to consult. `compositionInsights` below is handed scans and
 * nothing else — it is called by the report builder and by the coach's screen
 * as well as by the member's own — so it has no goal to read, and reaching for
 * one it has not got would mean every fat-mass line vanishing from the summary
 * rather than reading as it always has.
 */
function betterSays(def: MetricDef, delta: number | null | undefined, decimals: number): boolean | undefined {
  const f = deltaFigure(delta, decimals);
  if (f == null || f === 0 || def.better === 'none') return undefined;
  return def.better === 'up' ? f > 0 : f < 0;
}

export interface CompositionRead { improving: string[]; watch: string[]; balance: string[] }

/**
 * Plain-English "what's improving / what to watch", plus left-right balance
 * flags — in the member's own weight unit.
 *
 * unit-ok: 'kg' here is not a guess at a reader's preference — it is the unit
 * the VALUES ARE IN. `scans.metrics` stores every mass in kilograms (the field
 * names say so: fatMassKg, leanArmLKg), so an absent `unit` means "nobody is
 * reading this in a chosen unit, leave the figures alone" and the conversion
 * below is skipped entirely. It is a no-op, not a fallback. A caller who knows
 * the member's unit passes it, and only then is anything converted.
 *
 * `unit` defaults to 'kg', which is the unit the record is stored in, so a
 * caller that has not got a reader in front of it (the report builder, the
 * coach's screen) gets exactly what this function always returned, plus the
 * unit each figure is in. That last part is not a nicety: these lines read
 * "Fat Mass −1.2" and a fragment with no unit on it is a number the reader has
 * to guess at — which is the same defect as the wrong unit, one step quieter.
 */
export function compositionInsights(scans: ScanLike[], unit: WeightUnit = 'kg'): CompositionRead {
  const trends = metricTrends(scans);
  const improving: string[] = [], watch: string[] = [];
  // A mass is read out in the member's unit; a level, a score, a kcal and a
  // litre are not masses and keep their own. See src/lib/compositionUnit.ts for
  // the grain each is printed at and for why a litre of body water is not
  // turned into pounds.
  const grain = (def: MetricDef) => {
    const kgDp = def.decimals ?? 0;
    return isConvertibleMass(def.unit) ? compositionDecimals(kgDp, unit) : kgDp;
  };
  // The SPAN converted once, never the two ends converted and subtracted.
  const moved = (tr: MetricTrend) =>
    (isConvertibleMass(tr.def.unit) ? compositionDeltaIn(tr.delta, unit, tr.def.decimals ?? 0) : tr.delta);
  // Through deltaLabel rather than interpolating the number. `${tr.delta}` on a
  // negative prints a HYPHEN, and the rest of the app prints U+2212 MINUS, so
  // the same drop read differently depending on which screen showed it — and
  // deltaLabel is also what guarantees a movement of nothing never arrives here
  // wearing a sign. No baseline is named because this line has none of its own:
  // it is a fragment for a summary that dates itself.
  const line = (tr: MetricTrend) =>
    `${tr.def.label} ${deltaLabel(moved(tr), {
      since: null,
      decimals: grain(tr.def),
      unit: compositionUnitOf(tr.def.unit, unit),
      noChange: 'unchanged',
      noBaseline: 'no earlier reading',
    })}`.trim();
  for (const tr of trends) {
    // Judged on the movement the member will actually READ, not on the stored
    // kilogram one. `tr.good` is computed against the record, and a 0.2 kg drop
    // in fat mass is not a pound: filing that line under "Improving" while the
    // line itself says "Fat Mass unchanged" is the app disagreeing with its own
    // sentence in the space of four words.
    const good = betterSays(tr.def, moved(tr), grain(tr.def));
    if (good === true) improving.push(line(tr));
    else if (good === false) watch.push(line(tr));
  }
  const balance: string[] = [];
  const asc = [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const last = [...asc].reverse().find((s) => s.metrics && (s.metrics.leanArmLKg != null || s.metrics.leanLegLKg != null));
  const m = last?.metrics;
  if (m) {
    const pair = (l?: number, r?: number, name?: string) => {
      if (l == null || r == null || l === 0 || r === 0) return;
      const diff = Math.abs(l - r) / Math.max(l, r);
      if (diff >= 0.1) balance.push(`${name}: ${l < r ? 'left' : 'right'} ${Math.round(diff * 100)}% behind. Train the weaker side.`);
    };
    pair(m.leanArmLKg, m.leanArmRKg, 'Arms');
    pair(m.leanLegLKg, m.leanLegRKg, 'Legs');
  }
  return { improving, watch, balance };
}
