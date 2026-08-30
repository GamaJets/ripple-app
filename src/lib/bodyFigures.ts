// Where a body figure came from, when it was measured, and how old that makes
// it — decided once, so that two screens cannot answer the same question two
// different ways.
//
// ── THE BUG THIS FILE EXISTS FOR ──────────────────────────────────────────
//
// TestFlight, build 35: "Progress numbers say something different than the
// numbers on the body page this needs to be synced."
//
// They did, and it was not a rounding difference. src/ui/clientData.tsx
// publishes a genuine single source of truth for the current body:
//
//     const manualIsCurrent = manualAt != null && (latest == null || …);
//     const weightKg = (manualWeight != null && manualIsCurrent)
//       ? manualWeight : (latest ? latest.weightKg : null);
//
// — the most RECENT of {a weigh-in the client logged, the newest InBody scan}
// wins. app/(client)/checkin.tsx calls `cd.setWeightKg(kg)` on every weekly
// weigh-in, so for most clients most of the time the current weight is a
// weigh-in and not a scan.
//
// app/(client)/scans.tsx read that derived figure. app/(client)/body-trends.tsx
// did not: it re-derived its own series straight from `cd.scans`, so its
// "Weight" was always the last INBODY SCAN. One client, one day, one word —
// two numbers, and no way for the client to tell which was which because
// neither screen said where its figure came from.
//
// So the fix is not to round the two into looking alike. Both screens now read
// the series clientData already publishes (`weightSeries`, `bodyFatSeries`,
// `muscleSeries`), which makes the trailing figure the same value by
// construction, and both screens use this module to SAY which kind of reading
// it is and when it was taken.
//
// ── AND THE OTHER HALF: "Need to see the dates the weight was measured" ───
//
// The same report round asked for dates, and the request is the same request:
// a figure whose provenance and date are unstated is not a measurement, it is
// a number. Everything below is date-aware, and every date-only value is read
// through src/lib/localDate.ts — `scans.taken_at` is a bare postgres DATE, and
// `new Date('2026-08-01')` is 31 July for every client west of Greenwich.
//
// Pure on purpose: no React, no provider, no `Date.now()` inside the answers.
// "Today" arrives as an argument so the suite can assert on staleness without
// waiting a month for it.

import { dateParts, localDate } from './localDate';

/**
 * Which instrument produced a figure.
 *
 * `'scan'` is an InBody (or whatever the client photographed into the scan
 * sheet); `'weigh-in'` is a weight the client typed on the check-in or profile
 * screen. They are not interchangeable and the screens must not present them
 * as though they were: a scan reports weight, body fat and skeletal muscle
 * together on one machine on one day, and a weigh-in reports a weight off a
 * bathroom scale.
 */
export type BodySource = 'scan' | 'weigh-in';

/** A figure with the two things that make it a measurement rather than a number. */
export interface BodyReading {
  value: number;
  /** The calendar day it was taken — a bare `YYYY-MM-DD` for a scan, an ISO
   *  instant for a logged weigh-in. Both are read through localDate. */
  at: string;
  source: BodySource;
}

/** The `{ t, v }` shape clientData publishes for each metric. */
export interface SeriesPoint { t: string; v: number }

/**
 * A body-composition figure older than this is describing a body that has had
 * time to stop being the one on screen.
 *
 * Four weeks, because that is roughly the interval a gym re-scans on and the
 * shortest window over which a training block is expected to move any of these
 * numbers. It is a display threshold and nothing else — no figure is hidden or
 * discarded for crossing it, it is only labelled.
 */
export const STALE_AFTER_DAYS = 28;

/**
 * The series, split into readings that know where they came from.
 *
 * The rule is structural rather than a guess at the data. clientData builds
 * each series as one point per scan, oldest first, and then appends AT MOST
 * ONE further point — the logged weigh-in — and only when that weigh-in is
 * more recent than the newest scan:
 *
 *     weightSeries: [...sorted.map(…), ...(manualIsCurrent && manualWeight != null ? [{…}] : [])]
 *
 * So the first `scanCount` points are scans and anything past them is a
 * weigh-in. Classifying by the shape of the date string instead — bare date
 * means scan, timestamp means weigh-in — was the tempting alternative and is
 * wrong the moment a client logs a weigh-in on a day they were also scanned,
 * which is exactly the day the two screens disagreed on.
 *
 * `scanCount` is `cd.scans.length`, from the same provider and the same
 * render, so the two cannot drift apart between them.
 */
export function bodyReadings(
  series: SeriesPoint[] | null | undefined,
  scanCount: number,
): BodyReading[] {
  if (!series?.length) return [];
  return series
    .filter((p) => p && typeof p.v === 'number' && Number.isFinite(p.v) && !!p.t)
    .map((p, i) => ({ value: p.v, at: p.t, source: i < scanCount ? 'scan' : 'weigh-in' } as BodyReading));
}

/**
 * The current reading, or null when nothing has been measured.
 *
 * Null and not a zero, and not the last scan as a consolation prize: "we have
 * no reading for you" and "you weigh nothing" are opposite statements, and
 * only one of them is ever true.
 */
export function latestBodyReading(
  series: SeriesPoint[] | null | undefined,
  scanCount: number,
): BodyReading | null {
  const all = bodyReadings(series, scanCount);
  return all.length ? all[all.length - 1] : null;
}

/**
 * Today, as a bare `YYYY-MM-DD` in the reader's own zone.
 *
 * The only impure function in the file, kept to one line and separate from
 * everything that decides anything, so the staleness answers below stay
 * assertable. `toISOString().slice(0, 10)` is NOT this: it is the UTC day,
 * which is tomorrow for a client in Auckland every evening.
 */
export function todayISO(now: Date = new Date()): string {
  const p = [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  return `${p[0]}-${String(p[1]).padStart(2, '0')}-${String(p[2]).padStart(2, '0')}`;
}

/**
 * Whole calendar days from one day to another, counted the way the person
 * living them counts.
 *
 * Both sides go through localDate, so a bare DATE becomes LOCAL midnight
 * rather than UTC midnight and a scan does not age a day the moment its owner
 * flies west. The rounding is load-bearing rather than sloppy: two local
 * midnights across a daylight-saving boundary are 23 or 25 hours apart, and
 * `Math.floor` would report a genuine 7 days as 6 twice a year.
 *
 * Null when either side will not parse — never 0, which would claim the two
 * dates are the same day.
 */
export function daysBetween(fromISO: string | null | undefined, toISO: string | null | undefined): number | null {
  const a = dateParts(fromISO);
  const b = dateParts(toISO);
  if (!a || !b) return null;
  const from = new Date(a[0], a[1], a[2]).getTime();
  const to = new Date(b[0], b[1], b[2]).getTime();
  return Math.round((to - from) / 86400000);
}

/** A date-only or timestamp value as the reader's own calendar day. */
export function dayLabel(iso: string | null | undefined): string {
  const d = localDate(iso);
  return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

/** The short form, for a chart axis where the year is implied by its neighbours. */
export function shortDayLabel(iso: string | null | undefined): string {
  const d = localDate(iso);
  return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';
}

/**
 * "today" / "yesterday" / "18 days ago", or null when the date will not parse.
 *
 * A future date gets its own wording rather than a negative day count: a
 * back-dated entry sheet lets a client pick tomorrow, and "−1 days ago" is not
 * a sentence.
 */
export function agoLabel(iso: string | null | undefined, today: string): string | null {
  const d = daysBetween(iso, today);
  if (d == null) return null;
  if (d < 0) return `dated ${dayLabel(iso)}, which is still to come`;
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/** What the client should call this kind of reading, in running prose. */
export function sourceLabel(source: BodySource): string {
  return source === 'scan' ? 'InBody scan' : 'weigh-in you logged';
}

/**
 * The one line that goes under a figure: what measured it, when, and how long
 * ago that was.
 *
 * Every body figure on the screens this module serves carries one. It is the
 * whole of the third TestFlight report — "Need to see the dates the weight was
 * measured as well" — and it is also the answer to the second one, because a
 * client who can see that Progress is showing Tuesday's weigh-in and
 * Composition is showing last month's scan is no longer looking at a
 * contradiction.
 */
export function measuredNote(reading: BodyReading | null, today: string): string {
  if (!reading) return 'Not measured yet.';
  // The absolute day AND the relative one, because they answer different
  // questions: "12 Aug" is the one a client matches against their own scan
  // sheet, and "18 days ago" is the one that tells them whether to trust it.
  // A date that will not parse says so rather than being quietly dropped —
  // this line is the screen's whole claim about when a figure was measured.
  const ago = agoLabel(reading.at, today);
  return `${sourceLabel(reading.source)} · ${dayLabel(reading.at)} · ${ago ?? 'date unreadable'}`;
}

/**
 * How stale, said out loud — or null while the figure is current enough that
 * saying anything would be noise.
 *
 * "Where a figure is stale, say how stale": the number of days is in the
 * sentence rather than a vague "a while ago", because the client is the only
 * person who can tell whether a month-old scan still describes them, and they
 * can only tell if they are given the month.
 */
export function stalenessNote(reading: BodyReading | null, today: string, staleAfter = STALE_AFTER_DAYS): string | null {
  if (!reading) return null;
  const d = daysBetween(reading.at, today);
  if (d == null || d <= staleAfter) return null;
  return `This is your most recent ${sourceLabel(reading.source)} and it is ${d} days old — your body has had ${d} days to change since.`;
}

/**
 * Why two figures on this screen can carry different dates, said once at the
 * top rather than left for the client to work out.
 *
 * Only shown when the screen is actually displaying a mixture, which is the
 * point: a client whose every figure came off the same scan does not need to
 * be told about a distinction that has not arisen for them.
 */
export function mixedSourceNote(readings: (BodyReading | null)[]): string | null {
  const present = readings.filter((r): r is BodyReading => !!r);
  if (present.length < 2) return null;
  const kinds = new Set(present.map((r) => r.source));
  const days = new Set(present.map((r) => dateParts(r.at)?.join('-') ?? ''));
  if (kinds.size < 2 && days.size < 2) return null;
  return kinds.size > 1
    ? 'These were not all measured by the same thing. Weight and body fat use the most recent of your scans and your logged weigh-ins; skeletal muscle only ever comes from a scan, because a bathroom scale does not report it.'
    : 'These were not all measured on the same day — each figure carries the date it was actually taken.';
}

/**
 * What a metric's series is made of, for a section heading.
 *
 * "6 scans" was the old wording and it stopped being true the moment a logged
 * weigh-in joined the weight series. A count that names the wrong instrument
 * is the same defect as a figure that does, only quieter.
 */
export function readingsLabel(readings: BodyReading[]): string {
  if (!readings.length) return 'No readings yet';
  const scans = readings.filter((r) => r.source === 'scan').length;
  const logged = readings.length - scans;
  if (!logged) return `${scans} scan${scans === 1 ? '' : 's'}`;
  if (!scans) return `${logged} weigh-in${logged === 1 ? '' : 's'}`;
  return `${scans} scan${scans === 1 ? '' : 's'} · ${logged} weigh-in${logged === 1 ? '' : 's'}`;
}

/**
 * Whether a hand-typed figure should be shown INSTEAD of the latest scan.
 *
 * ── The bug this replaces ──────────────────────────────────────────────────
 *
 * It was `Date.parse(manualAt) >= Date.parse(latest.takenAt)`. Those two are
 * not the same kind of value. `scans.taken_at` is a DATE column, so it parses
 * as midnight UTC; `manualAt` is a full timestamp from
 * `new Date().toISOString()`. So the comparison was between an instant and the
 * start of a UTC day, and the typed figure won almost every tie:
 *
 *   · a weight typed at 09:00 on the morning of a scan dated the same day beat
 *     the scan uploaded that afternoon;
 *   · west of Greenwich it was worse — a weight typed at 6pm YESTERDAY is
 *     01:00Z today, which is after midnight UTC of a scan dated TODAY, so
 *     yesterday's estimate beat today's measurement.
 *
 * Reported as "your stats should pull from the latest inbody scan that was
 * uploaded".
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * Compare CALENDAR DAYS in the reader's own timezone, and let the scan take
 * the tie. A scan is a measurement somebody stood on a machine for; a manual
 * figure is what they remembered or estimated. On the day they happen to share,
 * the measurement is the better answer — and it is also the one the person just
 * went to the trouble of uploading.
 *
 * Only a manual entry from a STRICTLY LATER day wins, which is the case it
 * exists for: the scan is a fortnight old and they weighed themselves this
 * morning.
 */
export function manualBeatsScan(
  manualAt: string | null | undefined,
  scanTakenAt: string | null | undefined,
): boolean {
  if (!manualAt) return false;
  // No scan at all: anything typed is the only figure there is.
  if (!scanTakenAt) return true;
  const m = dateParts(manualAt);
  const s = dateParts(scanTakenAt);
  // An unreadable date is not a reason to prefer the typed figure. If we cannot
  // tell which is newer, the measurement stands.
  if (!m || !s) return false;
  const key = (p: [number, number, number]) => p[0] * 10000 + p[1] * 100 + p[2];
  return key(m) > key(s);
}
