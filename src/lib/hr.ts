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
