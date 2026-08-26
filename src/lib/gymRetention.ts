// The gym as a whole: who it is keeping, who is drifting, who has gone quiet,
// and who is still training where the timetable cannot see them.
//
// Framework-free on purpose, and further than most of the modules go: there is
// not even a Supabase client in here, nor anything it imports. Every function
// takes rows and returns a conclusion, so the same reasoning runs in the
// console, in a test under plain node, and anywhere else that holds the rows.
//
// ── What this adds to what already existed ─────────────────────────────────
//
// `retentionRead` in memberView.ts already answers this per member, and it is
// the better answer: it separates somebody who moved from the 6am class to the
// gym floor from somebody who stopped coming. Nothing rolled it up. An owner
// could open one member at a time and never learn whether the gym is keeping
// people, and "attendance is down 12%" is not that answer either — it is a
// number about classes, and half the training in a gym does not happen in one.
//
// So this module is a roll-up rather than a new model. It calls the per-member
// functions and counts what they say:
//
//   · `retentionRead` for the door-versus-timetable disagreement, which is the
//     part only a gym with a door terminal has the data for at all;
//   · `assessDrift` from clientDrift.ts for the bands, so the owner's number
//     and the coach's book cannot disagree about the same member. Drift there
//     is a BREAK IN A PERSON'S OWN PATTERN, not a level, and no-data is
//     UNKNOWN rather than fine. Both properties survive the roll-up: a gym of
//     twice-a-week members who have always trained twice a week is keeping all
//     of them, and a gym whose activity reads failed reports nothing rather
//     than a roster of people who look perfect because nothing loaded.
//
// ── The two things this view could easily lie about ────────────────────────
//
// 1. A GYM WITH NO DOOR LOG CANNOT BE TOLD WHO HAS LAPSED. A member with no
//    visits looks identical whether the gym has no terminal, the read failed,
//    or they genuinely stopped coming — which is why `retentionRead` takes
//    `doorLogActive` as a required argument rather than guessing. Rolled up,
//    the mistake gets worse rather than better: a whole roster convicted of
//    absence because nobody installed a door reader. `doorLogState` below has
//    three values, not two, and the quiet count is null unless the log is
//    demonstrably live. See `absenceBlocker`.
//
// 2. A RETENTION RATE OVER FOUR PEOPLE IS NOISE WITH A PERCENT SIGN. Cohorts
//    by join month are the natural spine and the memberships table supports
//    them — `startedOn` is on every row — but a month with six joiners does
//    not have a 67% retention rate worth printing. `MIN_COHORT_FOR_RATE`
//    below, and the rule it comes from, are on the screen next to the table.
//
// Everything derived is `number | null` and null means "not knowable from what
// was read". A rate over zero opportunities is null — never 0%, never 100%.

import {
  buildDossiers, retentionRead, attendanceCaveat, rowsOf, sliceFailed,
  PART_LABEL, PART_COST, DEFAULT_WINDOW_DAYS,
  type MemberRecord, type MemberDossier, type RetentionRead, type Slice,
} from './memberView';
import {
  assessDrift, compareDrift, summariseDrift, DEFAULT_WINDOWS,
  type Drift, type DriftSummary, type DriftWindows, type ActivityEvent,
} from './clientDrift';
import { isDelivered } from './gymSessions';
import { monthLabel, nextMonth } from './longView';
import type { MembershipStatus, GymPayment } from './gymRecord';
import type { GymPass } from './gymPasses';
import type { MemberInvite } from './memberInvites';

const DAY = 86_400_000;

/* ── what this view reads, and what it costs when a read fails ─────────────── */

/**
 * The four reads a gym-wide retention view needs.
 *
 * Deliberately not the whole `MemberRecord`. Payments, passes and invites say
 * nothing about whether somebody is still training, and loading them to satisfy
 * a type would be three queries a gym pays for and nobody looks at.
 */
export type RetentionPart = 'memberships' | 'visits' | 'bookings' | 'sessions';

export const RETENTION_PARTS: RetentionPart[] = ['memberships', 'visits', 'bookings', 'sessions'];

/**
 * The three that record a member doing something. `memberships` is the roster,
 * which says who exists, not whether they turned up — and the distinction is
 * load-bearing enough to be in the type: a view that judged attendance from the
 * roster alone would report every member as absent.
 */
export type ActivityPart = Exclude<RetentionPart, 'memberships'>;

export const ACTIVITY_PARTS: ActivityPart[] = ['visits', 'bookings', 'sessions'];

export type RetentionRecord = Pick<MemberRecord, RetentionPart>;

/**
 * Widen to the `MemberRecord` `buildDossiers` wants.
 *
 * The three parts this view never asks about come through as FAILED, not as
 * `ready: []`. An empty array would be a claim — "this gym has taken no
 * payments" — and the dossier would carry `paidCents: 0` off the back of a
 * query that was never sent. Failed is the truth: not available here.
 */
function widen(rec: RetentionRecord): MemberRecord {
  const notAsked = 'Not read by the retention view.';
  return {
    ...rec,
    payments: sliceFailed<GymPayment>(notAsked),
    passes: sliceFailed<GymPass>(notAsked),
    invites: sliceFailed<MemberInvite>(notAsked),
  };
}

export interface BrokenRetentionPart {
  part: RetentionPart;
  label: string;
  cost: string;
  reason: string;
}

/** The reads that failed, in a stable order. */
export function brokenRetentionParts(rec: RetentionRecord): BrokenRetentionPart[] {
  const out: BrokenRetentionPart[] = [];
  for (const part of RETENTION_PARTS) {
    const s: Slice<unknown> = rec[part];
    if (s.state === 'failed') {
      out.push({ part, label: PART_LABEL[part], cost: PART_COST[part], reason: s.reason });
    }
  }
  return out;
}

/** The reads still in flight. */
export function pendingRetentionParts(rec: RetentionRecord): RetentionPart[] {
  return RETENTION_PARTS.filter((p) => rec[p].state === 'loading');
}

/**
 * The sentence above a half-loaded retention page, or null when it is whole.
 *
 * Same shape as `partialWarning` and deliberately not that function: it walks
 * all seven parts, three of which this page never reads, and would therefore
 * warn about payments every single time.
 */
export function retentionWarning(rec: RetentionRecord): string | null {
  const broken = brokenRetentionParts(rec);
  if (!broken.length) return null;
  const names = broken.map((b) => b.label);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const costs = broken.map((b) => b.cost).join('; ');
  return `Could not read ${list}. ${broken.length === 1 ? 'That is' : 'Those are'} missing from every figure below, not counted as nil — ${costs} ${broken.length === 1 ? 'is' : 'are'} unknown here.`;
}

/* ── trap 1: a gym with no door log cannot be told who has lapsed ──────────── */

/**
 * Three states, because two would collapse the one that matters.
 *
 *   live   — the log recorded somebody in the window, so an individual's
 *            silence inside it is evidence about that individual.
 *   silent — read, and it recorded nothing at all. Either the gym has no
 *            terminal or nobody used it. Every member looks absent, and none
 *            of them can be called absent.
 *   unread — the query failed or has not landed. We know less than nothing.
 */
export type DoorLogState = 'live' | 'silent' | 'unread';

export function doorLogState(rec: RetentionRecord): DoorLogState {
  const vis = rowsOf(rec.visits);
  if (vis == null) return 'unread';
  return vis.length > 0 ? 'live' : 'silent';
}

/**
 * Why this gym cannot be told who has lapsed, or null when it can.
 *
 * The counterpart to `attendanceCaveat`: that one warns that attendance is
 * under-counted, this one refuses the absence figure outright. They are
 * different failures — a gym can have a live door log and still under-count if
 * its registers are not taken, and a gym with no door log at all cannot produce
 * an absence figure by any means.
 */
export function absenceBlocker(rec: RetentionRecord): string | null {
  switch (doorLogState(rec)) {
    case 'unread':
      return 'The door log could not be read, so nobody is counted as having gone quiet. A member with no visits and a member whose visits did not load look exactly the same from here.';
    case 'silent':
      return 'The door log recorded nothing at all in this window, so no member can be called absent: with no terminal running, somebody training four times a week leaves the same empty record as somebody who stopped. Class bookings are the only attendance below, and a member on the gym floor is invisible to them.';
    default:
      return null;
  }
}

/* ── trap 2: a percentage over a handful of people ─────────────────────────── */

/**
 * One member's worth of the rate, in percentage points. Null over an empty
 * cohort, where a member is worth nothing because there are none.
 */
export function pointsPerMember(joined: number): number | null {
  return joined > 0 ? 100 / joined : null;
}

/**
 * The smallest cohort allowed to print a percentage.
 *
 * The rule, rather than the number, is: a cohort where a single member is
 * worth MORE THAN TEN POINTS of the rate does not get one. Nine joiners means
 * one person moving swings the figure 11.1 points — further than most of the
 * differences an owner would act on — so the figure is measuring the cohort's
 * size rather than the gym's retention. Ten falls straight out of that, and
 * `pointsPerMember` is exported so the screen can state it in the cohort's own
 * terms instead of asserting a magic number.
 *
 * A cohort under the floor is not hidden. Its counts are shown — four of six
 * still on the books is a true and useful sentence — and only the percentage
 * is withheld.
 */
export const MIN_COHORT_FOR_RATE = 10;

/**
 * How long after its month ends before a cohort may report a rate.
 *
 * Somebody who joined three days ago has not had the opportunity to leave. A
 * current-month cohort therefore retains 100% of its members and always will,
 * which is a fact about the calendar rather than about the gym, and printed
 * next to the older cohorts it reads as the gym's best month ever.
 */
export const COHORT_MATURITY_DAYS = 30;

/** How many join months the spine covers before older joins are folded up. */
export const DEFAULT_SPINE_MONTHS = 24;

/** A rate, or null when the denominator cannot carry one. Never 0, never 1 on
 *  nothing. */
export function rateOf(kept: number, of: number, floor: number = MIN_COHORT_FOR_RATE): number | null {
  if (of <= 0 || of < floor) return null;
  return kept / of;
}

/* ── join dates: check the data supports a cohort spine before assuming ─────── */

/**
 * The join month of one membership row, as 'YYYY-MM', or null when the date is
 * not usable.
 *
 * Taken from the STRING when it is already a plain date, rather than parsed and
 * re-formatted. `Date.parse('2026-08-01')` is UTC midnight, and reading the
 * local month back off it puts that member in July everywhere west of
 * Greenwich — a whole cohort moved by a timezone. A gym's calendar is its own.
 */
export function monthOfDate(date: string | null | undefined): string | null {
  if (!date) return null;
  if (/^\d{4}-\d{2}(-|$)/.test(date)) return date.slice(0, 7);
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * When this member first joined: the earliest start across every membership
 * they have ever held.
 *
 * The earliest, not the current one. Somebody who cancelled in March and
 * rejoined in June belongs to their original cohort — filing them under June
 * would show a gym that recruits well and keeps nobody, built entirely out of
 * its own returning members.
 */
export function joinedOn(d: MemberDossier): string | null {
  const ms = d.memberships;
  if (!ms || !ms.length) return null;
  let best: string | null = null;
  for (const m of ms) {
    const s = m.startedOn;
    if (!s) continue;
    if (best == null || String(s) < String(best)) best = String(s);
  }
  return best;
}

/**
 * Whether the roster carries enough dated joins to draw cohorts at all.
 *
 * Asked rather than assumed. A gym imported from a spreadsheet can arrive with
 * every membership stamped on the import date, which produces one enormous
 * cohort and eleven empty months — a chart that looks like a finding and is an
 * artefact of the import.
 */
export interface CohortFeasibility {
  dated: number;
  undated: number;
  months: number;
  usable: boolean;
  reason: string;
}

export function cohortFeasibility(rows: { joinedOn: string | null }[]): CohortFeasibility {
  const months = new Set<string>();
  let dated = 0;
  let undated = 0;
  for (const r of rows) {
    const k = monthOfDate(r.joinedOn);
    if (k == null) { undated++; continue; }
    dated++;
    months.add(k);
  }
  const n = months.size;
  if (dated === 0) {
    return { dated, undated, months: 0, usable: false, reason: 'No membership on the roster carries a usable start date, so there are no cohorts to build.' };
  }
  if (n < 2) {
    return {
      dated, undated, months: n, usable: false,
      reason: `Every dated membership starts in the same month, so there is nothing to compare one cohort against. This is what an imported roster looks like when the import date was written into every row.`,
    };
  }
  return {
    dated, undated, months: n, usable: true,
    reason: `${dated} membership${dated === 1 ? '' : 's'} across ${n} join months.`,
  };
}

/* ── one member's row ──────────────────────────────────────────────────────── */

export interface RetentionRow {
  memberId: string;
  name: string | null;
  status: MembershipStatus | null;
  planName: string | null;
  joinedOn: string | null;
  /** 'YYYY-MM', or null when they carry no usable start date. */
  cohort: string | null;
  /** Holding a live membership: active or frozen. Null when the roster read
   *  failed, which cannot happen for a row that exists — kept as a field so a
   *  caller never has to re-derive it from the status string. */
  onBooks: boolean;
  /**
   * Their own pattern, broken or held, on exactly the model the coach's book
   * uses. Null when NOTHING that records activity could be read — a gym whose
   * three activity queries all failed must not be handed a roster of members
   * marked "nothing recorded", which is a statement about the network wearing
   * the clothes of a statement about the member.
   */
  drift: Drift | null;
  /** Door versus timetable. Null when the two reads it needs are not both in. */
  read: RetentionRead | null;
  /** Stopped booking classes, still coming through the door. */
  offTimetable: boolean;
  /** Not through the door once in the recent half, while the log was live. */
  quiet: boolean;
  lastSeenDays: number | null;
}

/**
 * Every sign of life this gym recorded for one member, in the shape
 * `assessDrift` reads.
 *
 * A part that did not load contributes nothing, which is correct — it is the
 * gym-level `sources` list that decides whether a drift verdict may be offered
 * at all, because that is the only place that knows the difference between
 * "read, and the member did nothing" and "not read".
 *
 * Active days are de-duplicated by `assessDrift`, so a class attendance that
 * also produced a door scan counts once. Counting it twice would let one busy
 * Tuesday cover a fortnight of silence.
 */
export function activityFor(d: MemberDossier): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const v of d.visits ?? []) out.push({ at: v.enteredAt, kind: 'visit' });
  // Only a booking somebody actually ticked off. A booked place is an
  // intention; `attendedAt` is the evidence, and treating the first as the
  // second is how a gym reads a member as attending right up to the month they
  // vanish.
  for (const b of d.bookings ?? []) {
    if (b.status !== 'cancelled' && b.attendedAt && b.startsAt) out.push({ at: b.startsAt, kind: 'check_in' });
  }
  for (const s of d.sessions ?? []) {
    if (isDelivered(s)) out.push({ at: s.startsAt, kind: 'session' });
  }
  return out;
}

/* ── the cohort spine ──────────────────────────────────────────────────────── */

export type RateSuppression = 'too-small' | 'too-young' | null;

export interface Cohort {
  /** 'YYYY-MM', or 'earlier' for the fold-up bucket. */
  month: string;
  label: string;
  joined: number;
  active: number;
  frozen: number;
  lapsed: number;
  /** Active plus frozen. A freeze is a pause the gym agreed to, not a leaver. */
  onBooks: number;
  /** onBooks / joined, or null when the cohort cannot carry a percentage. */
  retention: number | null;
  /**
   * Of the cohort, how many are measurably still training — holding their own
   * pattern or only slipping from it. Null when no activity source was read.
   *
   * Note what this is NOT: it is not "not lapsed". A member whose pattern the
   * record cannot judge is absent from this count rather than added to it.
   */
  training: number | null;
  trainingRate: number | null;
  /** How many of the cohort the record cannot judge either way. */
  unknown: number | null;
  suppressed: RateSuppression;
  /** Whole months from the start of the cohort's month to now. */
  ageMonths: number;
}

export interface CohortSpine {
  /** Oldest first. Months inside the window with no joins are present at zero —
   *  a month the gym recruited nobody is information, and dropping it lets a
   *  chart draw a straight line through it. */
  cohorts: Cohort[];
  /** Everything before the window, as one bucket. Null when there is none. */
  earlier: Cohort | null;
  /** Members with no usable start date. Never folded into a cohort. */
  undated: number;
  feasibility: CohortFeasibility;
  /** How many cohorts are big enough and old enough to print a rate. */
  reportable: number;
  /** What the table says under itself about the floor, always — including when
   *  every cohort clears it, because the reader needs to know the rule is
   *  there before they trust the numbers that pass it. */
  floorNote: string;
}

/* ── the whole thing ───────────────────────────────────────────────────────── */

export interface GymRetentionSummary {
  /** Everyone who holds or has ever held a membership. Null when unread. */
  roster: number | null;
  onBooks: number | null;
  active: number | null;
  frozen: number | null;
  lapsed: number | null;
  /**
   * Bands on the coach-side model: steady / watch / drifting / unknown. Null
   * when no activity read landed at all.
   */
  bands: DriftSummary | null;
  /** Stopped booking classes, still coming in. The figure only a gym with a
   *  live door log has the data for, and null without one — see trap 1. */
  offTimetable: number | null;
  /** Gone quiet. Null unless the door log is demonstrably live — see trap 1. */
  quiet: number | null;
}

export interface GymRetentionOptions {
  now?: number;
  /** The door-versus-timetable comparison span, split in half. */
  windowDays?: number;
  /** Drift windows. Defaulted from clientDrift so the owner's bands and the
   *  coach's book are the same measurement, not two that resemble each other. */
  driftWindows?: DriftWindows;
  /** Smallest cohort allowed a percentage. */
  minCohort?: number;
  /** How many join months the spine covers before older joins fold up. */
  spineMonths?: number;
}

export interface GymRetention {
  now: number;
  windowDays: number;
  driftWindows: DriftWindows;
  minCohort: number;
  doorLog: DoorLogState;
  /** Which activity reads actually landed. Empty means no drift verdict is
   *  offered for anybody. */
  sources: ActivityPart[];
  summary: GymRetentionSummary;
  /** One row per member, worst first. Null when the roster could not be read —
   *  and not rebuilt from whoever happens to appear in the door log, which
   *  would silently drop every member who has not been in this month. */
  rows: RetentionRow[] | null;
  spine: CohortSpine | null;
  broken: BrokenRetentionPart[];
  warning: string | null;
  /** Attendance is class-only. Reused verbatim from the member page. */
  caveat: string | null;
  /** Why nobody can be called absent, or null when they can. */
  blocker: string | null;
}

/**
 * Roll the per-member reads up into the gym.
 *
 * `now` is an argument rather than ambient so a test and a screen agree, and so
 * two figures on the same page cannot be computed a millisecond apart across a
 * month boundary.
 */
export function buildGymRetention(
  rec: RetentionRecord,
  opts: GymRetentionOptions = {},
): GymRetention {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const driftWindows = opts.driftWindows ?? DEFAULT_WINDOWS;
  const minCohort = opts.minCohort ?? MIN_COHORT_FOR_RATE;
  const spineMonths = opts.spineMonths ?? DEFAULT_SPINE_MONTHS;

  const door = doorLogState(rec);
  const sources = ACTIVITY_PARTS.filter((p) => rec[p].state === 'ready');
  const broken = brokenRetentionParts(rec);
  const wide = widen(rec);

  const dossiers = buildDossiers(wide, now);

  const base: GymRetention = {
    now, windowDays, driftWindows, minCohort,
    doorLog: door,
    sources,
    summary: {
      roster: null, onBooks: null, active: null, frozen: null, lapsed: null,
      bands: null, offTimetable: null, quiet: null,
    },
    rows: null,
    spine: null,
    broken,
    warning: retentionWarning(rec),
    caveat: attendanceCaveat(wide),
    blocker: absenceBlocker(rec),
  };

  if (dossiers == null) return base;

  const canRead = rec.visits.state === 'ready' && rec.bookings.state === 'ready';
  const canDrift = sources.length > 0;

  const rows: RetentionRow[] = dossiers.map((d) => {
    const read = canRead ? retentionRead(d, { now, windowDays, doorLogActive: door === 'live' }) : null;
    const drift = canDrift
      ? assessDrift({ clientId: d.memberId, events: activityFor(d), since: joinedOn(d) }, now, driftWindows)
      : null;
    const on = d.status === 'active' || d.status === 'frozen';
    const started = joinedOn(d);
    return {
      memberId: d.memberId,
      name: d.name,
      status: d.status,
      planName: d.planName,
      joinedOn: started,
      cohort: monthOfDate(started),
      onBooks: on,
      drift,
      read,
      offTimetable: !!read?.stillTrainingOffTheTimetable,
      // Only ever claimable against a live log. `retentionRead` already gates
      // this; repeating the gate here would be belt and braces, and reading it
      // straight through keeps one definition of absence in the codebase.
      quiet: !!read?.absentFromLiveDoorLog,
      lastSeenDays: d.lastSeenDays,
    };
  }).sort(compareRows);

  const active = rows.filter((r) => r.status === 'active').length;
  const frozen = rows.filter((r) => r.status === 'frozen').length;
  const lapsed = rows.filter((r) => r.status === 'cancelled' || r.status === 'expired').length;

  return {
    ...base,
    summary: {
      roster: rows.length,
      onBooks: rows.filter((r) => r.onBooks).length,
      active, frozen, lapsed,
      bands: canDrift ? summariseDrift(rows.map((r) => r.drift!)) : null,
      // Both of these are null, not zero, unless the door log is demonstrably
      // live — and for the same reason in both directions. "Nobody has stopped
      // coming" and "nobody is training off the timetable" are each a claim
      // about a door log, and a gym with no terminal has not earned either. A
      // zero would be read as a finding; a dash is read as a gap, which it is.
      offTimetable: canRead && door === 'live' ? rows.filter((r) => r.offTimetable).length : null,
      quiet: canRead && door === 'live' ? rows.filter((r) => r.quiet).length : null,
    },
    rows,
    spine: buildSpine(rows, { now, minCohort, spineMonths, canDrift }),
  };
}

/**
 * The book's order, worst first, deferring to `compareDrift` wherever both rows
 * carry a verdict so this list and the coach's agree on who leads.
 *
 * Rows with no verdict at all — every activity read failed — sort last by name.
 * They are not "fine" and they are not "unknown" either; there is simply no
 * ranking to apply, and interleaving them with judged rows would suggest one.
 */
export function compareRows(a: RetentionRow, b: RetentionRow): number {
  if (a.drift && b.drift) {
    const d = compareDrift(a.drift, b.drift);
    if (d !== 0) return d;
  } else if (a.drift || b.drift) {
    return a.drift ? -1 : 1;
  }
  return (a.name ?? '￿').localeCompare(b.name ?? '￿') || a.memberId.localeCompare(b.memberId);
}

/* ── building the spine ────────────────────────────────────────────────────── */

function buildSpine(
  rows: RetentionRow[],
  o: { now: number; minCohort: number; spineMonths: number; canDrift: boolean },
): CohortSpine {
  const feasibility = cohortFeasibility(rows);
  const undated = rows.filter((r) => r.cohort == null).length;

  const floorNote = `Cohorts under ${o.minCohort} members show counts only. At ${o.minCohort} joiners one member is worth ${fmtPoints(100 / o.minCohort)} points of the percentage; below that a single person moving swings it further than anything an owner would act on, so the rate would be measuring the cohort's size. A cohort is also left without a rate until ${COHORT_MATURITY_DAYS} days after its month ended — nobody who joined this month has had the chance to leave yet.`;

  if (!feasibility.usable) {
    return { cohorts: [], earlier: null, undated, feasibility, reportable: 0, floorNote };
  }

  const dated = rows.filter((r) => r.cohort != null);
  const keys = dated.map((r) => r.cohort!).sort();
  const firstKey = keys[0];
  const nowKey = monthKeyAt(o.now);

  // The window: the last `spineMonths` months ending with the one running now.
  const d = new Date(o.now);
  const windowStart = monthKeyAt(new Date(d.getFullYear(), d.getMonth() - (o.spineMonths - 1), 1).getTime());

  // Never start the spine before the gym's first joiner: twenty-four empty bars
  // in front of a gym that opened in March is a chart about the calendar. And
  // never after this month — a membership dated in the future is a typo at the
  // desk, not a cohort, and it must not take the whole spine with it.
  const from = firstKey > windowStart && firstKey <= nowKey ? firstKey : windowStart;
  const months: string[] = [];
  for (let k = from; k <= nowKey && months.length <= o.spineMonths + 1; k = nextMonth(k)) months.push(k);

  const byMonth = new Map<string, RetentionRow[]>();
  for (const m of months) byMonth.set(m, []);
  const older: RetentionRow[] = [];
  for (const r of dated) {
    const bucket = byMonth.get(r.cohort!);
    if (bucket) bucket.push(r);
    else older.push(r);
  }

  const cohorts = months.map((m) => cohortOf(m, monthLabel(m), byMonth.get(m)!, o));
  // Everything outside the window in one bucket, so a gym that opened in 2015
  // does not get a hundred and thirty bars — and so those members are still
  // counted somewhere rather than dropped off the end of the chart.
  const earlier = older.length
    ? { ...cohortOf('earlier', 'Before that', older, o), ageMonths: monthsBetweenKeys(firstKey, nowKey) }
    : null;

  const all = earlier ? [...cohorts, earlier] : cohorts;
  return {
    cohorts,
    earlier,
    undated,
    feasibility,
    reportable: all.filter((c) => c.retention != null).length,
    floorNote,
  };
}

function cohortOf(
  month: string,
  label: string,
  members: RetentionRow[],
  o: { now: number; minCohort: number; canDrift: boolean },
): Cohort {
  const joined = members.length;
  const active = members.filter((r) => r.status === 'active').length;
  const frozen = members.filter((r) => r.status === 'frozen').length;
  const lapsed = members.filter((r) => r.status === 'cancelled' || r.status === 'expired').length;
  const onBooks = active + frozen;

  const ageMonths = month === 'earlier' ? 0 : monthsBetweenKeys(month, monthKeyAt(o.now));
  const suppressed = suppressionFor(joined, month === 'earlier' ? Infinity : matureAt(month), o.minCohort, o.now);

  // Still training: holding their pattern, or slipping but not gone. A member
  // the record cannot judge is counted in `unknown`, never quietly added here.
  const training = o.canDrift
    ? members.filter((r) => r.drift && (r.drift.status === 'on_track' || r.drift.status === 'watch')).length
    : null;
  const unknown = o.canDrift ? members.filter((r) => r.drift && r.drift.unknown).length : null;

  return {
    month, label, joined, active, frozen, lapsed, onBooks,
    retention: suppressed ? null : rateOf(onBooks, joined, o.minCohort),
    training,
    trainingRate: suppressed || training == null ? null : rateOf(training, joined, o.minCohort),
    unknown,
    suppressed,
    ageMonths,
  };
}

/** When a cohort's month ends, plus the maturity grace. */
function matureAt(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return Infinity;
  // Day 1 of the following month, in the gym's own calendar.
  return new Date(y, m, 1).getTime() + COHORT_MATURITY_DAYS * DAY;
}

function suppressionFor(joined: number, matureFrom: number, floor: number, now?: number): RateSuppression {
  if (joined < floor) return 'too-small';
  if (now != null && matureFrom !== Infinity && now < matureFrom) return 'too-young';
  return null;
}

function monthKeyAt(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsBetweenKeys(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  if (![ay, am, by, bm].every(Number.isFinite)) return 0;
  return Math.max(0, (by - ay) * 12 + (bm - am));
}

function fmtPoints(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/* ── words for the screen ──────────────────────────────────────────────────── */

/** Why this cohort shows no percentage, in a sentence. Null when it shows one. */
export function suppressionNote(c: Cohort, floor: number = MIN_COHORT_FOR_RATE): string | null {
  if (c.suppressed === 'too-small') {
    const p = pointsPerMember(c.joined);
    return c.joined === 0
      ? 'Nobody joined this month, so there is no rate to report.'
      : `${c.joined} member${c.joined === 1 ? '' : 's'} — one of them is worth ${fmtPoints(p!)} points, so no percentage is shown. The floor is ${floor}.`;
  }
  if (c.suppressed === 'too-young') {
    return `Too recent to judge: this cohort gets a rate ${COHORT_MATURITY_DAYS} days after its month ends, once its members have had the chance to leave.`;
  }
  return null;
}

/** The headline sentence, or null when the record cannot support one. */
export function headline(g: GymRetention): string | null {
  const s = g.summary;
  if (s.roster == null) return null;
  if (s.bands == null) {
    return `${s.roster} on the roster, ${s.onBooks} still holding a membership. Nothing that records attendance could be read, so how many of them are still training is unknown — not zero.`;
  }
  const parts: string[] = [
    `${s.bands.steady} of ${s.roster} holding their own pattern`,
    `${s.bands.watch} slipping`,
    `${s.bands.drifting} well down on it`,
  ];
  if (s.bands.unknown) parts.push(`${s.bands.unknown} the record cannot judge`);
  let out = `${parts.join(', ')}.`;
  if (s.offTimetable) {
    out += ` ${s.offTimetable} stopped booking classes but ${s.offTimetable === 1 ? 'is' : 'are'} still coming through the door — a class-only report would have written ${s.offTimetable === 1 ? 'them' : 'them all'} off.`;
  }
  if (s.quiet != null && s.quiet > 0) {
    out += ` ${s.quiet} not through the door once while the log was recording others.`;
  }
  return out;
}
