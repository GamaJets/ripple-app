// InBody progress as a first-class view: the latest scan against the previous
// and the first, a trend per headline metric, the segmental lean balance, and a
// side-by-side of any two scans. Pure — the member's screen and the coach's
// read the same answers from here (src/ui/InBodyProgress.tsx draws them).
//
// Direction is per metric: fat down is good, muscle up is good, and weight is
// decided by the member's goal (down for fat loss, up for muscle, no verdict
// otherwise), so a client bulking is never shown red for gaining.
import { METRIC_DEFS, type ScanMetrics } from './inbodyMetrics';
import { deltaFigure, deltaMagnitude, deltaSign } from './deltaLabel';
import type { Goal } from './types';

export interface ProgressScan {
  id?: string;
  takenAt: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  skeletalMuscleKg: number | null;
  source?: string | null;
  metrics?: ScanMetrics | null;
}

export type Better = 'up' | 'down' | 'goal' | 'none';
export type ProgressKey = 'weightKg' | 'skeletalMuscleKg' | 'bodyFatPct' | 'fatMassKg' | 'visceralFat' | 'inbodyScore' | 'bmr';

export interface ProgressDef { key: ProgressKey; label: string; unit: string; better: Better; decimals: number; mass: boolean }

/** The seven charted headline metrics, in the order they are drawn. */
export const PROGRESS_DEFS: readonly ProgressDef[] = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', better: 'goal', decimals: 1, mass: true },
  { key: 'skeletalMuscleKg', label: 'Skeletal Muscle', unit: 'kg', better: 'up', decimals: 1, mass: true },
  { key: 'bodyFatPct', label: 'Body Fat', unit: '%', better: 'down', decimals: 1, mass: false },
  { key: 'fatMassKg', label: 'Fat Mass', unit: 'kg', better: 'down', decimals: 1, mass: true },
  { key: 'visceralFat', label: 'Visceral Fat', unit: 'level', better: 'down', decimals: 0, mass: false },
  { key: 'inbodyScore', label: 'InBody Score', unit: 'pts', better: 'up', decimals: 0, mass: false },
  { key: 'bmr', label: 'BMR', unit: 'kcal', better: 'up', decimals: 0, mass: false },
];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One metric off one scan. Top-level figures first, the extracted breakdown second. */
export function valueOf(s: ProgressScan, key: ProgressKey | keyof ScanMetrics): number | null {
  if (key === 'weightKg' || key === 'bodyFatPct' || key === 'skeletalMuscleKg') return num(s[key]);
  return num(s.metrics?.[key as keyof ScanMetrics]);
}

export function oldestFirst<T extends { takenAt: string }>(scans: readonly T[]): T[] {
  return [...scans].sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0));
}

export type Verdict = 'good' | 'bad' | 'neutral';

/** Whether a movement is progress for this metric and goal, at the grain it prints. */
export function verdictOf(better: Better, delta: number | null, decimals: number, goal?: Goal | null): Verdict {
  if (delta == null) return 'neutral';
  const f = +delta.toFixed(decimals);
  if (f === 0) return 'neutral';
  const dir: 'up' | 'down' | 'none' = better === 'goal'
    ? (goal === 'fatloss' || goal === 'tone' ? 'down' : goal === 'muscle' ? 'up' : 'none')
    : better;
  if (dir === 'none') return 'neutral';
  return (dir === 'up') === (f > 0) ? 'good' : 'bad';
}

export interface DeltaCell { value: number | null; delta: number | null; verdict: Verdict }
export interface SummaryRow { def: ProgressDef; latest: number | null; vsPrevious: DeltaCell; vsFirst: DeltaCell }

function cell(def: ProgressDef, latest: number | null, base: number | null, goal?: Goal | null): DeltaCell {
  const delta = latest != null && base != null ? +(latest - base).toFixed(def.decimals) : null;
  return { value: base, delta, verdict: verdictOf(def.better, delta, def.decimals, goal) };
}

/**
 * The latest scan against the one before it and against the first. "Previous"
 * and "first" are scans, not per-metric last readings, so the three columns
 * always describe three named days.
 */
export function scanSummary(scans: readonly ProgressScan[], goal?: Goal | null): {
  latest: ProgressScan | null; previous: ProgressScan | null; first: ProgressScan | null; rows: SummaryRow[];
} {
  const asc = oldestFirst(scans);
  const latest = asc[asc.length - 1] ?? null;
  const previous = asc.length > 1 ? asc[asc.length - 2] : null;
  const first = asc.length > 2 ? asc[0] : null;
  const rows = latest ? PROGRESS_DEFS.map((def) => {
    const v = valueOf(latest, def.key);
    return {
      def, latest: v,
      vsPrevious: cell(def, v, previous ? valueOf(previous, def.key) : null, goal),
      vsFirst: cell(def, v, first ? valueOf(first, def.key) : null, goal),
    };
  }).filter((r) => r.latest != null) : [];
  return { latest, previous, first, rows };
}

export interface TrendSeries { def: ProgressDef; values: number[]; dates: string[] }

/** Every scan that carried the metric, oldest first. Absence is not zero. */
export function trendSeries(scans: readonly ProgressScan[]): TrendSeries[] {
  const asc = oldestFirst(scans);
  return PROGRESS_DEFS.map((def) => {
    const values: number[] = []; const dates: string[] = [];
    for (const s of asc) { const v = valueOf(s, def.key); if (v != null) { values.push(v); dates.push(s.takenAt); } }
    return { def, values, dates };
  }).filter((x) => x.values.length > 0);
}

// ── segmental lean ──────────────────────────────────────────────────────────
export type Segment = 'armL' | 'armR' | 'trunk' | 'legL' | 'legR';
export const SEGMENTS: readonly { seg: Segment; key: keyof ScanMetrics; label: string }[] = [
  { seg: 'armL', key: 'leanArmLKg', label: 'Left Arm' },
  { seg: 'armR', key: 'leanArmRKg', label: 'Right Arm' },
  { seg: 'trunk', key: 'leanTrunkKg', label: 'Trunk' },
  { seg: 'legL', key: 'leanLegLKg', label: 'Left Leg' },
  { seg: 'legR', key: 'leanLegRKg', label: 'Right Leg' },
];
/** Left/right gap above this share of the larger side is worth saying. */
export const IMBALANCE_PCT = 5;

export interface SegmentRead { seg: Segment; label: string; kg: number; delta: number | null; verdict: Verdict }
export interface Segmental {
  at: string; segments: SegmentRead[];
  /** 0..1 per segment, relative to the heaviest LIMB (trunk scaled to itself = 1). */
  shade: Partial<Record<Segment, number>>;
  imbalances: { pair: 'arms' | 'legs'; pct: number; heavier: 'left' | 'right' }[];
}

/** The newest scan that printed segmental lean, compared with the one before that did. */
export function segmentalOf(scans: readonly ProgressScan[]): Segmental | null {
  const withSeg = oldestFirst(scans).filter((s) => SEGMENTS.some((x) => valueOf(s, x.key) != null));
  const now = withSeg[withSeg.length - 1];
  if (!now) return null;
  const was = withSeg.length > 1 ? withSeg[withSeg.length - 2] : null;
  const segments: SegmentRead[] = [];
  for (const x of SEGMENTS) {
    const kg = valueOf(now, x.key);
    if (kg == null) continue;
    const p = was ? valueOf(was, x.key) : null;
    const delta = p != null ? +(kg - p).toFixed(2) : null;
    segments.push({ seg: x.seg, label: x.label, kg, delta, verdict: verdictOf('up', delta, 2) });
  }
  const limbMax = Math.max(0, ...segments.filter((s) => s.seg !== 'trunk').map((s) => s.kg));
  const shade: Partial<Record<Segment, number>> = {};
  for (const s of segments) shade[s.seg] = s.seg === 'trunk' ? 1 : limbMax > 0 ? +(s.kg / limbMax).toFixed(3) : 0;
  const imbalances: Segmental['imbalances'] = [];
  const pair = (l?: SegmentRead, r?: SegmentRead, name?: 'arms' | 'legs') => {
    if (!l || !r || !name) return;
    const big = Math.max(l.kg, r.kg); if (big <= 0) return;
    const pct = +((Math.abs(l.kg - r.kg) / big) * 100).toFixed(1);
    if (pct > IMBALANCE_PCT) imbalances.push({ pair: name, pct, heavier: l.kg > r.kg ? 'left' : 'right' });
  };
  const by = (g: Segment) => segments.find((s) => s.seg === g);
  pair(by('armL'), by('armR'), 'arms'); pair(by('legL'), by('legR'), 'legs');
  return { at: now.takenAt, segments, shade, imbalances };
}

/** Which body-map layer each segment lights. Layer names from assets/muscle-heatmap. */
export function segmentOfLayer(layer: string): Segment | null {
  const side = /_L$/.test(layer) ? 'L' : /_R$/.test(layer) ? 'R' : null;
  const n = layer.replace(/^(front|back)_/, '');
  if (/^(abdominals|obliques|pectoralis|trapezius|latissimus|erector|lower_back|serratus|rhomboid|teres|infraspinatus)/.test(n)) return 'trunk';
  if (!side) return null;
  if (/^(deltoids|biceps_brachii|triceps|brachioradialis|palmaris|anconeus|brachialis|forearm|flexor|extensor)/.test(n)) return side === 'L' ? 'armL' : 'armR';
  if (/^(rectus_femoris|vastus|adductor|gracilis|pectineus|sartorius|tibialis|gastrocnemius|soleus|biceps_femoris|semi|gluteus|peroneus)/.test(n)) return side === 'L' ? 'legL' : 'legR';
  return null;
}

// ── compare two scans ──────────────────────────────────────────────────────
export interface CompareRow { label: string; unit: string; a: number | null; b: number | null; delta: number | null; verdict: Verdict }

/** `a` is the earlier scan whatever order they were picked in. */
export function compareScans(x: ProgressScan, y: ProgressScan, goal?: Goal | null): { a: ProgressScan; b: ProgressScan; rows: CompareRow[] } {
  const [a, b] = x.takenAt <= y.takenAt ? [x, y] : [y, x];
  const rows: CompareRow[] = [];
  const push = (label: string, unit: string, va: number | null, vb: number | null, better: Better, d: number) => {
    if (va == null && vb == null) return;
    const delta = va != null && vb != null ? +(vb - va).toFixed(d) : null;
    rows.push({ label, unit, a: va, b: vb, delta, verdict: verdictOf(better, delta, d, goal) });
  };
  for (const def of PROGRESS_DEFS) push(def.label, def.unit, valueOf(a, def.key), valueOf(b, def.key), def.better, def.decimals);
  const shown = new Set<string>(['fatMassKg', 'visceralFat', 'inbodyScore', 'bmr']);
  for (const m of METRIC_DEFS) {
    if (shown.has(m.key)) continue;
    push(m.label, m.unit, valueOf(a, m.key), valueOf(b, m.key), m.better === 'none' ? 'none' : m.better, m.decimals ?? 1);
  }
  return { a, b, rows };
}

/** "+1.2" / "−0.4" / "0", with a real minus and the reader's own decimal. */
export function signed(delta: number, decimals: number): string {
  // zero-ok: zero after rounding IS "no movement", and the compact cells that
  // use this (vs last / vs first) have no room for the words "No change".
  const f = deltaFigure(delta, decimals);
  if (f == null || f === 0) return '0';
  return deltaSign(f, decimals) + (deltaMagnitude(f, decimals) ?? '0');
}

// ── what the scans add up to ───────────────────────────────────────────────
//
// The one sentence a member actually asks of a run of scans: did I lose fat,
// gain muscle, or both? First scan against latest, fat mass taken from the
// printout when it was read, otherwise weight × body-fat % (both off the same
// scan, never mixed across two). Changes inside the scale's own noise
// (RECOMP_NOISE_KG) are "held", not progress and not loss.
export const RECOMP_NOISE_KG = 0.3;
export type RecompKind = 'recomp' | 'leaner' | 'muscle' | 'held' | 'gained-fat' | 'lost-muscle' | 'mixed';
export interface Recomp {
  kind: RecompKind;
  from: string; to: string;
  fatKg: number | null;      // signed change, kg
  muscleKg: number | null;   // signed change, kg
}

function fatMassOf(s: ProgressScan): number | null {
  const direct = num(s.metrics?.fatMassKg);
  if (direct != null) return direct;
  return s.weightKg != null && s.bodyFatPct != null ? (s.weightKg * s.bodyFatPct) / 100 : null;
}

/** Null below two scans, or when neither fat nor muscle can be compared. */
export function recompOf(scans: readonly ProgressScan[]): Recomp | null {
  const asc = oldestFirst(scans);
  if (asc.length < 2) return null;
  const a = asc[0], b = asc[asc.length - 1];
  const fa = fatMassOf(a), fb = fatMassOf(b);
  const ma = num(a.skeletalMuscleKg), mb = num(b.skeletalMuscleKg);
  const fatKg = fa != null && fb != null ? +(fb - fa).toFixed(1) : null;
  const muscleKg = ma != null && mb != null ? +(mb - ma).toFixed(1) : null;
  if (fatKg == null && muscleKg == null) return null;
  const dir = (v: number | null): -1 | 0 | 1 | null => (v == null ? null : Math.abs(v) < RECOMP_NOISE_KG ? 0 : v > 0 ? 1 : -1);
  const f = dir(fatKg), m = dir(muscleKg);
  const kind: RecompKind =
    f === -1 && m === 1 ? 'recomp'
    : f === -1 && (m === 0 || m == null) ? 'leaner'
    : m === 1 && (f === 0 || f == null) ? 'muscle'
    : f === 1 && m === -1 ? 'mixed'
    : f === 1 ? 'gained-fat'
    : m === -1 ? 'lost-muscle'
    : 'held';
  return { kind, from: a.takenAt, to: b.takenAt, fatKg, muscleKg };
}

export const RECOMP_LINE: Record<RecompKind, string> = {
  recomp: 'Less fat and more muscle: that is body recomposition.',
  leaner: 'Fat is down with muscle held.',
  muscle: 'Muscle is up with fat held.',
  held: 'Fat and muscle are both within a scan’s normal variation.',
  'gained-fat': 'Fat mass is up.',
  'lost-muscle': 'Skeletal muscle is down.',
  mixed: 'Fat is up and muscle is down.',
};
