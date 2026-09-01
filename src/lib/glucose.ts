// Blood glucose, and the arithmetic around it.
//
// Repple does not talk to Dexcom or Abbott. A CGM writes its readings into
// Apple Health (and, on Android, Health Connect); Repple reads them out of
// there. So this file never sees a vendor — it sees samples, and its whole job
// is to turn them into something that can sit honestly next to a food log.
//
// ── TWO RULES THAT ARE NOT STYLE ────────────────────────────────────────────
//
// 1. NOTHING HERE GIVES ADVICE. Not a suggestion, not a "try fewer carbs", not
//    a traffic light that means "you did badly". A person wearing a CGM is
//    usually wearing it because of a diagnosis, and software that turns their
//    readings into dietary instructions is a regulated medical device, not a
//    fitness feature. `band()` below names the common reference range and says
//    so; the coach reads it and the coach decides.
//
// 2. AN ABSENT READING IS NEVER A ZERO. Every function here returns null where
//    it has nothing, and the callers render that as a dash. A glucose chart
//    that draws 0 mmol/L for "the sensor was off" is drawing a value that would
//    mean the person was dead.
//
// Storage is mmol/L, always — see supabase/parts/102-glucose.sql. mg/dL is a
// display unit, converted at the two edges (here, and the input parser).

/** The two units a person may read their sugars in. */
export type GlucoseUnit = 'mmol/L' | 'mg/dL';

/**
 * mg/dL per mmol/L for glucose.
 *
 * It is not a universal constant — it is molar mass over 10, and glucose's
 * molar mass is 180.1559 g/mol. A different analyte has a different factor,
 * which is why this is named for glucose rather than called CONVERSION.
 */
export const MGDL_PER_MMOL = 18.0182;

export function mmolToMgdl(mmol: number): number {
  return mmol * MGDL_PER_MMOL;
}
export function mgdlToMmol(mgdl: number): number {
  return mgdl / MGDL_PER_MMOL;
}

/**
 * The bounds a stored reading must sit inside, matching the CHECK on the
 * column. Anything outside is a broken import rather than a person: a garbage
 * row on a chart of somebody's sugars is worse than a missing one, because it
 * is the missing one they would have questioned.
 */
export const MIN_MMOL = 0.5;
export const MAX_MMOL = 40;

export function plausible(mmol: unknown): mmol is number {
  return typeof mmol === 'number' && Number.isFinite(mmol) && mmol >= MIN_MMOL && mmol <= MAX_MMOL;
}

/** One reading, as the app holds it. */
export interface GlucoseReading {
  /** ISO timestamp the sample was taken. */
  at: string;
  /** Always mmol/L. */
  mmol: number;
  /** HealthKit's sample UUID, or null for one somebody typed in. */
  externalId: string | null;
  /** Who wrote it into Health — 'Dexcom G7', 'Health', an app name. */
  sourceName: string | null;
}

/**
 * Format a stored mmol/L for display in whichever unit the reader uses.
 *
 * mmol/L is conventionally one decimal, mg/dL a whole number, and that is not
 * cosmetic: 5.5 and 99 carry roughly the same precision, so rendering mg/dL to
 * one decimal invents a digit the sensor never measured.
 */
export function formatGlucose(mmol: number | null | undefined, unit: GlucoseUnit): string {
  if (typeof mmol !== 'number' || !Number.isFinite(mmol)) return '—';
  return unit === 'mg/dL' ? String(Math.round(mmolToMgdl(mmol))) : mmol.toFixed(1);
}

/**
 * Where a reading sits against the range most non-diabetic adults are quoted.
 *
 * DESCRIPTIVE ONLY, and the wording downstream must keep saying so. The bounds
 * are the ones in general circulation (roughly 3.9–7.8 mmol/L across a day);
 * an individual's own targets are set with their clinician and are frequently
 * not these. `unknown` exists so a reading this file cannot vouch for does not
 * silently become "in range".
 */
export type GlucoseBand = 'below' | 'typical' | 'above' | 'unknown';

export const TYPICAL_LOW_MMOL = 3.9;
export const TYPICAL_HIGH_MMOL = 7.8;

export function band(mmol: number | null | undefined): GlucoseBand {
  if (typeof mmol !== 'number' || !Number.isFinite(mmol)) return 'unknown';
  if (mmol < TYPICAL_LOW_MMOL) return 'below';
  if (mmol > TYPICAL_HIGH_MMOL) return 'above';
  return 'typical';
}

/**
 * Turn raw `getBloodGlucoseSamples` rows into readings.
 *
 * The native module returns mmol/L by default (RCTAppleHealthKit builds the
 * unit from HKUnitMolarMassBloodGlucose and only overrides it if the caller
 * passes one), so no conversion happens here — and the reader passes no unit,
 * deliberately, so that stays true.
 *
 * Two things this does that a `.map()` would not:
 *
 *   · drops implausible values rather than storing them, and
 *   · collapses duplicate sample ids, because Health is re-read on every open
 *     and a CGM writes a sample every five minutes. Without the collapse a
 *     week of wearing one is 2,000 rows of the same fortnight.
 *
 * Newest first, matching how they are read back out of the table.
 */
export function parseHealthSamples(rows: unknown): GlucoseReading[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: GlucoseReading[] = [];
  for (const r of rows) {
    const row = r as Record<string, unknown>;
    if (!row || typeof row !== 'object') continue;
    const mmol = Number(row.value);
    if (!plausible(mmol)) continue;
    const at = typeof row.startDate === 'string' ? row.startDate : null;
    if (!at || Number.isNaN(Date.parse(at))) continue;
    const id = typeof row.id === 'string' && row.id ? row.id : null;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push({
      at,
      // One decimal, because that is the column's scale. Rounding here rather
      // than letting Postgres do it keeps the value the app charted and the
      // value the row holds the same number.
      mmol: Math.round(mmol * 10) / 10,
      externalId: id,
      sourceName: typeof row.sourceName === 'string' && row.sourceName ? row.sourceName : null,
    });
  }
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out;
}

// ── Health Connect, which is the same job in a different shape ──────────────
//
// Android's store hands back a record rather than a sample: the time is `time`
// rather than `startDate`, the id and the writing app live under `metadata`,
// and the value is an object carrying the reading in BOTH units at once. So
// the whole Android-specific part of the import is the reshaping below, and
// everything that decides what counts as a reading — the plausibility floor,
// the duplicate collapse, the newest-first order — stays in
// `parseHealthSamples`, which is called with the reshaped rows.
//
// Reimplementing that here instead is the obvious shortcut and the expensive
// one: the two platforms would then drift, and the half that drifts is the
// half two testers are actually using.

/**
 * The reading itself, as Health Connect returns it on a READ.
 *
 * Both fields are always written by the native layer (see
 * `ReactBloodGlucoseRecord.bloodGlucoseToJsMap`), which is why this is not a
 * union — but they are optional here because a bridge payload that lost one is
 * a thing that has to be survived rather than assumed away.
 */
export interface HealthConnectLevel {
  inMillimolesPerLiter?: number;
  inMilligramsPerDeciliter?: number;
}

/**
 * One record's level in mmol/L, whichever unit survived the bridge.
 *
 * Health Connect stores glucose in a unit the WRITING app chose, and exposes
 * it converted both ways. mmol/L is preferred because it is what the column
 * holds, so the ordinary path performs no arithmetic at all and cannot be
 * wrong by a factor of eighteen. mg/dL is the fallback, and it goes through
 * `mgdlToMmol` — the same function the typed-input parser uses — rather than
 * through a second constant written out here. There is one conversion factor
 * in this app and this is not the place to add a second.
 *
 * Null rather than 0 for anything unreadable: a level this function cannot
 * interpret must not become a reading of zero, which on a chart of somebody's
 * sugars is a value that would mean they were dead.
 */
export function mmolFromLevel(level: unknown): number | null {
  if (!level || typeof level !== 'object') return null;
  const l = level as Record<string, unknown>;
  const mmol = l.inMillimolesPerLiter;
  if (typeof mmol === 'number' && Number.isFinite(mmol)) return mmol;
  const mgdl = l.inMilligramsPerDeciliter;
  if (typeof mgdl === 'number' && Number.isFinite(mgdl)) return mgdlToMmol(mgdl);
  return null;
}

/**
 * Turn `readRecords('BloodGlucose')` records into readings.
 *
 * A record with no `metadata.id` keeps a null `externalId`, and `unsaved()`
 * then refuses to send it — which is the right outcome rather than a gap. An
 * id is the only thing that stops the same reading landing again on every
 * open, and Health Connect is re-read exactly as often as Apple Health is.
 */
export function parseHealthConnectRecords(records: unknown): GlucoseReading[] {
  if (!Array.isArray(records)) return [];
  return parseHealthSamples(records.map((rec) => {
    const r = (rec ?? {}) as Record<string, unknown>;
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      value: mmolFromLevel(r.level),
      startDate: typeof r.time === 'string' ? r.time : null,
      id: typeof meta.id === 'string' ? meta.id : null,
      // The package name of the app that wrote it — 'com.dexcom.g7' and the
      // like. Not pretty, and not shown: the table stores only that a reading
      // came from the phone's health store, not which app put it there.
      sourceName: typeof meta.dataOrigin === 'string' ? meta.dataOrigin : null,
    };
  }));
}

/**
 * How a glucose read went, whichever store it was read from.
 *
 * Four outcomes, because collapsing any two of them tells somebody wearing a
 * sensor something untrue about their own body:
 *
 *   ready       we asked and got an answer. An empty list here is a real
 *               measurement of absence — the store holds nothing for the
 *               window.
 *   error       we asked and got no answer. An empty list here means NOTHING,
 *               and the screen says so rather than showing a blank record.
 *   denied      the person was asked for access and did not give it. This is
 *               their decision and is not a fault to report as one; the fix
 *               lives in the system's own settings, not in Repple.
 *   unsupported there is nothing here to read from — no HealthKit in this
 *               build, no Health Connect on this phone. A fact about the
 *               device, and the only one of the four that manual entry is the
 *               permanent answer to.
 *
 * iOS can never return 'denied': HealthKit answers a REFUSED read with the
 * same empty array it answers an unrequested one with, so a decline there is
 * indistinguishable from an empty window and must not be claimed. Health
 * Connect does report its granted permissions, so Android can and does.
 */
export type GlucoseReadStatus = 'ready' | 'error' | 'denied' | 'unsupported';

export interface GlucoseRead {
  status: GlucoseReadStatus;
  readings: GlucoseReading[];
  /** Human sentence for everything except 'ready'. Never shown for 'ready'. */
  reason?: string;
}

/** A meal as this module needs it — the food log's own row, narrowed. */
export interface MealRef {
  id: string;
  name: string;
  /** ISO timestamp. */
  loggedAt: string;
  carbs: number | null;
}

/**
 * How long after a meal a reading is still attributed to it.
 *
 * Two hours is the window post-meal readings are conventionally quoted at, and
 * it is also roughly where the next meal starts competing for the credit —
 * which is why `pairMeals` stops at the next meal regardless.
 */
export const POST_MEAL_MINS = 120;

/** What a meal looked like against the sensor. Any part may be unknown. */
export interface MealGlucose {
  meal: MealRef;
  /** The last reading at or before the meal, if there is one within an hour. */
  before: GlucoseReading | null;
  /** The highest reading inside the window, if any. */
  peak: GlucoseReading | null;
  /** peak − before, in mmol/L, or null if either end is missing. */
  rise: number | null;
}

const MIN = 60 * 1000;

/**
 * Line each meal up against the readings around it.
 *
 * The window closes early when the next meal starts, because a reading taken
 * ten minutes after lunch is lunch's, not breakfast's, and attributing it to
 * both is how a chart shows somebody spiking on a meal they ate two hours ago.
 *
 * `rise` is arithmetic, not a verdict. It is null unless BOTH ends are real
 * readings — a peak with no baseline is a number, not a rise, and subtracting
 * from an assumed 5.0 would be inventing the more important half.
 */
export function pairMeals(meals: MealRef[], readings: GlucoseReading[], windowMins = POST_MEAL_MINS): MealGlucose[] {
  const ordered = [...meals]
    .filter((m) => !Number.isNaN(Date.parse(m.loggedAt)))
    .sort((a, b) => Date.parse(a.loggedAt) - Date.parse(b.loggedAt));

  return ordered.map((meal, i) => {
    const t = Date.parse(meal.loggedAt);
    const next = ordered[i + 1] ? Date.parse(ordered[i + 1].loggedAt) : Infinity;
    const closes = Math.min(t + windowMins * MIN, next);

    let before: GlucoseReading | null = null;
    let peak: GlucoseReading | null = null;

    for (const r of readings) {
      const rt = Date.parse(r.at);
      if (Number.isNaN(rt)) continue;
      // A baseline more than an hour stale is not this meal's baseline.
      if (rt <= t && rt >= t - 60 * MIN) {
        if (!before || rt > Date.parse(before.at)) before = r;
      }
      if (rt > t && rt <= closes) {
        if (!peak || r.mmol > peak.mmol) peak = r;
      }
    }

    return {
      meal,
      before,
      peak,
      rise: before && peak ? Math.round((peak.mmol - before.mmol) * 10) / 10 : null,
    };
  });
}

/**
 * The headline figures for a stretch of readings.
 *
 * `inTypicalPct` is a share of the READINGS THAT EXIST, and it is null below a
 * floor rather than computed from three samples: "100% in range" off a single
 * reading is a sentence a person would act on, and it means nothing.
 */
export interface GlucoseSummary {
  count: number;
  latest: GlucoseReading | null;
  averageMmol: number | null;
  lowestMmol: number | null;
  highestMmol: number | null;
  inTypicalPct: number | null;
}

/** Below this many readings, a percentage is noise wearing a number's clothes. */
export const MIN_FOR_PERCENT = 12;

export function summarise(readings: GlucoseReading[]): GlucoseSummary {
  const rs = readings.filter((r) => plausible(r.mmol));
  if (rs.length === 0) {
    return { count: 0, latest: null, averageMmol: null, lowestMmol: null, highestMmol: null, inTypicalPct: null };
  }
  let sum = 0;
  let lo = rs[0].mmol;
  let hi = rs[0].mmol;
  let inRange = 0;
  let latest = rs[0];
  for (const r of rs) {
    sum += r.mmol;
    if (r.mmol < lo) lo = r.mmol;
    if (r.mmol > hi) hi = r.mmol;
    if (band(r.mmol) === 'typical') inRange++;
    if (Date.parse(r.at) > Date.parse(latest.at)) latest = r;
  }
  return {
    count: rs.length,
    latest,
    averageMmol: Math.round((sum / rs.length) * 10) / 10,
    lowestMmol: lo,
    highestMmol: hi,
    inTypicalPct: rs.length >= MIN_FOR_PERCENT ? Math.round((inRange / rs.length) * 100) : null,
  };
}

/**
 * Which of these readings are not already stored.
 *
 * The import is "read everything Health has since date X, keep what is new",
 * so this is the whole of the dedupe on the client side; the partial unique
 * index is the backstop for two devices importing at once.
 */
export function unsaved(readings: GlucoseReading[], storedExternalIds: Iterable<string>): GlucoseReading[] {
  const have = new Set(storedExternalIds);
  return readings.filter((r) => r.externalId !== null && !have.has(r.externalId));
}

/**
 * Read a number a person typed, in whichever unit they read in.
 *
 * Returns null rather than 0 for anything it cannot use, including a value
 * that is plausible in the OTHER unit — 99 typed under mmol/L is a mg/dL
 * reading in the wrong box, and storing it as 99 mmol/L would put a point four
 * times off the top of every chart they ever look at.
 */
export function parseTyped(text: string, unit: GlucoseUnit): number | null {
  const n = Number(String(text).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const mmol = unit === 'mg/dL' ? mgdlToMmol(n) : n;
  if (!plausible(mmol)) return null;
  return Math.round(mmol * 10) / 10;
}
