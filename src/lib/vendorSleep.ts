// Turning WHOOP, Oura and Fitbit sleep records into readings (TF-01, gap 1).
//
// ── WHERE THESE SHAPES CAME FROM ────────────────────────────────────────────
//
// Every field name in this file was read out of the vendor's own published
// specification on 2026-08-29. NONE of it was observed in a live response.
// Exercising any of these three endpoints needs a real person's OAuth token
// against their real account, and there is no test account for any of them, so
// no response has ever been seen. That sentence is here rather than implied
// because this repository has already paid for the difference once: the WHOOP
// zone mapping in `supabase/functions/wearable-day/index.ts` was written
// against an assumed shape and silently merged two training zones into one, and
// nothing said the shape had been guessed.
//
//   Oura API v2    https://cloud.ouraring.com/v2/docs
//                  spec: https://cloud.ouraring.com/v2/static/json/openapi-1.37.json
//                  GET /v2/usercollection/sleep → PublicModifiedSleepModel[]
//   WHOOP v2       https://developer.whoop.com/api/
//                  spec: https://api.prod.whoop.com/developer/doc/openapi.json
//                  GET /v2/activity/sleep → PaginatedSleepResponse (Sleep[])
//                  WHOOP v1 is retired; v2 is the only current version.
//   Fitbit 1.2     https://dev.fitbit.com/build/reference/web-api/sleep/get-sleep-log-by-date-range/
//                  GET /1.2/user/-/sleep/date/{start}/{end}.json
//
// The practical consequence of never having seen a response is that nothing
// here may assume a field is present, a number, or sane. Every value is
// optional and validated, and a value that does not survive validation
// contributes NOTHING — not a zero. A night whose records all fail validation
// produces no reading at all, which reaches the client as a dash, because "we
// could not make sense of what your ring sent" and "you slept no hours" are not
// the same statement and only one of them is true.
//
// ── WHY THE PARSING IS HERE AND NOT IN THE EDGE FUNCTION ────────────────────
//
// A night belongs to the local calendar day the person woke up on. The edge
// function runs in UTC on a Supabase host and cannot know that day; deriving a
// calendar day away from the reader's clock is the single most repeated bug in
// this codebase (see the header of src/lib/localDate.ts). So the server fetches
// and forwards the vendor's own fields untouched, and every date decision
// happens here, on the device, through `nightKey`.

import { nightKey } from './sleepMerge';
import type { SleepBasis, SleepReading } from './sleepMerge';
import type { ProviderId } from './wearables/types';

/** The three cloud vendors that publish a sleep endpoint Repple can read. */
export type SleepVendor = 'oura' | 'whoop' | 'fitbit';

/** Fallback display names, used when the caller does not pass the registry's. */
const VENDOR_NAME: Record<SleepVendor, string> = { oura: 'Oura Ring', whoop: 'WHOOP', fitbit: 'Fitbit' };

/**
 * The longest a single sleep record is allowed to be, in seconds.
 *
 * A record claiming more than a day of sleep is a malformed row or a unit
 * mistake on our side, not a very long lie-in, and letting one through would
 * put a figure on the Recovery screen that the client can see is impossible —
 * which costs more trust than a missing night does. Refused rather than
 * clamped: clamping would invent the number 24h, which nobody reported.
 */
export const MAX_RECORD_SECONDS = 24 * 3600;

/**
 * A number that can actually stand for a duration.
 *
 * Rejects null, undefined, booleans, empty and blank strings, NaN, Infinity,
 * negatives and zero. Zero is rejected on purpose and is the whole reason this
 * is not `Number(v) || 0`: a vendor sending `total_sleep_duration: 0` has told
 * us it has no figure, and the house rule is that an unsupportable value is a
 * dash. Numeric strings are accepted because all three of these APIs are
 * JSON-over-HTTP and none of them is under our control.
 */
function duration(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** Seconds a record contributes, or null when it is not a usable duration. */
function seconds(v: unknown, perUnit: number): number | null {
  const n = duration(v);
  if (n == null) return null;
  const s = n * perUnit;
  return s > 0 && s <= MAX_RECORD_SECONDS ? s : null;
}

/**
 * One night's running totals, kept as two separate accumulators.
 *
 * Staged sleep and time in bed are answers to different questions in the same
 * units, and adding them would produce a figure that is neither. `sleepMerge`
 * ranks a staged reading above a time-in-bed one and refuses to let one
 * corroborate the other, so it has to keep receiving the truth about which it
 * has been handed.
 */
interface NightTotals { asleepSec: number; inBedSec: number }

function bucket(totals: Map<string, NightTotals>, night: string): NightTotals {
  let t = totals.get(night);
  if (!t) { t = { asleepSec: 0, inBedSec: 0 }; totals.set(night, t); }
  return t;
}

/**
 * Per-night totals turned into readings, staged sleep winning per NIGHT.
 *
 * Per night rather than per device, which is where this differs from the
 * HealthKit reader in `wearables/appleHealth.ts`. A device that stages most
 * nights but has one night it could only record as time in bed should report
 * six staged nights and one in-bed night; deciding once for the whole window
 * would throw the odd one out away and show a dash for a night the ring
 * genuinely recorded.
 */
function toReadings(
  totals: Map<string, NightTotals>,
  provider: ProviderId,
  vendor: SleepVendor,
  sourceName: string,
): SleepReading[] {
  const out: SleepReading[] = [];
  for (const [night, t] of totals) {
    const staged = t.asleepSec > 0;
    const sec = staged ? t.asleepSec : t.inBedSec;
    // Rounded once, at the end, from the summed seconds. Rounding each record
    // to minutes first and then adding them would drift by up to half a minute
    // per nap, which is small and is still a number no device reported.
    const minutesAsleep = Math.round(sec / 60);
    if (minutesAsleep <= 0) continue;
    const basis: SleepBasis = staged ? 'asleep' : 'in-bed';
    out.push({
      provider,
      // One physical recorder per cloud vendor, so the source id is the vendor
      // itself. The family matters more than it looks: the Oura app writes its
      // nights into Apple Health too, so the same night can arrive here from
      // the Oura API and from HealthKit, and tagging both 'oura' is what stops
      // sleepMerge treating one measurement seen twice as two devices agreeing.
      sourceId: vendor,
      sourceName,
      family: vendor,
      basis,
      night,
      minutesAsleep,
    });
  }
  return out.sort((a, b) => (a.night < b.night ? 1 : a.night > b.night ? -1 : 0));
}

const rows = (records: unknown): any[] => (Array.isArray(records) ? records : []);

/**
 * Oura sleep periods.
 *
 * DURATIONS ARE SECONDS. `total_sleep_duration` is the staged figure and is
 * nullable in the spec; `time_in_bed` is required and is the wider one. So a
 * period with a total sleep duration is read as staged sleep, and one without
 * falls back to time in bed and says so — which is the honest answer for a
 * night the ring recorded but could not stage.
 *
 * WHICH NIGHT: `bedtime_end`, the instant the person woke, and NOT the `day`
 * field, even though `day` is a plain calendar date and would be easier. Oura's
 * `day` is its scoring day, and the spec's own description of the `late_nap`
 * type is "ended after sleep day change (6 pm), contributes to next days daily
 * scores" — so a nap that ends at 7pm on Tuesday carries `day: Wednesday`.
 * Filing that under Wednesday would put sleep on the screen for a night that
 * had not happened yet. `day` is kept only as a fallback for a record whose
 * bedtime_end is unreadable.
 *
 * WHICH PERIODS: `deleted` is a period the user deleted, and `rest` is one the
 * spec calls "falsely detected sleep / nap, rejected in confirm prompt by
 * user". Counting either would put back a night the person has explicitly told
 * Oura was not theirs. Everything else counts, including naps, which is the
 * same treatment `nightsFromIntervals` gives an afternoon nap in HealthKit —
 * it was sleep they had.
 */
export function parseOuraSleep(records: unknown, sourceName = VENDOR_NAME.oura): SleepReading[] {
  const totals = new Map<string, NightTotals>();
  for (const r of rows(records)) {
    const type = typeof r?.type === 'string' ? r.type.toLowerCase() : '';
    if (type === 'deleted' || type === 'rest') continue;
    const night = nightKey(r?.bedtime_end) ?? nightKey(r?.day);
    if (!night) continue;
    const asleep = seconds(r?.total_sleep_duration, 1);
    if (asleep != null) { bucket(totals, night).asleepSec += asleep; continue; }
    const inBed = seconds(r?.time_in_bed, 1);
    if (inBed != null) bucket(totals, night).inBedSec += inBed;
  }
  return toReadings(totals, 'oura', 'oura', sourceName);
}

/**
 * WHOOP sleep activities.
 *
 * DURATIONS ARE MILLISECONDS, and WHOOP reports no "total asleep" field at all.
 * `score.stage_summary` gives light, slow-wave and REM separately and asleep is
 * their sum — `total_in_bed_time_milli` is the wider figure that also contains
 * `total_awake_time_milli` and `total_no_data_time_milli`, so presenting it as
 * sleep would inflate every WHOOP night by the time the person lay awake.
 *
 * A partial stage summary still counts. If two of the three stages are readable
 * and the third is not, their sum is time WHOOP says the person was asleep —
 * an understatement, not a fabrication — and the alternative is discarding a
 * night that was measured.
 *
 * AN UNSCORED SLEEP IS REFUSED ENTIRELY. `score` is only present when
 * `score_state` is 'SCORED'; 'PENDING_SCORE' means WHOOP is still working and
 * 'UNSCORABLE' means it never will. Those records still carry `start` and
 * `end`, and it would be easy to subtract one from the other and call it time
 * in bed — but that is a bedtime window being relabelled as a measurement, and
 * WHOOP has explicitly said it has no measurement. It reaches the client as a
 * dash, which is what we actually know.
 *
 * WHICH NIGHT: `end`, the instant the sleep finished. WHOOP gives no calendar
 * day of its own — only instants and a `timezone_offset` — so there is nothing
 * else to use, and `end` is the same "morning you woke up" rule every other
 * reader here follows.
 */
export function parseWhoopSleep(records: unknown, sourceName = VENDOR_NAME.whoop): SleepReading[] {
  const totals = new Map<string, NightTotals>();
  for (const r of rows(records)) {
    const night = nightKey(r?.end);
    if (!night) continue;
    const st = r?.score?.stage_summary;
    if (!st || typeof st !== 'object') continue;
    const light = seconds(st.total_light_sleep_time_milli, 1 / 1000) ?? 0;
    const sws = seconds(st.total_slow_wave_sleep_time_milli, 1 / 1000) ?? 0;
    const rem = seconds(st.total_rem_sleep_time_milli, 1 / 1000) ?? 0;
    const asleep = light + sws + rem;
    if (asleep > 0 && asleep <= MAX_RECORD_SECONDS) { bucket(totals, night).asleepSec += asleep; continue; }
    // No stage survived validation, but WHOOP still scored the session — then
    // time in bed is the only thing it has told us, and it is labelled as such.
    const inBed = seconds(st.total_in_bed_time_milli, 1 / 1000);
    if (inBed != null) bucket(totals, night).inBedSec += inBed;
  }
  return toReadings(totals, 'whoop', 'whoop', sourceName);
}

/**
 * Fitbit sleep logs.
 *
 * DURATIONS ARE MINUTES here, unlike the other two — `minutesAsleep` and
 * `timeInBed`, both already in the units the screen wants. They are still
 * carried through the seconds accumulator so that one rounding rule applies to
 * all three vendors.
 *
 * `type` is 'stages' or 'classic'. Both report time asleep: stages grades sleep
 * as deep/light/rem/wake at 30-second granularity, classic as
 * asleep/restless/awake at 60. Classic is the coarser instrument, but
 * `minutesAsleep` means minutes asleep in both, so both are read as staged
 * sleep. Only a log with no usable `minutesAsleep` falls back to `timeInBed`,
 * and that one is labelled in-bed.
 *
 * WHICH NIGHT: `dateOfSleep`, which Fitbit documents as the date the log ENDED
 * — the morning the person woke. It is a bare `YYYY-MM-DD`, which is precisely
 * the value `localDate.dateParts` exists to read: `new Date('2026-08-01')` is
 * UTC midnight and comes back as July 31st for every client west of Greenwich.
 * `endTime` is the fallback, and note it carries NO timezone offset — Fitbit
 * sends local wall-clock time — so it is only ever read as the day it says.
 */
export function parseFitbitSleep(records: unknown, sourceName = VENDOR_NAME.fitbit): SleepReading[] {
  const totals = new Map<string, NightTotals>();
  for (const r of rows(records)) {
    const night = nightKey(r?.dateOfSleep) ?? nightKey(r?.endTime);
    if (!night) continue;
    const asleep = seconds(r?.minutesAsleep, 60);
    if (asleep != null) { bucket(totals, night).asleepSec += asleep; continue; }
    const inBed = seconds(r?.timeInBed, 60);
    if (inBed != null) bucket(totals, night).inBedSec += inBed;
  }
  return toReadings(totals, 'fitbit', 'fitbit', sourceName);
}

/** The right parser for a vendor. An unknown vendor reads nothing, never zero. */
export function parseVendorSleep(vendor: string, records: unknown, sourceName?: string): SleepReading[] {
  if (vendor === 'oura') return parseOuraSleep(records, sourceName ?? VENDOR_NAME.oura);
  if (vendor === 'whoop') return parseWhoopSleep(records, sourceName ?? VENDOR_NAME.whoop);
  if (vendor === 'fitbit') return parseFitbitSleep(records, sourceName ?? VENDOR_NAME.fitbit);
  return [];
}

/** Whether Repple has a sleep reader for this provider at all. */
export function vendorReadsSleep(id: string): id is SleepVendor {
  return id === 'oura' || id === 'whoop' || id === 'fitbit';
}
