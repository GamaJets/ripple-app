// InBody composition metrics — the richer field set we extract from a scan and
// trend over time. Kept backend-agnostic so the vision layer, storage and UI
// all share one definition. Every field is optional (a report may omit some).
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
  { key: 'visceralFat', label: 'Visceral fat', unit: 'lvl', better: 'down', group: 'Health & metabolism' },
  { key: 'inbodyScore', label: 'InBody score', unit: 'pts', better: 'up', group: 'Health & metabolism' },
  { key: 'bmr', label: 'BMR', unit: 'kcal', better: 'up', group: 'Health & metabolism' },
  { key: 'fatMassKg', label: 'Fat mass', unit: 'kg', better: 'down', group: 'Fat vs lean', decimals: 1 },
  { key: 'leanMassKg', label: 'Lean mass', unit: 'kg', better: 'up', group: 'Fat vs lean', decimals: 1 },
  { key: 'leanArmLKg', label: 'Left arm', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
  { key: 'leanArmRKg', label: 'Right arm', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
  { key: 'leanTrunkKg', label: 'Trunk', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 1 },
  { key: 'leanLegLKg', label: 'Left leg', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
  { key: 'leanLegRKg', label: 'Right leg', unit: 'kg', better: 'up', group: 'Segmental lean', decimals: 2 },
  { key: 'bodyWaterL', label: 'Body water', unit: 'L', better: 'up', group: 'Water, protein & minerals', decimals: 1 },
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

export interface CompositionRead { improving: string[]; watch: string[]; balance: string[] }

/** Plain-English "what's improving / what to watch", plus left-right balance flags. */
export function compositionInsights(scans: ScanLike[]): CompositionRead {
  const trends = metricTrends(scans);
  const improving: string[] = [], watch: string[] = [];
  for (const tr of trends) {
    if (tr.good === true) improving.push(`${tr.def.label} ${tr.delta! > 0 ? '+' : ''}${tr.delta}`.trim());
    else if (tr.good === false) watch.push(`${tr.def.label} ${tr.delta! > 0 ? '+' : ''}${tr.delta}`.trim());
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
