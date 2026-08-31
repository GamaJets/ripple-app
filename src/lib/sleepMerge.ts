// Sleep, when more than one device recorded the same night (TF-01).
//
// Until now the app read sleep from exactly one place — the number the client
// typed into the Recovery screen — and the wearable layer read none at all. The
// TestFlight note is that somebody wearing a watch AND a ring expects the night
// to come from their devices, from whichever of them recorded it.
//
// The moment two devices answer, they disagree. A watch and a ring routinely
// differ by twenty minutes on the same night, because they detect sleep onset
// from different signals, and often only one of them was worn at all. So this
// file has to decide what a screen is allowed to say, and the constraints are
// not negotiable:
//
//   · Never average. 7h04 and 6h32 must not become 6h48, because no device
//     recorded 6h48 and there is nobody to ask about it afterwards. The figure
//     shown is always a figure some named device actually reported.
//   · Always attribute. A number without its source cannot be checked by the
//     person it is about, and the whole complaint here was about provenance.
//   · Two readings are not corroboration unless they came from two different
//     kinds of device. Oura's app writes its nights into Apple Health, so
//     "Oura says 7h02 and Apple Health says 7h02" is one measurement seen
//     twice. Calling that agreement would be inventing confidence.
//   · A night nobody recorded is a dash. Not a zero, not last night's figure
//     carried forward. And a night we FAILED to read is a different dash with
//     a different sentence, per src/ui/loadStatus.ts — the recurring bug in
//     this codebase is a failed read rendering as a confident empty.
//
// Everything here is pure so it can be tested against the disagreement cases
// directly; see sleepMerge.test.ts.

import type { ProviderId } from './wearables/types';
import { dateParts } from './localDate';

/**
 * What kind of device produced a reading, which is not the same question as
 * which Repple provider delivered it. The same Oura night can arrive twice —
 * once through the Oura API and once through Apple Health, because the Oura app
 * writes into HealthKit — and those two are one measurement, not two.
 */
export type SleepFamily = 'oura' | 'whoop' | 'fitbit' | 'garmin' | 'watch' | 'phone' | 'manual' | 'unknown';

/** A stretch of time a device says the person was asleep. */
export interface SleepInterval { start: string; end: string }

/**
 * What the device actually measured.
 *
 * Not every recorder stages sleep. Some apps write only HealthKit's "in bed"
 * samples, and time in bed runs twenty to forty minutes longer than time
 * asleep. Dropping those sources would report "nothing recorded" for a night
 * the client's own app did record, and relabelling them as sleep would inflate
 * the figure, so they are kept and marked — the screen says "in bed" and they
 * never vouch for a staged reading.
 */
export type SleepBasis = 'asleep' | 'in-bed';

/** One device's answer for one night. Absence is expressed by having no reading. */
export interface SleepReading {
  provider: ProviderId;      // the Repple provider that delivered it
  sourceId: string;          // stable identity of the recorder (HealthKit bundle id, or the provider id)
  sourceName: string;        // what to show the client: "Ring", "Tim's Apple Watch", "WHOOP"
  family: SleepFamily;
  basis: SleepBasis;
  night: string;             // YYYY-MM-DD, the local calendar night (see nightKey)
  minutesAsleep: number;     // always > 0; see mergeSleepNight on why zero is not a reading
}

/**
 * How one provider's read went. 'unsupported' is deliberately distinct from
 * 'error': "this device cannot tell us about sleep yet" is a fact about us,
 * while 'error' means the read was attempted and did not answer, which makes
 * the night UNKNOWN rather than empty.
 */
export type SleepReadStatus = 'ready' | 'error' | 'unsupported';

export interface SleepRead {
  provider: ProviderId;
  status: SleepReadStatus;
  readings: SleepReading[];
  /** Human sentence for 'error' / 'unsupported'. Never shown for 'ready'. */
  reason?: string;
}

export type Agreement = 'single' | 'corroborated' | 'conflicting';
export type NightOutcome = 'measured' | 'no-record' | 'unknown';

export interface MergedNight {
  night: string;
  outcome: NightOutcome;
  /** Null unless outcome is 'measured'. Always a number one device reported. */
  minutesAsleep: number | null;
  /** The reading being shown, so the screen can name it. Never a computed blend. */
  source: SleepReading | null;
  agreement: Agreement;
  /** Every other reading for this night, best first, so a disagreement is visible. */
  others: SleepReading[];
  /** Longest minus shortest across independent readings; null below two of them. */
  spreadMin: number | null;
  /** Providers whose read failed. Non-empty here means the night may be incomplete. */
  failed: ProviderId[];
}

/**
 * Which device to believe when they disagree, best first.
 *
 * This is an ordering by how the night was measured, not by brand preference.
 * Oura and WHOOP are worn continuously and exist to score sleep; Fitbit and
 * Garmin stage sleep too but are worn overnight less consistently; a watch is
 * next; a phone infers sleep from screen and motion rather than from the body;
 * a hand-typed night is last because it is a memory, not a measurement.
 *
 * Getting this order wrong is survivable by design: it changes WHICH real,
 * attributed figure is shown, and every other reading is still listed beside
 * it. It can never produce a number no device reported.
 */
export const FAMILY_ORDER: SleepFamily[] = ['oura', 'whoop', 'fitbit', 'garmin', 'watch', 'phone', 'manual', 'unknown'];
const familyRank = (f: SleepFamily): number => {
  const i = FAMILY_ORDER.indexOf(f);
  return i < 0 ? FAMILY_ORDER.length : i;
};

/**
 * How far apart two devices may be before the screen stops calling it agreement.
 *
 * Fifteen minutes is roughly the spread two well-worn devices show on the same
 * night from differing onset detection, and it is under 4% of a normal night —
 * a difference the client would not describe as two different answers. Beyond
 * it, both numbers get shown rather than one being quietly preferred.
 */
export const AGREEMENT_TOLERANCE_MIN = 15;

/**
 * How long a break in sleep still counts as the same night.
 *
 * Devices report a night as several samples with awake gaps between them. A
 * client who wakes at 23:52 and falls asleep again at 00:11 had one night, and
 * splitting it at the gap would file half of it under yesterday and half under
 * today — two short nights that never happened.
 */
export const SESSION_GAP_MIN = 60;

const pad = (n: number): string => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number): string => `${y}-${pad(m + 1)}-${pad(d)}`;

/**
 * The local calendar night a moment belongs to.
 *
 * Attribution is by when the sleep ENDED — the morning you woke up — which is
 * the convention every vendor uses for "last night" and the one a client means
 * when they look at today's row.
 *
 * It reads the day through `dateParts`, never through `iso.slice(0, 10)`. That
 * slice is the bug this codebase keeps rediscovering: it is the UTC day, so a
 * client in Los Angeles waking at 06:30 on the 3rd would have the night filed
 * under the 3rd at 13:30 UTC — correct by luck — while one waking at 18:10 on
 * the 2nd in Auckland is 05:10 UTC on the 2nd, and every night west of
 * Greenwich shifts a day the moment the clock crosses midnight UTC.
 */
export function nightKey(iso?: string | null): string | null {
  const p = dateParts(iso);
  if (!p) return null;
  return ymd(p[0], p[1], p[2]);
}

/**
 * The last `count` local calendar nights, today first.
 *
 * Built at NOON rather than at midnight. Constructing local midnight and
 * stepping back a day at a time is the classic way to lose or repeat a date:
 * in the zones whose DST change happens at midnight (Santiago, São Paulo when
 * it observed it) local midnight does not exist on the transition day and the
 * Date lands on 23:00 the day before, so getDate() reports the wrong day.
 * Noon is twelve hours from either edge and no one-hour shift can move it.
 */
export function recentNights(count: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  for (let i = 0; i < Math.max(0, Math.floor(count)); i++) {
    const day = new Date(y, m, d - i, 12);
    out.push(ymd(day.getFullYear(), day.getMonth(), day.getDate()));
  }
  return out;
}

interface Span { startMs: number; endMs: number }

/**
 * Overlapping and touching stretches folded into one.
 *
 * HealthKit is the reason this exists rather than a sum. It returns sleep as
 * category samples that deliberately OVERLAP — an "in bed" sample spanning the
 * same hours as the "core", "deep" and "REM" samples inside it — so adding the
 * durations up reports a twelve-hour night for seven hours of sleep. Cloud
 * vendors also split a night into consecutive stage rows that touch exactly at
 * the boundary, which fold into one span here without inflating anything.
 */
export function foldSleepIntervals(intervals: SleepInterval[]): SleepInterval[] {
  const spans: Span[] = [];
  for (const iv of intervals || []) {
    const a = Date.parse(String(iv?.start));
    const b = Date.parse(String(iv?.end));
    // A zero-length or reversed sample is not sleep; it is a malformed row, and
    // counting it as a boundary would extend the night around it.
    if (!isFinite(a) || !isFinite(b) || b <= a) continue;
    spans.push({ startMs: a, endMs: b });
  }
  spans.sort((x, y) => x.startMs - y.startMs);
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.startMs <= last.endMs) last.endMs = Math.max(last.endMs, s.endMs);
    else out.push({ ...s });
  }
  return out.map((s) => ({ start: new Date(s.startMs).toISOString(), end: new Date(s.endMs).toISOString() }));
}

/**
 * Raw sleep stretches from one device turned into per-night totals.
 *
 * Only time actually asleep is counted: the awake gaps between stretches are
 * excluded from the total but do not end the night unless they run longer than
 * SESSION_GAP_MIN. Naps land on the calendar day they ended, which means a
 * Sunday afternoon nap adds to Sunday rather than being thrown away — it was
 * sleep the person had, and discarding it would under-report the day.
 */
export function nightsFromIntervals(
  intervals: SleepInterval[],
  gapMin: number = SESSION_GAP_MIN,
): { night: string; minutesAsleep: number }[] {
  const folded = foldSleepIntervals(intervals);
  if (!folded.length) return [];
  const gapMs = Math.max(0, gapMin) * 60000;
  const totals = new Map<string, number>();

  let sessionMs = 0;
  let sessionEnd = '';
  let prevEndMs = 0;
  const flush = () => {
    if (!sessionMs || !sessionEnd) return;
    const night = nightKey(sessionEnd);
    if (!night) return;
    totals.set(night, (totals.get(night) || 0) + sessionMs);
  };

  for (const iv of folded) {
    const a = Date.parse(iv.start);
    const b = Date.parse(iv.end);
    if (prevEndMs && a - prevEndMs > gapMs) {
      flush();
      sessionMs = 0;
    }
    sessionMs += b - a;
    sessionEnd = iv.end;
    prevEndMs = b;
  }
  flush();

  return [...totals.entries()]
    .map(([night, ms]) => ({ night, minutesAsleep: Math.round(ms / 60000) }))
    .filter((n) => n.minutesAsleep > 0)
    .sort((x, y) => (x.night < y.night ? 1 : x.night > y.night ? -1 : 0));
}

// A staged reading beats a time-in-bed one from any device, because the
// question on the screen is how long the client slept and only one of the two
// answers it. Beyond that it is family order, then source id so the choice is
// stable rather than dependent on the order the reads happened to return in.
const basisRank = (b: SleepBasis): number => (b === 'asleep' ? 0 : 1);
const byPrecedence = (a: SleepReading, b: SleepReading): number =>
  basisRank(a.basis) - basisRank(b.basis) ||
  familyRank(a.family) - familyRank(b.family) ||
  (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);

/**
 * One night, from however many devices answered for it.
 *
 * `failed` is the list of providers whose read did not come back. It is carried
 * separately from the readings and never treated as a zero: a WHOOP that could
 * not be reached has not told us the client slept badly, it has told us
 * nothing, and a night with no readings AND a failure is 'unknown' rather than
 * 'no-record' so the screen can say which it is.
 */
export function mergeSleepNight(night: string, readings: SleepReading[], failed: ProviderId[] = []): MergedNight {
  // A reading of zero minutes is not a measurement of a sleepless night; it is
  // a device or a mapping that had nothing to say. Letting it through would put
  // "0h" on the screen as a fact, which is the exact fabrication the house rule
  // forbids — an absent night must reach the client as a dash.
  const usable = (readings || [])
    .filter((r) => !!r && r.night === night && typeof r.minutesAsleep === 'number' && isFinite(r.minutesAsleep) && r.minutesAsleep > 0)
    .slice()
    .sort(byPrecedence);

  const failedIds = [...new Set(failed || [])];

  if (!usable.length) {
    return {
      night,
      outcome: failedIds.length ? 'unknown' : 'no-record',
      minutesAsleep: null,
      source: null,
      agreement: 'single',
      others: [],
      spreadMin: null,
      failed: failedIds,
    };
  }

  const chosen = usable[0];

  // One reading per family, and only readings measuring the same thing as the
  // one being shown. Two rows from the same family are the same device reaching
  // us by two routes — the Oura API and the copy Oura wrote into Apple Health —
  // so the second must not be allowed to vouch for the first; and a time-in-bed
  // figure cannot confirm a staged one, because they are answers to different
  // questions that happen to be in the same units. Both are still listed in
  // `others`: they are hidden from the agreement decision, not from the client.
  const independent: SleepReading[] = [];
  const seen = new Set<SleepFamily>();
  for (const r of usable) {
    if (r.basis !== chosen.basis || seen.has(r.family)) continue;
    seen.add(r.family);
    independent.push(r);
  }
  const mins = independent.map((r) => r.minutesAsleep);
  const spreadMin = independent.length >= 2 ? Math.max(...mins) - Math.min(...mins) : null;
  const agreement: Agreement =
    independent.length < 2 ? 'single' : (spreadMin as number) <= AGREEMENT_TOLERANCE_MIN ? 'corroborated' : 'conflicting';

  return {
    night,
    outcome: 'measured',
    // The chosen device's own figure, never a blend of the two.
    minutesAsleep: chosen.minutesAsleep,
    source: chosen,
    agreement,
    others: usable.filter((r) => r !== chosen),
    spreadMin,
    failed: failedIds,
  };
}

/**
 * Every requested night, merged. The nights are passed in rather than derived
 * from the readings so that a night nobody recorded still produces a row — the
 * dash is the answer, and a missing row would silently shorten the list.
 */
export function mergeSleepNights(reads: SleepRead[], nights: string[]): MergedNight[] {
  const all: SleepReading[] = [];
  const failed: ProviderId[] = [];
  for (const rd of reads || []) {
    if (!rd) continue;
    if (rd.status === 'error') failed.push(rd.provider);
    if (rd.status === 'ready') all.push(...(rd.readings || []));
  }
  const byNight = new Map<string, SleepReading[]>();
  for (const r of all) {
    if (!r?.night) continue;
    const list = byNight.get(r.night);
    if (list) list.push(r);
    else byNight.set(r.night, [r]);
  }
  return (nights || []).map((n) => mergeSleepNight(n, byNight.get(n) || [], failed));
}

/**
 * The same nights, told that the read they came from did not happen.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * `mergeSleepNights` learns about failure from the `SleepRead` rows it is
 * handed: a provider that threw arrives as status 'error', lands in `failed`,
 * and its nights come back 'unknown'. That is exactly right for the failure it
 * was designed for — ONE device not answering — and it is silent about the
 * other one.
 *
 * When the walk itself breaks rather than a provider inside it, there are no
 * rows at all. `src/ui/deviceSleep.tsx` catches that, sets `status: 'error'`
 * and — correctly, it has nothing else to offer — sets `reads: []`. Then
 * `mergeSleepNights([], recentNights(7))` sees no readings AND no failures, and
 * every night in the week comes back 'no-record': the confident, specific claim
 * that nobody's watch recorded anything, produced by a read that never
 * completed. On the Recovery screen that renders as seven rows of "nothing
 * recorded" with no warning anywhere, because the warning is driven off the
 * error rows and there are none.
 *
 * That is the house rule's own counter-example — an empty metric under a failed
 * read rendering as a confident empty — surviving in this file family because
 * the failure arrives as an ABSENCE of failures rather than as one.
 *
 * ── What it will and will not touch ─────────────────────────────────────────
 *
 * A night some device actually measured keeps its figure, its source and its
 * 'measured' outcome. A real reading that reached us is not made less true by a
 * later step falling over, and blanking it would be the same fabrication in the
 * opposite direction. It only gains `failed`, so a screen can say the night may
 * be incomplete. Everything else — 'no-record' and any night already 'unknown' —
 * becomes 'unknown', which is the honest answer: we did not ask.
 *
 * `asked` is the providers the walk was going to read, so the sentence can name
 * them. An empty list is still a failure and still produces 'unknown'; the
 * nights are unknown because of the failure, not because of who was in it.
 */
export function markNightsUnread(nights: MergedNight[], asked: readonly ProviderId[] = []): MergedNight[] {
  const failed = [...new Set(asked)];
  return (nights || []).map((n) => {
    if (n.outcome === 'measured') return { ...n, failed: [...new Set([...n.failed, ...failed])] };
    return { ...n, outcome: 'unknown' as NightOutcome, failed: [...new Set([...n.failed, ...failed])] };
  });
}

/** "7h 12m", or a dash when there is nothing a device actually reported. */
export function formatSleepHours(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !isFinite(minutes) || minutes <= 0) return '—';
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
