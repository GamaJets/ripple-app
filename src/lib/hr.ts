// ── Heart-rate training zones (Orange-Theory model) ──────────────────────────
// Five numbered zones as a percentage of estimated max HR (220 − age), with the
// colour language people already know from a studio wall: grey · blue · green ·
// orange · red. Time in zone 4 or 5 earns splat points, one per minute.
//
//   Zone 1  50–60%   grey    Very light   warming up, barely working
//   Zone 2  61–70%   blue    Light        comfortable, could hold a conversation
//   Zone 3  71–83%   green   Base         steady, sustainable effort
//   Zone 4  84–91%   orange  Push         uncomfortable — this is where splats come from
//   Zone 5  92–100%  red     All out      cannot be held for long
//
// ACCESSIBILITY — why the number is always rendered next to the colour.
// These five hues were run through a colour-vision validator rather than
// eyeballed, and the canonical palette fails twice:
//   · zone 3 green ↔ zone 4 orange — ΔE 6.2 under deuteranopia, i.e. inside the
//     "floor" band that is only legal with a second, non-colour cue. Roughly 8%
//     of men have a red-green deficiency, and Base-vs-Push is the single most
//     important distinction on the scale.
//   · zone 4 orange ↔ zone 5 red — ΔE 14.9 under NORMAL vision. Hard to tell
//     apart for everyone, not just colourblind users.
// Three tuned variants were tested; none fixed both without breaking contrast.
// The palette is close together in perceptual space and cannot be rescued by
// picking better hex codes. So colour is never the only channel here: every
// zone mark carries its NUMBER and its NAME, and colour merely confirms what
// the text already said. Do not render a zone as a bare colour swatch.
export type ZoneNo = 1 | 2 | 3 | 4 | 5;

export interface ZoneDef {
  no: ZoneNo;
  name: string;
  color: string;
  /** Lower bound as a fraction of max HR (inclusive). */
  lo: number;
  /** Upper bound as a fraction of max HR (exclusive, except zone 5). */
  hi: number;
}

export const ZONES: ZoneDef[] = [
  { no: 1, name: 'Very light', color: '#64748B', lo: 0.00, hi: 0.61 },
  { no: 2, name: 'Light',      color: '#3B82F6', lo: 0.61, hi: 0.71 },
  { no: 3, name: 'Base',       color: '#22C55E', lo: 0.71, hi: 0.84 },
  { no: 4, name: 'Push',       color: '#F97316', lo: 0.84, hi: 0.92 },
  { no: 5, name: 'All out',    color: '#DC2626', lo: 0.92, hi: 2.00 },
];

export const ZONE_NOS: ZoneNo[] = [1, 2, 3, 4, 5];
const BY_NO: Record<ZoneNo, ZoneDef> = { 1: ZONES[0], 2: ZONES[1], 3: ZONES[2], 4: ZONES[3], 5: ZONES[4] };

export function zoneDef(no: ZoneNo): ZoneDef { return BY_NO[no]; }
export function zoneColor(no: ZoneNo): string { return BY_NO[no].color; }
export function zoneName(no: ZoneNo): string { return BY_NO[no].name; }

export function maxHr(age?: number | null): number {
  return 220 - (age && age > 0 ? age : 30);
}

/** Which zone a bpm reading falls in. */
export function zoneOf(bpm: number, age?: number | null): ZoneNo {
  const pct = bpm / maxHr(age);
  for (let i = ZONES.length - 1; i >= 0; i--) if (pct >= ZONES[i].lo) return ZONES[i].no;
  return 1;
}

/* ── time in zone ─────────────────────────────────────────────────────────── */

/** Seconds per zone. String keys so it survives a JSON round-trip intact. */
export interface ZoneSeconds { z1: number; z2: number; z3: number; z4: number; z5: number }
export const emptyZoneSeconds = (): ZoneSeconds => ({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
const KEY: Record<ZoneNo, keyof ZoneSeconds> = { 1: 'z1', 2: 'z2', 3: 'z3', 4: 'z4', 5: 'z5' };
export const zoneKey = (no: ZoneNo): keyof ZoneSeconds => KEY[no];
export const zoneSecondsTotal = (z: ZoneSeconds): number => z.z1 + z.z2 + z.z3 + z.z4 + z.z5;

/**
 * Splat points — one per whole minute spent at or above zone 4, the same rule a
 * studio uses. Returns 0 rather than a fraction: a partial minute is not a splat.
 */
export function splatPoints(z: ZoneSeconds): number {
  return Math.floor((z.z4 + z.z5) / 60);
}

export interface HrSample { t: string; bpm: number }

/** Age from a date-of-birth string (YYYY-MM-DD or ISO). null if unparseable. */
export function ageFromDob(dob?: string | null, nowMs: number = Date.now()): number | null {
  if (!dob) return null;
  const b = Date.parse(dob);
  if (!isFinite(b)) return null;
  const yrs = (nowMs - b) / (365.25 * 24 * 3600 * 1000);
  return yrs > 0 && yrs < 120 ? Math.round(yrs) : null;
}

/** Seconds in each zone, inferred from the gap between consecutive samples. */
export function timeInZones(samples: HrSample[], age?: number | null): ZoneSeconds {
  const out = emptyZoneSeconds();
  const pts = samples
    .filter((s) => isFinite(s.bpm) && s.bpm > 0)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  for (let i = 0; i < pts.length; i++) {
    const next = pts[i + 1];
    let dt = next ? (Date.parse(next.t) - Date.parse(pts[i].t)) / 1000 : 10; // assume 10s for the last
    if (!isFinite(dt) || dt <= 0 || dt > 120) dt = 10; // clamp gaps (paused watch etc.)
    out[KEY[zoneOf(pts[i].bpm, age)]] += dt;
  }
  return out;
}

/** Low / high / average bpm across a series (null if empty). */
export function hrStats(samples: HrSample[]): { low: number; high: number; avg: number } | null {
  const v = samples.map((s) => s.bpm).filter((n) => typeof n === 'number' && isFinite(n) && n > 0);
  if (!v.length) return null;
  return { low: Math.min(...v), high: Math.max(...v), avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) };
}

export interface ZoneBand extends ZoneDef { loBpm: number; hiBpm: number }
/** BPM bounds per zone for a given age, for drawing the coloured bands. */
export function zoneBands(age?: number | null): ZoneBand[] {
  const m = maxHr(age);
  return ZONES.map((z) => ({ ...z, loBpm: Math.round(z.lo * m), hiBpm: Math.round(Math.min(z.hi, 1.12) * m) }));
}

/* ── convenience for single readings ──────────────────────────────────────── */

export function hrColor(bpm: number | null | undefined, age?: number | null): string {
  if (!bpm || bpm <= 0) return ZONES[0].color;
  return zoneColor(zoneOf(bpm, age));
}
/** "Zone 4 · Push" — the number leads, because colour alone is not enough. */
export function hrZoneLabel(bpm: number | null | undefined, age?: number | null): string {
  if (!bpm || bpm <= 0) return '—';
  const no = zoneOf(bpm, age);
  return `Zone ${no} · ${zoneName(no)}`;
}
/** Just the numeral, for the large live readout. */
export function hrZoneNo(bpm: number | null | undefined, age?: number | null): ZoneNo | null {
  if (!bpm || bpm <= 0) return null;
  return zoneOf(bpm, age);
}
