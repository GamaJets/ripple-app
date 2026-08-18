// Heart-rate zones → color, by % of estimated max HR (220 − age).
// Used for the live workout metrics and any heart icon that reflects effort.
export function maxHr(age?: number | null): number {
  return 220 - (age && age > 0 ? age : 30);
}
export type HrZone = 'rest' | 'warmup' | 'aerobic' | 'threshold' | 'max';
export function hrZone(bpm: number, age?: number | null): HrZone {
  const pct = bpm / maxHr(age);
  if (pct < 0.5) return 'rest';
  if (pct < 0.65) return 'warmup';
  if (pct < 0.8) return 'aerobic';
  if (pct < 0.9) return 'threshold';
  return 'max';
}
export const HR_ZONE_LABEL: Record<HrZone, string> = {
  rest: 'Resting', warmup: 'Warm-up', aerobic: 'Aerobic', threshold: 'Threshold', max: 'Max effort',
};
const ZONE_COLOR: Record<HrZone, string> = {
  rest: '#64748b', warmup: '#60a5fa', aerobic: '#2dd4bf', threshold: '#f59e0b', max: '#ef4444',
};
export function hrColor(bpm: number | null | undefined, age?: number | null): string {
  if (!bpm || bpm <= 0) return '#64748b';
  return ZONE_COLOR[hrZone(bpm, age)];
}
export function hrZoneLabel(bpm: number | null | undefined, age?: number | null): string {
  if (!bpm || bpm <= 0) return '—';
  return HR_ZONE_LABEL[hrZone(bpm, age)];
}


// ── Heart-rate series: stats, zone bands & time-in-zone ──────────────────────
export interface HrSample { t: string; bpm: number }

/** Age from a date-of-birth string (YYYY-MM-DD or ISO). null if unparseable. */
export function ageFromDob(dob?: string | null, nowMs: number = Date.now()): number | null {
  if (!dob) return null;
  const b = Date.parse(dob);
  if (!isFinite(b)) return null;
  const yrs = (nowMs - b) / (365.25 * 24 * 3600 * 1000);
  return yrs > 0 && yrs < 120 ? Math.round(yrs) : null;
}

export const HR_ZONE_ORDER: HrZone[] = ['rest', 'warmup', 'aerobic', 'threshold', 'max'];
// Lower bound of each zone as a fraction of max HR (mirrors hrZone thresholds).
const ZONE_LO: Record<HrZone, number> = { rest: 0, warmup: 0.5, aerobic: 0.65, threshold: 0.8, max: 0.9 };
const ZONE_HI: Record<HrZone, number> = { rest: 0.5, warmup: 0.65, aerobic: 0.8, threshold: 0.9, max: 1.12 };
const ZONE_COLORS: Record<HrZone, string> = {
  rest: '#64748b', warmup: '#60a5fa', aerobic: '#22c55e', threshold: '#f59e0b', max: '#ef4444',
};
export function zoneColor(z: HrZone): string { return ZONE_COLORS[z]; }

export interface ZoneBand { zone: HrZone; label: string; color: string; loBpm: number; hiBpm: number }
/** BPM bounds for each zone given an age (for drawing coloured background bands). */
export function zoneBands(age?: number | null): ZoneBand[] {
  const m = maxHr(age);
  return HR_ZONE_ORDER.map((z) => ({
    zone: z, label: HR_ZONE_LABEL[z], color: ZONE_COLORS[z],
    loBpm: Math.round(ZONE_LO[z] * m), hiBpm: Math.round(ZONE_HI[z] * m),
  }));
}

/** Low / high / average bpm across a sample series (null if empty). */
export function hrStats(samples: HrSample[]): { low: number; high: number; avg: number } | null {
  const v = samples.map((s) => s.bpm).filter((n) => typeof n === 'number' && isFinite(n) && n > 0);
  if (!v.length) return null;
  return { low: Math.min(...v), high: Math.max(...v), avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) };
}

/** Seconds spent in each zone, inferred from the gap between consecutive samples. */
export function timeInZones(samples: HrSample[], age?: number | null): Record<HrZone, number> {
  const out: Record<HrZone, number> = { rest: 0, warmup: 0, aerobic: 0, threshold: 0, max: 0 };
  const pts = samples.filter((s) => isFinite(s.bpm) && s.bpm > 0).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  for (let i = 0; i < pts.length; i++) {
    const next = pts[i + 1];
    let dt = next ? (Date.parse(next.t) - Date.parse(pts[i].t)) / 1000 : 10; // assume 10s for the last
    if (!isFinite(dt) || dt <= 0 || dt > 120) dt = 10; // clamp gaps (paused watch etc.)
    out[hrZone(pts[i].bpm, age)] += dt;
  }
  return out;
}
