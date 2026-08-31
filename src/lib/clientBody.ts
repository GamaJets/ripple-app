// Somebody else's body composition over time, read off the wire.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// `scans` has carried `scans_trainer_read` — a SELECT for the linked coach —
// since the first schema file, and the coach app read it in exactly one place:
// app/(trainer)/client-goals.tsx, to work out how far along a goal is. That
// read produces a start value, a current value and a percentage. It produces no
// history, no body-fat or muscle series, and no sense of when anything was
// measured. So a client could stand on an InBody every month for a year and
// their coach could see a single percentage off it.
//
// This module is the step before the screen that fixes that: `scans` rows into
// the few things that can honestly be said about them, here, once, in a file
// that compiles and runs under plain node — the same shape and the same reasons
// as clientGoals.ts and clientMeasurements.ts.
//
// ── A missing muscle figure is not a zero ──────────────────────────────────
//
// `scans.skeletal_muscle_kg` is the one nullable column of the three, because a
// bathroom scale reports weight and body fat and no muscle figure at all. It
// was read as `?? 0` for a long time, and the comment on `Scan` in ./types.ts
// records what that cost: nobody has 0 kg of skeletal muscle, so the zero was a
// reading nobody took, charted as a real point and differenced against the scan
// before it — a whole body's worth of muscle lost overnight, on a dashboard.
//
// So a scan that did not measure muscle contributes NO POINT to the muscle
// series. It still contributes to weight and body fat, which it did measure.
//
// ── Which means the three series have three different dates ────────────────
//
// That is not a detail. If the newest scan skipped muscle, the newest muscle
// reading is older than the newest weight reading, and a single screen-level
// "last scanned" date would report a four-month-old muscle figure as three days
// old. This is precisely the trap clientMeasurements.ts hit with tape sites,
// and it is answered the same way: every series carries its own latest date,
// its own age, and its own sentence about how old that is.
//
// ── One reading is a reading. Two are a trend ──────────────────────────────
//
// A coach does not act on "16.2% body fat". They act on "16.2%, down 1.4 since
// the start of the block". A metric measured once has no change to report, and
// `readingLine` says so in words rather than printing a 0 — "0.0%" and "we have
// nothing to compare this to" look identical on a screen and start opposite
// conversations. `movementOf` returns null rather than a zero for that case.
//
// ── Units ──────────────────────────────────────────────────────────────────
//
// Storage is kilograms (TF-37) and the reader converts at the edge, in whatever
// unit the person LOOKING has set — here that is the coach, not the client. A
// CHANGE is converted as a span through `weightDeltaIn`, never as the difference
// of two converted ends: 0.4 kg is 0.88 lb, so two scans a genuine 0.4 kg apart
// that straddle a pound boundary would report "1 lb" one month and "0 lb" the
// next off the back of nothing the client did. The three wrappers at the bottom
// of clientGoals.ts already do exactly this arithmetic for the same three
// metrics, so they are reused rather than written an eighth time.
//
// Body fat is a proportion of the body and is the same number on any scale. It
// never converts, and which metric is which is declared on the metric rather
// than guessed from its name.
import { GOAL_METRIC, type MeasuredKind } from './goalTargets';
import { goalUnit, goalValue, goalDelta, type ScanRow } from './clientGoals';
import { plain, type WeightUnit } from './units';
import { dateParts } from './localDate';
import { dayHeading, whenLabel, daysBetweenIso } from './coachWeek';

/** The three things an InBody sheet gives a coach a series of. They are the
 *  same three kinds a measured goal is held against — `MeasuredKind` — because
 *  they come off the same three columns, and reusing the type is what lets the
 *  unit conversions in clientGoals.ts be reused with them. */
export type BodyMetricKey = MeasuredKind;

/**
 * The metrics in the order the client's own trends screen lists them.
 *
 * The labels are the client's words from app/(client)/body-trends.tsx rather
 * than `GOAL_METRIC`'s, which are goal-flavoured ("Target weight") and would
 * read as a target on a screen that is showing measurements. A coach and a
 * client reading the same body down two differently ordered, differently worded
 * lists is a small, constant, avoidable friction.
 */
export const BODY_METRICS: readonly { key: BodyMetricKey; label: string }[] = [
  { key: 'weight', label: 'Weight' },
  { key: 'bodyfat', label: 'Body Fat' },
  { key: 'muscle', label: 'Skeletal Muscle' },
];

/**
 * A numeric column as a number, or null.
 *
 * The same guard as `num` in clientGoals.ts and clientMeasurements.ts, and it
 * is here for the third time for the same reason: Postgres `numeric` reaches
 * supabase-js as a number or a string depending on the driver path, and
 * `Number(null)` is 0 — which on this table is a client who weighs nothing.
 */
const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A calendar day as one comparable integer, built from the parts rather than
 *  from `Date.parse`. `scans.taken_at` is a DATE, and ordering it through the
 *  local timezone shifts it by a day west of Greenwich — see src/lib/localDate.ts
 *  for what that bug looks like once it reaches a screen. */
function dayKey(iso: string): number | null {
  const p = dateParts(iso);
  return p ? p[0] * 10000 + p[1] * 100 + p[2] : null;
}

/** One measurement: what it said, the day it was taken, and how it got onto the
 *  record. `source` is `scans.source` — 'InBody (OCR)' or 'InBody (manual)' —
 *  a free-text column, so it is carried as whatever it holds and null when it
 *  holds nothing rather than being asserted to be one of two strings. */
export interface Reading {
  atISO: string;
  /** As stored: kilograms for weight and muscle, a percentage for body fat.
   *  Converted only where it is printed. */
  v: number;
  source: string | null;
}

/** One metric's readings, oldest first. Empty is a real answer — it means no
 *  scan that came back reported this metric — and is never padded with a zero. */
export interface MetricSeries {
  key: BodyMetricKey;
  label: string;
  readings: Reading[];
}

/** What a client's scans amount to. */
export interface BodyHistory {
  /** Readable scan rows behind all of this. Not the number of readings in any
   *  one series: a scan with no muscle figure counts here and not there. */
  scans: number;
  /** Rows this build could not use at all. Returned rather than swallowed, for
   *  the reason `readGoals` returns its own — a row quietly dropped is a client
   *  who looks like they have been scanned less than they have. */
  skipped: number;
  weight: MetricSeries;
  bodyfat: MetricSeries;
  muscle: MetricSeries;
  /** The day of the newest readable scan, whatever it measured. The header's
   *  date; never a series' date, because a series has its own. */
  latestScanISO: string | null;
}

/**
 * A `scans` row as this screen asks for it: the four columns clientGoals.ts
 * already names, plus `source`.
 *
 * `source` is optional rather than required so that the row type stays
 * assignable from the one clientGoals.ts reads — the two screens ask the same
 * table for overlapping column lists, and a shared row shape that only one of
 * them can satisfy would push both back to `any` at the call site.
 */
export interface BodyScanRow extends ScanRow {
  source?: string | null;
}

const emptySeries = (key: BodyMetricKey): MetricSeries => ({
  key,
  label: BODY_METRICS.find((m) => m.key === key)!.label,
  readings: [],
});

/**
 * Scan rows as three series.
 *
 * Sorted here rather than trusted from the query. The screen reads newest-first
 * so that a truncated read loses the OLDEST scans rather than the newest, and a
 * pure function that only works when its caller remembered a particular
 * `.order()` is a function that will eventually be called wrong.
 *
 * A non-positive figure is dropped rather than drawn. `weight_kg`,
 * `body_fat_pct` and `skeletal_muscle_kg` carry no check constraints, and a
 * 0 kg body is not a light client — it is a bad row, and one that would also
 * report the scan before it as an eighty-kilogram loss.
 */
export function readBodyHistory(rows: readonly BodyScanRow[]): BodyHistory {
  const weight: Reading[] = [];
  const bodyfat: Reading[] = [];
  const muscle: Reading[] = [];
  let scans = 0;
  let skipped = 0;
  let latest: { iso: string; day: number } | null = null;

  const ordered = [...rows]
    .map((r) => ({ r, day: dayKey(r.taken_at) }))
    .filter((x): x is { r: BodyScanRow; day: number } => x.day != null)
    .sort((a, b) => a.day - b.day);

  for (const { r, day } of ordered) {
    const w = num(r.weight_kg);
    const f = num(r.body_fat_pct);
    // The whole reason this module exists. A null here is a scan that did not
    // measure muscle, not a client who has none, and it contributes nothing to
    // the muscle series while still contributing to the other two.
    const m = num(r.skeletal_muscle_kg);
    const src = (r.source ?? '').trim() || null;
    if ((w == null || w <= 0) && (f == null || f <= 0) && (m == null || m <= 0)) {
      // A row that measured nothing this build can use is not a scan on the
      // record as far as this screen is concerned, and saying so is better than
      // counting it and then having every series be shorter than the count.
      skipped++;
      continue;
    }
    scans++;
    if (w != null && w > 0) weight.push({ atISO: r.taken_at, v: w, source: src });
    if (f != null && f > 0) bodyfat.push({ atISO: r.taken_at, v: f, source: src });
    if (m != null && m > 0) muscle.push({ atISO: r.taken_at, v: m, source: src });
    if (!latest || day >= latest.day) latest = { iso: r.taken_at, day };
  }

  // Rows whose date would not parse were filtered out above and are counted
  // here: a reading with no date is not a point on a trend, and it is worth
  // saying that it existed rather than letting the list be quietly short.
  skipped += rows.length - ordered.length;

  return {
    scans,
    skipped,
    weight: { ...emptySeries('weight'), readings: weight },
    bodyfat: { ...emptySeries('bodyfat'), readings: bodyfat },
    muscle: { ...emptySeries('muscle'), readings: muscle },
    latestScanISO: latest ? latest.iso : null,
  };
}

/** The series for one metric. */
export function seriesOf(h: BodyHistory, key: BodyMetricKey): MetricSeries {
  return key === 'weight' ? h.weight : key === 'bodyfat' ? h.bodyfat : h.muscle;
}

/**
 * What there is to say about one client's scans.
 *
 * The three states clientGoals.ts named, said again in this table's terms, so
 * that a refused read cannot be rendered by the same branch as a client who has
 * never stood on an InBody. `history: null` is the caller's way of saying the
 * read did not come back — it is the only thing that may produce 'unreadable',
 * and 'unreadable' is the only thing that may print as "could not be read".
 */
export type BodyBoard =
  | { state: 'unreadable' }
  | { state: 'none' }
  | { state: 'scanned'; history: BodyHistory };

export function bodyBoard(h: BodyHistory | null): BodyBoard {
  if (h == null) return { state: 'unreadable' };
  if (h.scans === 0) return { state: 'none' };
  return { state: 'scanned', history: h };
}

/** How one metric has moved between the oldest and newest readings that came
 *  back. Null when there are fewer than two of them — a single reading is not a
 *  trend, and it is emphatically not a change of zero. */
export interface Movement {
  first: Reading;
  last: Reading;
  /** As stored, so the caller can convert the whole span at once. */
  deltaStored: number;
  /** Days between the two readings, or null when either date will not parse. */
  days: number | null;
}

export function movementOf(s: MetricSeries): Movement | null {
  if (s.readings.length < 2) return null;
  const first = s.readings[0];
  const last = s.readings[s.readings.length - 1];
  return {
    first,
    last,
    deltaStored: last.v - first.v,
    days: daysBetweenIso(first.atISO, last.atISO),
  };
}

// ── reading a metric out in the COACH's unit ───────────────────────────────
//
// Three thin wrappers over clientGoals.ts, which already holds this arithmetic
// for these exact three kinds. They exist so this module's callers never have
// to know that a body metric and a goal kind are the same type, and so nobody
// is tempted to write the kilogram-to-pound line locally for the eighth time.

/** The unit one metric reads in: the coach's own for the two masses, and a
 *  percentage for body fat whatever anybody has set. */
export const metricUnit = (key: BodyMetricKey, wu: WeightUnit): string => goalUnit(key, wu);

/** A stored reading in the coach's unit. */
export const metricValue = (v: number, key: BodyMetricKey, wu: WeightUnit): number =>
  goalValue(v, key, wu);

/** A stored CHANGE in the coach's unit, converted as a span. */
export const metricDelta = (v: number, key: BodyMetricKey, wu: WeightUnit): number =>
  goalDelta(v, key, wu);

/**
 * The sentence for how one metric has moved, addressed to the coach.
 *
 * Signed, dated, and nothing more. Whether down is progress depends on the
 * metric and on what the client is working toward — a waist and an arm moving
 * the same way mean opposite things, and so do weight and muscle — so nothing
 * here returns a judgement, a tone or a valence.
 *
 * The change is stated "since ⟨date⟩" rather than "since their first scan",
 * deliberately. Under a truncated read the oldest scans are the ones that did
 * not arrive, so the earliest reading on screen is not necessarily their first,
 * and a date is true either way where "their first scan" would be a claim the
 * read cannot support.
 */
export function readingLine(s: MetricSeries, wu: WeightUnit): string {
  const n = s.readings.length;
  if (n === 0) {
    return s.key === 'muscle'
      ? 'No scan on record reported a skeletal-muscle figure. A scan that did not measure it contributes nothing here rather than a zero, so this is silence in the record and not a reading of none.'
      : 'Nothing on record for this metric, so there is nothing to trend.';
  }
  if (n === 1) {
    return 'One reading only, so there is nothing yet to compare it to — not a change of zero.';
  }
  const mv = movementOf(s)!;
  const unit = metricUnit(s.key, wu);
  const d = metricDelta(mv.deltaStored, s.key, wu);
  const since = dayHeading(mv.first.atISO);
  // Through deltaLabel, which is where "nothing moved gets a word, not a sign"
  // is decided once for the whole app. A change smaller than the grain the
  // display can carry — whole pounds, or a tenth of a kilogram; see the table
  // in units.ts — arrives here already rounded to nothing, and "unchanged" is
  // what the reading supports. Printing a finer digit would claim a precision
  // the scan behind it does not have, and signing it would claim a direction.
  return `${n} readings · ${deltaLabel(d, { since, unit, noChange: 'unchanged' })}.`;
}

/**
 * How old a reading is allowed to get before the wording changes.
 *
 * Six weeks, matching `STALE_DAYS` in clientMeasurements.ts on purpose: a coach
 * reading a tape age on one screen and a scan age on another should not have to
 * hold two different meanings of "old". A scan describes the body that trained
 * that week, and a client will have worked through a whole block in six weeks —
 * the figure is still a true record of the day it was taken and is no longer an
 * answer to "where are they now".
 *
 * Not a cliff: the age is printed at every distance, so the threshold changes
 * only the wording and never whether the coach is told.
 */
export const SCAN_STALE_DAYS = 42;

/** How many days ago this metric was last measured, or null with no readings. */
export function seriesAgeDays(s: MetricSeries, todayISO: string): number | null {
  const last = s.readings[s.readings.length - 1];
  return last ? daysBetweenIso(last.atISO, todayISO) : null;
}

export function isSeriesStale(s: MetricSeries, todayISO: string): boolean {
  const d = seriesAgeDays(s, todayISO);
  return d != null && d >= SCAN_STALE_DAYS;
}

/**
 * When this metric was last measured, and how far past useful that is.
 *
 * Per metric rather than per client, because the newest scan need not have
 * measured every metric — see the header. A coach looking at "16.2% body fat"
 * has to know whether that was last week or in February, and the answer can be
 * different for the muscle figure sitting directly underneath it.
 */
export function seriesAgeLine(s: MetricSeries, todayISO: string): string {
  const last = s.readings[s.readings.length - 1];
  if (!last) return 'Never measured.';
  const on = dayHeading(last.atISO);
  const when = whenLabel(last.atISO, todayISO);
  return isSeriesStale(s, todayISO)
    ? `Measured ${on} · ${when} — a training block ago, so it is not where they are now.`
    : `Measured ${on} · ${when}`;
}

/**
 * The one caveat that keeps the signed figures above honest, said once at the
 * section rather than repeated on every row — a warning attached to every line
 * stops being read, and this is a fact about the whole table rather than about
 * any one metric.
 */
export const DIRECTION_CAVEAT =
  'Each change is shown with its sign and nothing else. Whether a figure moving ' +
  'down is progress depends on the metric and on what this client is working ' +
  'toward — weight and skeletal muscle falling together mean something very ' +
  'different from weight falling alone — and the scan does not record which, so ' +
  'this screen does not colour it in.';

// ── what the client typed, which is not what a machine measured ────────────
//
// `clients.manual_weight_kg`, `manual_body_fat_pct` and `manual_at` exist for
// people without an InBody: the client types a weight and a body fat, and their
// own app reads those in preference to the newest scan while `manual_at` is the
// more recent of the two (the `manualIsCurrent` line in src/ui/clientData.tsx).
//
// A coach has to see them, because they are what the client is looking at on
// their own screen — a coach quoting the scan at somebody whose app says
// something else is a coach who looks like they are not paying attention. But
// they are a typed figure and not a machine reading, and the two must not sit
// under one heading unlabelled: bathroom scales and an InBody disagree by more
// than most of the changes anybody is training for, so a delta taken across the
// two would be reporting the equipment rather than the body.
//
// So they are read, labelled, dated, and deliberately kept OUT of the series
// above. There is no manual skeletal-muscle column; nothing here invents one.

/** The three columns on `clients` as PostgREST hands them over. */
export interface ManualRow {
  manual_weight_kg: number | string | null;
  manual_body_fat_pct: number | string | null;
  manual_at: string | null;
}

/** A figure the client typed about themselves, with the day they typed it. */
export interface ManualEntry {
  /** Kilograms, as stored, or null when they typed no weight. */
  weightKg: number | null;
  bodyFatPct: number | null;
  /** `manual_at` is a timestamptz — an instant, not a bare day. */
  atISO: string;
}

/**
 * The client's typed figures, or null when there are none.
 *
 * Null when the timestamp is missing even if a figure is present: without
 * `manual_at` there is no way to tell a weight typed this morning from one left
 * over from six months ago, which is the whole reason that column exists, and
 * an undated figure shown beside dated ones would be read as current.
 */
export function readManual(row: ManualRow | null | undefined): ManualEntry | null {
  if (!row || !row.manual_at) return null;
  const w = num(row.manual_weight_kg);
  const f = num(row.manual_body_fat_pct);
  const weightKg = w != null && w > 0 ? w : null;
  const bodyFatPct = f != null && f > 0 ? f : null;
  if (weightKg == null && bodyFatPct == null) return null;
  return { weightKg, bodyFatPct, atISO: row.manual_at };
}

/**
 * Whether the client's own app is currently showing these typed figures rather
 * than their newest scan.
 *
 * The same comparison as `manualIsCurrent` in src/ui/clientData.tsx, and it has
 * to stay the same: the point of showing this to a coach is to tell them what
 * is on the client's screen, so a coach and a client disagreeing about which
 * number is live would be worse than not showing it at all.
 */
export function manualIsCurrent(m: ManualEntry, latestScanISO: string | null): boolean {
  if (latestScanISO == null) return true;
  const a = Date.parse(m.atISO);
  const b = Date.parse(latestScanISO);
  if (!isFinite(a) || !isFinite(b)) return false;
  return a >= b;
}

/**
 * What to say about the typed figures, addressed to the coach.
 *
 * It says which figures they are, when they were typed, and — the part that
 * matters — whether they or the scan are what the client is reading on their
 * own phone right now.
 */
/**
 * The typed figures themselves, in the coach's unit, with the day they were
 * typed — and nothing about the scans.
 *
 * Split out from `manualLine` because a screen whose scan read FAILED still
 * knows these and still has to show them, and must not be handed a sentence
 * that says "there is no scan on record" when what actually happened is that
 * nobody could ask. The comparison is the caller's to make only once it knows
 * the answer.
 */
export function manualFigures(m: ManualEntry, wu: WeightUnit, who: string): string {
  const parts: string[] = [];
  if (m.weightKg != null) {
    parts.push(`${plain(metricValue(m.weightKg, 'weight', wu))} ${metricUnit('weight', wu)}`);
  }
  if (m.bodyFatPct != null) parts.push(`${plain(m.bodyFatPct)}% body fat`);
  return `${who} typed ${parts.join(' and ')} on ${dayHeading(m.atISO)}.`;
}

export function manualLine(
  m: ManualEntry,
  latestScanISO: string | null,
  wu: WeightUnit,
  who: string,
): string {
  const said = manualFigures(m, wu, who);
  if (latestScanISO == null) {
    return `${said} Nothing was measured — there is no scan on record to compare it against.`;
  }
  return manualIsCurrent(m, latestScanISO)
    ? `${said} It is newer than their last scan, so this is the figure their own app is showing them — not the scan below.`
    : `${said} Their last scan is newer, so their own app is showing them the scan and this is only history.`;
}

/**
 * The one line under the way in to this screen, on app/(trainer)/client.tsx.
 *
 * Its job is to say whether there is anything in here worth opening, and the
 * four answers are four different facts about the person: the read failed, they
 * have never been scanned, they have been scanned once, and they have a trend.
 * `newest` and `hasEarlier` come from a two-row read rather than a count, so
 * nothing here states a number of scans it cannot stand behind.
 */
export function bodyLine(
  failed: boolean,
  loading: boolean,
  newestISO: string | null,
  hasEarlier: boolean,
  todayISO: string,
  who: string,
): string {
  if (failed) {
    return `Their scans could not be read, so whether ${who} has any is unknown rather than none. That is our connection, not their record.`;
  }
  if (loading) return 'Reading their scans…';
  if (newestISO == null) {
    return `No InBody scan on record. The read came back and it was empty, so this is about ${who} rather than about the connection.`;
  }
  const when = whenLabel(newestISO, todayISO).toLowerCase();
  const on = dayHeading(newestISO);
  return hasEarlier
    ? `Last scanned ${on} · ${when}, with earlier scans behind it to measure against.`
    : `One scan, taken ${on} · ${when}. A second one is what turns it into a trend.`;
}

/** The source line for one reading — how the figure got onto the record. Free
 *  text on the table, so an unrecorded source says so rather than being dressed
 *  up as an InBody sheet. */
export function sourceLabel(r: Reading): string {
  return r.source ?? 'source not recorded';
}

/** The metric's own unit as stored, for a caption that has to say what the
 *  record holds rather than what the coach reads. */
export const storedUnit = (key: BodyMetricKey): string => GOAL_METRIC[key].unit;
