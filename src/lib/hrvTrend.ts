// A night's heart-rate variability, against the member's own baseline.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// `src/lib/wearables/types.ts` states the rule on the field itself, and it is
// not a preference:
//
//     "It is deliberately NOT comparable between people. HRV is a personal
//      baseline — 40 ms is excellent for one member and a red flag for
//      another — so every screen that prints it prints it as a trend against
//      that member's own history, never against a population norm."
//
// One screen printed it. app/(client)/devices.tsx rendered `62 ms HRV` from
// whatever the last sync happened to return, kept nothing, and compared it to
// nothing. A bare 62 has no meaning at all: the member cannot tell whether it
// is their good night or their worst week, which is the entire content of the
// measurement. And because nothing was stored, the app could not have told
// them even if the screen had asked — the figure lived in React state and was
// gone on the next launch.
//
// Sleep had exactly this problem and it was fixed by keeping the nights:
// `device_sleep_nights` (supabase/parts/154) and src/lib/deviceSleepStore.ts.
// This is the same shape for the same reason, and deliberately so — a second,
// differently-argued way of keeping a nightly device reading is how the two
// come to disagree about what "last night" means.
//
// ── What a baseline may and may not be ────────────────────────────────────
//
//   · It is the member's OWN nights and nothing else. There is no population
//     norm in this app and none may be added.
//   · It is a MEDIAN, not a mean. One night on a plane, one night with a
//     fever, one night the strap came loose — each of those is a reading the
//     mean carries for a month. The median ignores it, which is what a
//     baseline is for.
//   · It refuses to exist until there are enough nights. Seven is the floor:
//     below that the "baseline" is one or two nights wearing the authority of
//     a trend, and a member told they are 15% below a baseline made of three
//     readings has been told something the data cannot support. The screen
//     says how many nights it has instead, which is a fact and is also the
//     thing that makes the member keep wearing the watch.
//   · Today is never in its own baseline. Comparing a night to a set that
//     contains it drags the answer toward zero by construction.
//
// Pure. The reading and writing live in src/ui/deviceHrv.ts, and the SQL is
// supabase/parts/720.
import type { ProviderId } from './wearables/types';

/** One night's HRV, as it is kept: the figure, and who measured it. */
export interface HrvNight {
  night: string;          // YYYY-MM-DD, the local calendar night (sleepMerge.nightKey)
  /** RMSSD in MILLISECONDS. Always. See the note on DailyMetrics.hrv — two
   *  vendors publish this in two units and neither says so in the field name;
   *  the conversion happens in the edge function, and nothing here re-scales. */
  ms: number;
  provider: ProviderId;
  /** What to show the member: "WHOOP", "Ring". A figure whose source has been
   *  dropped cannot be checked by the person it is about. */
  sourceName: string;
}

/** How far back a baseline looks. Thirty nights is what the vendors' own apps
 *  use and it is long enough to survive a bad week without being so long that
 *  a real change in fitness never shows up in it. */
export const BASELINE_NIGHTS = 30;

/** The fewest nights that may be called a baseline. See the header. */
export const BASELINE_MIN = 7;

/**
 * How far from the baseline counts as an ordinary night.
 *
 * Ten per cent, with a floor of three milliseconds. The percentage is because
 * HRV's night-to-night variation scales with the member — someone whose
 * baseline is 120 ms swings by more milliseconds than someone at 30 and is no
 * less steady for it. The floor is because ten per cent of a low baseline is a
 * couple of milliseconds, which is inside what the strap itself can resolve,
 * and a band that narrow would report a different verdict every morning off
 * nothing the member did.
 */
export const TYPICAL_PCT = 0.10;
export const TYPICAL_FLOOR_MS = 3;

export interface HrvBaseline {
  /** The median of the nights below, in ms. */
  ms: number;
  /** How many nights it was taken over. Printed, because a baseline of seven
   *  nights and one of thirty are not the same claim. */
  nights: number;
}

/** Where a night sits against the baseline. 'typical' is not a failure to
 *  detect anything — it is the answer most mornings, and saying it plainly is
 *  what stops the other two being read as noise. */
export type HrvBand = 'above' | 'typical' | 'below';

export interface HrvTrend {
  band: HrvBand;
  /** Tonight minus the baseline, in ms. Signed. */
  deltaMs: number;
  baseline: HrvBaseline;
}

/** The median of a list of numbers. Even-length lists take the mean of the two
 *  middles, which is the ordinary definition and cannot be the wrong one here:
 *  both middles are real readings of the same member. */
function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * The member's baseline from their kept nights, EXCLUDING `tonight`.
 *
 * Null when there are not enough nights, which is a real answer and the one
 * the screen must be able to say. Nights outside the window are ignored rather
 * than being allowed to prop up a count.
 */
export function hrvBaseline(
  nights: readonly HrvNight[],
  tonight: string,
  window: number = BASELINE_NIGHTS,
): HrvBaseline | null {
  const seen = new Set<string>();
  const vals: number[] = [];
  // Newest first, so `window` means the last N nights that exist rather than
  // the last N calendar days — a member who did not wear the strap for a week
  // still has a baseline, made of the nights they did.
  const ordered = [...nights].filter((n) => n && n.night !== tonight && Number.isFinite(n.ms) && n.ms > 0)
    .sort((a, b) => (a.night < b.night ? 1 : a.night > b.night ? -1 : 0));
  for (const n of ordered) {
    if (seen.has(n.night)) continue;   // one answer per night
    seen.add(n.night);
    vals.push(n.ms);
    if (vals.length >= window) break;
  }
  if (vals.length < BASELINE_MIN) return null;
  return { ms: Math.round(median(vals) * 10) / 10, nights: vals.length };
}

/** Where tonight sits. Null when there is nothing to compare against — never a
 *  'typical' standing in for "we do not know". */
export function hrvTrendOf(tonightMs: number | null | undefined, base: HrvBaseline | null): HrvTrend | null {
  if (base == null || tonightMs == null || !Number.isFinite(tonightMs) || tonightMs <= 0) return null;
  const deltaMs = Math.round((tonightMs - base.ms) * 10) / 10;
  const tolerance = Math.max(base.ms * TYPICAL_PCT, TYPICAL_FLOOR_MS);
  const band: HrvBand = deltaMs > tolerance ? 'above' : deltaMs < -tolerance ? 'below' : 'typical';
  return { band, deltaMs, baseline: base };
}

/**
 * The line printed beside the figure.
 *
 * It names the baseline and the number of nights it is made of, because a
 * trend against an unstated baseline is the same unreadable number the bare
 * "62 ms" was. Deliberately says nothing about what the member should DO: this
 * app is not a medical device and a low night is a fact, not an instruction.
 */
export function hrvTrendLine(trend: HrvTrend): string {
  const { band, deltaMs, baseline } = trend;
  const nights = `${baseline.nights} night${baseline.nights === 1 ? '' : 's'}`;
  const size = `${Math.abs(deltaMs)} ms`;
  if (band === 'typical') return `In line with your usual ${baseline.ms} ms, over your last ${nights}.`;
  return band === 'above'
    ? `${size} above your usual ${baseline.ms} ms, over your last ${nights}.`
    : `${size} below your usual ${baseline.ms} ms, over your last ${nights}.`;
}

/**
 * The line printed when there is a reading but no baseline yet.
 *
 * States the count and what it is counting toward. A member who is told "no
 * baseline yet" and nothing else has no reason to believe one is coming.
 */
export function hrvBuildingLine(nightsKept: number): string {
  const n = Math.max(0, nightsKept);
  return n === 0
    ? `Tonight is the first reading kept. HRV only means anything against your own history, so it is shown on its own until there are ${BASELINE_MIN} nights.`
    : `${n} of ${BASELINE_MIN} nights kept. HRV only means anything against your own history, so it is shown on its own until there are ${BASELINE_MIN}.`;
}

/* ── the row, both ways ────────────────────────────────────────────────────
 *
 * Defensive about types for the reason src/lib/deviceSleepStore.ts documents on
 * its own row mapper: `hrv_ms` is numeric in Postgres and supabase-js has handed
 * numerics back as strings on some paths, and a string reaching the arithmetic
 * above produces a NaN baseline rather than an admission that there is none.
 */

export function rowToHrvNight(r: any): HrvNight | null {
  if (!r) return null;
  const night = String(r.night ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  const ms = Number(r.hrv_ms);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const sourceName = String(r.source_name ?? '');
  // Attribution travels with the figure or the figure does not travel.
  if (!sourceName) return null;
  return { night, ms: Math.round(ms * 10) / 10, provider: String(r.provider ?? '') as ProviderId, sourceName };
}

/** A night as the row to upsert. `user_id` is the caller's own id — the only
 *  one the policy in part 720 will accept. */
export function hrvNightToRow(userId: string, n: HrvNight) {
  return { user_id: userId, night: n.night, hrv_ms: n.ms, provider: n.provider, source_name: n.sourceName };
}
