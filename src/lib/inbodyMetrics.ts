// InBody composition metrics — the richer field set we extract from a scan and
// trend over time. Kept backend-agnostic so the vision layer, storage and UI
// all share one definition. Every field is optional (a report may omit some).
import { deltaLabel } from './deltaLabel';

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
export interface MetricDef { key: keyof ScanMetrics; label: string; unit: string; better: Dir; group: string; decimals?: number }

// Groups match the four the owner chose to track.
export const METRIC_GROUPS = ['Health & metabolism', 'Fat vs lean', 'Segmental lean', 'Water, protein & minerals'] as const;

export const METRIC_DEFS: MetricDef[] = [
  { key: 'visceralFat', label: 'Visceral Fat', unit: 'lvl', better: 'down', group: 'Health & metabolism' },
  { key: 'inbodyScore', label: 'InBody Score', unit: 'pts', better: 'up', group: 'Health & metabolism' },
  { key: 'bmr', label: 'BMR', unit: 'kcal', better: 'up', group: 'Health & metabolism' },
  { key: 'fatMassKg', label: 'Fat Mass', unit: 'kg', better: 'down', group: 'Fat vs lean', decimals: 1 },
  { key: 'leanMassKg', label: 'Lean Mass', unit: 'kg', better: 'up', group: 'Fat vs lean', decimals: 1 },
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

export interface CompositionRead { improving: string[]; watch: string[]; balance: string[] }

/** Plain-English "what's improving / what to watch", plus left-right balance flags. */
export function compositionInsights(scans: ScanLike[]): CompositionRead {
  const trends = metricTrends(scans);
  const improving: string[] = [], watch: string[] = [];
  // Through deltaLabel rather than interpolating the number. `${tr.delta}` on a
  // negative prints a HYPHEN, and the rest of the app prints U+2212 MINUS, so
  // the same drop read differently depending on which screen showed it — and
  // deltaLabel is also what guarantees a movement of nothing never arrives here
  // wearing a sign. No baseline is named because this line has none of its own:
  // it is a fragment for a summary that dates itself.
  const line = (tr: MetricTrend) =>
    `${tr.def.label} ${deltaLabel(tr.delta, {
      since: null,
      decimals: tr.def.decimals ?? 0,
      noChange: 'unchanged',
      noBaseline: 'no earlier reading',
    })}`.trim();
  for (const tr of trends) {
    if (tr.good === true) improving.push(line(tr));
    else if (tr.good === false) watch.push(line(tr));
  }
  const balance: string[] = [];
  const asc = [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const last = [...asc].reverse().find((s) => s.metrics && (s.metrics.leanArmLKg != null || s.metrics.leanLegLKg != null));
  const m = last?.metrics;
  if (m) {
    const pair = (l?: number, r?: number, name?: string) => {
      if (l == null || r == null || l === 0 || r === 0) return;
      const diff = Math.abs(l - r) / Math.max(l, r);
      if (diff >= 0.1) balance.push(`${name}: ${l < r ? 'left' : 'right'} ${Math.round(diff * 100)}% behind — train the weaker side.`);
    };
    pair(m.leanArmLKg, m.leanArmRKg, 'Arms');
    pair(m.leanLegLKg, m.leanLegRKg, 'Legs');
  }
  return { improving, watch, balance };
}
