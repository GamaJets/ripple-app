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

// The one answer in this codebase to "how old is this member". See ageFromDob
// below for what happened while there were two.
import { ageFromDob as ageFromDobExact } from './age';

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

/**
 * The age this scale falls back to when the app does not know the member's.
 *
 * It is thirty because that is what this function has always used, and it is
 * named because the number was doing something nobody had said out loud. A max
 * heart rate of 190 puts zone 5 at 175 bpm; a fifty-five-year-old's own scale
 * puts it at 152. So a member the app had no date of birth for was being told
 * to push for a figure 23 bpm above the top of their range — on the one screen
 * in this app that asks somebody to work harder, at the age where that is least
 * safe to be wrong about.
 *
 * The guess is kept rather than the zones withheld, for the reason
 * src/lib/unitPreference.ts sets out at length about units: a member mid-set
 * with a live bpm on screen and no colour on it is a worse product AND a worse
 * prompt to go and fill the field in. What made it a defect was never that
 * thirty is a guess — it was that the guess was indistinguishable from a
 * measurement. `hrScaleNote` is what keeps the two apart, and every screen that
 * prints a zone prints it.
 */
export const ASSUMED_AGE = 30;

/** Whether the zones are drawn against the member's OWN age or against
 *  `ASSUMED_AGE`. Never guessed at by a caller — a screen asking "is this a
 *  real age" and answering it with its own `age > 0` is a second copy of the
 *  rule that can disagree with this one. */
export type HrScaleBasis = 'age' | 'assumed';

export function hrScaleBasis(age?: number | null): HrScaleBasis {
  return typeof age === 'number' && Number.isFinite(age) && age > 0 ? 'age' : 'assumed';
}

/**
 * Estimated maximum heart rate, on the studio's own 220 − age.
 *
 * Deliberately still 220 − age and not Tanaka (208 − 0.7 × age): the five zones
 * at the top of this file are the Orange-Theory scale, the percentages are that
 * scale's, and swapping the formula underneath them would move every band on
 * every member's history by a few bpm to be differently approximate. It is an
 * ESTIMATE either way, which is what `hrScaleNote` says.
 */
export function maxHr(age?: number | null): number {
  return 220 - (hrScaleBasis(age) === 'age' ? (age as number) : ASSUMED_AGE);
}

/**
 * The line a screen shows beside a zone it drew without knowing the age.
 *
 * Null when the age is real, so a screen can render it unconditionally and say
 * nothing to the member it is right for — the same rule `deviceUnitNote` and
 * `localeNote` follow, and for the same reason: a line of apology on every
 * screen is a nag that gets no field filled in.
 *
 * It names the number as well as the fault, because "your zones may be wrong"
 * with nothing to act on is worse than silence. The route is stated in the
 * words of the screen that fixes it.
 */
export function hrScaleNote(age?: number | null): string | null {
  if (hrScaleBasis(age) === 'age') return null;
  return `These zones are worked out from an age of ${ASSUMED_AGE}, because your date of birth is not on your profile — they are a guess, not your scale. Add it in Profile and they redraw around you.`;
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
 * The part of a session that is NOT in the zone breakdown.
 *
 * The elapsed clock is wall time — `Date.now()` minus the start minus anything
 * paused — so it stays true whatever the phone is doing. The zone breakdown is
 * banked a second at a time by a timer, and iOS stops delivering timers to an
 * app that is not on screen. So a 46-minute ride with the phone in a pocket
 * came back as 46:07 on the clock and 12:56 across the five zones, and the
 * screen printed both without a word about why they disagree.
 *
 * The gap is not guessable. While the app was away there were no readings, so
 * there is no zone to credit — and crediting the last one seen would invent the
 * evidence, which is the one thing this figure must not do: splat points are
 * minutes at zone 4 or above, and a fabricated minute is a fabricated splat.
 *
 * So it is reported instead. `zoneSecondsTotal + uncountedSeconds = elapsed`,
 * which is what makes the two numbers on the screen add up to the same session.
 * It also covers the other way to bank nothing — the session on screen with no
 * heart rate arriving at all — because to a reader those are the same fact:
 * this much of it was not measured.
 */
export function uncountedSeconds(z: ZoneSeconds, elapsedSec: number): number {
  if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) return 0;
  return Math.max(0, Math.round(elapsedSec) - zoneSecondsTotal(z));
}

/** Below this the gap is timer jitter rather than a missing stretch of the
 *  session, and saying so would be noise on every ride. */
export const UNCOUNTED_FLOOR_SEC = 5;

/** What the screen says when a real part of the session was never measured. */
export const UNCOUNTED_NOTE =
  'Zones are counted only while this session is on screen and a heart rate is arriving. The rest of the time is not credited to any zone, because nothing was measured to say which one it was.';

/**
 * Splat points — one per whole minute spent at or above zone 4, the same rule a
 * studio uses. Returns 0 rather than a fraction: a partial minute is not a splat.
 */
export function splatPoints(z: ZoneSeconds): number {
  return Math.floor((z.z4 + z.z5) / 60);
}

export interface HrSample { t: string; bpm: number }

/**
 * Age from a date-of-birth string (YYYY-MM-DD or ISO). null if unparseable.
 *
 * ── Why this delegates rather than doing the arithmetic ───────────────────
 *
 * It used to be `Math.round((now − Date.parse(dob)) / 365.25 days)`, and there
 * are two things wrong with that, one of which is not a rounding nicety.
 *
 * `Math.round` rounds to the NEAREST year, so every member more than six
 * months past their last birthday was aged UP by one. Somebody born in
 * January 1990 is 36 in September 2026 and this function said 37. That is not
 * a display problem here: `maxHr` is 220 − age and every zone boundary is a
 * percentage of it, so the whole scale on the Recovery screen and on the
 * session heart-rate sheet sat one beat low.
 *
 * Worse, it disagreed with the app's OTHER answer to the same question.
 * src/lib/age.ts counts whole years and rolls over on the birthday, and
 * app/(client)/workouts.tsx — the live session runner, where a member watches
 * the colour change mid-set — has always used it. So one member had two ages
 * and two zone scales: a reading of 154 bpm was "Zone 3 · Base" inside the
 * session and "Zone 4 · Push" on Recovery a tap later, and the splat points
 * the two screens counted for the same hour did not agree either.
 *
 * `Date.parse` on a bare `YYYY-MM-DD` is also UTC midnight, which is the
 * previous day west of Greenwich — the bug src/lib/localDate.ts exists for,
 * and which `src/lib/age.ts` already reads through `dateParts` to avoid.
 *
 * There is one age in this codebase and it is that one. What stays here is the
 * sanity bound: an unborn or 120-year-old member is a broken row rather than a
 * scale to draw somebody's training zones against, and `null` sends the caller
 * to `ASSUMED_AGE` with `hrScaleNote` saying so.
 */
export function ageFromDob(dob?: string | null, nowMs: number = Date.now()): number | null {
  if (!dob) return null;
  const age = ageFromDobExact(String(dob), new Date(nowMs));
  if (age == null || !Number.isFinite(age)) return null;
  return age > 0 && age < 120 ? age : null;
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
