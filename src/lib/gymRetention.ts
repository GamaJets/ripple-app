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
// 3. A CONTRACT THAT ENDS IS NOT A BEHAVIOURAL SIGNAL AND MUST NOT BE SCORED
//    AS ONE. `memberships.ends_on` is the most certain departure a gym has and
//    nothing above read it. Adding it is not adding a term to the drift score:
//    a member who trains four times a week and whose contract ends on Friday is
//    not "medium risk", she is a certainty with good attendance, and one
//    blended number would rank her below somebody who has merely gone quiet.
//    So the end date gets its own field, its own counts, its own ordering and
//    its own section, and `compareRows` is untouched by it. See the section
//    above `ENDING_SOON_DAYS`, which also states why the window is a fortnight
//    and why an already-expired date is a different finding from an imminent
//    one.
//
// Everything derived is `number | null` and null means "not knowable from what
// was read". A rate over zero opportunities is null — never 0%, never 100%.

import {
  buildDossiers, retentionRead, attendanceCaveat, rowsOf, sliceFailed, isWholeSlice,
  PART_LABEL, PART_COST, DEFAULT_WINDOW_DAYS,
  type MemberRecord, type MemberDossier, type RetentionRead, type Slice,
} from './memberView';
import {
  assessDrift, compareDrift, summariseDrift, DEFAULT_WINDOWS,
  type Drift, type DriftSummary, type DriftWindows, type ActivityEvent,
} from './clientDrift';
import { isDelivered } from './gymSessions';
import { monthLabel, nextMonth } from './longView';
import { addDays, lastDayOf, parts } from './termDates';
import type { MembershipStatus, GymPayment, Membership } from './gymRecord';
import type { GymPass } from './gymPasses';
import type { MemberInvite } from './memberInvites';
import type { DayBasis, TodayWindow } from './gymToday';

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
  return `Could not read ${list}. ${broken.length === 1 ? 'That is' : 'Those are'} missing from every figure below, not counted as nil. ${costs} ${broken.length === 1 ? 'is' : 'are'} unknown here.`;
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
  /**
   * Where they stand against their contract's end date, or null when the caller
   * supplied no `today` to measure against — which is what every caller that
   * predates this field gets, and is why adding it changed nothing for them.
   *
   * NEVER mixed into `drift`, and `compareRows` does not look at it. See the
   * section header above `ENDING_SOON_DAYS` for why the two are kept apart.
   */
  term: MemberTerm | null;
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
  /**
   * The gym's own calendar day, as `gymTodayWindow` in src/lib/gymToday.ts
   * handed it over — which is the only place in the console a "today" comes
   * from, and which carries `basis` and `note` so a screen can say whose day it
   * drew.
   *
   * Left off, the whole contract-end band is null: every row's `term` and the
   * result's `term`. That is the honest answer for a caller that has not said
   * what day it is, and it is what keeps this field from changing anything for
   * the callers that existed before it.
   */
  today?: TodayWindow | null;
  /** The ending-soon window, in days. Defaults to `ENDING_SOON_DAYS`. */
  endingSoonDays?: number;
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
  /**
   * The contract-end picture, or null when no `today` was supplied.
   *
   * A sibling of `summary`, never a part of it: nothing in `summary` moves
   * because of an end date and nothing here is derived from drift. Two columns
   * of evidence, side by side, combined by the person reading them.
   */
  term: TermSummary | null;
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
  const today = opts.today ?? null;
  const soonDays = opts.endingSoonDays ?? ENDING_SOON_DAYS;

  const door = doorLogState(rec);
  const sources = ACTIVITY_PARTS.filter((p) => rec[p].state === 'ready');
  // `isWholeSlice`, not `state !== 'failed'`. Derived ONCE, up here, and used
  // both in the early-return shape below and at the counting: two derivations
  // of "may I count these" is how one of them ends up admitting 'partial'.
  //
  // A truncated roster already forces `rows` to null one layer up — `memberIds`
  // reads `rowsOf`, which answers null for 'partial' — so nothing today reaches
  // the counting over a prefix. This gate is written anyway, here, where the
  // counting happens, because that guarantee is a decision made in another
  // module and could reasonably change; a count of "six memberships end in the
  // next fortnight" over the first thousand rows of a larger gym reads as
  // complete and is a fraction.
  const whole = isWholeSlice(rec.memberships);
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
    // Null all the way down when no day was supplied, and null-counted when the
    // roster is not whole — but the `today`, `basis` and `note` still travel, so
    // a screen that has a day can say whose day it was even on a page where
    // nothing could be counted.
    term: today == null ? null : {
      today: today.day, basis: today.basis, note: today.note, soonDays, whole,
      ending: null, expired: null, openEnded: null, unreadable: null,
      dated: null, notOnBooks: null,
      rollingNote: ROLLING_TERM_NOTE,
    },
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
      // Every membership they hold, not `d.membership`. `currentMembership`
      // picks ONE row to describe them by — the highest-ranked status, then the
      // latest start — and that is the right row for a plan name and a status
      // badge and the wrong one for this question. A member holding an
      // open-ended row and a monthly that ends Friday can have either one
      // chosen by that ranking, and the answer to "when does access run out"
      // must not depend on which.
      term: today == null ? null : memberTerm(d.memberships, today.day, today.basis, soonDays),
    };
  }).sort(compareRows);

  const active = rows.filter((r) => r.status === 'active').length;
  const frozen = rows.filter((r) => r.status === 'frozen').length;
  const lapsed = rows.filter((r) => r.status === 'cancelled' || r.status === 'expired').length;

  const countOf = (s: TermEnd) => (whole ? rows.filter((r) => r.term?.state === s).length : null);

  return {
    ...base,
    term: today == null ? null : {
      today: today.day, basis: today.basis, note: today.note, soonDays, whole,
      ending: countOf('ending'),
      expired: countOf('expired'),
      openEnded: countOf('open-ended'),
      unreadable: countOf('unreadable'),
      dated: countOf('dated'),
      notOnBooks: countOf('not-on-books'),
      rollingNote: ROLLING_TERM_NOTE,
    },
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

/* ── the other kind of evidence: a contract that ends ──────────────────────────
 *
 * Everything above this line measures BEHAVIOUR — a break in somebody's own
 * pattern, read out of visits, bookings and sessions. `memberships.ends_on` is
 * not that. It is a stated fact with a date on it, and a membership ending in
 * twelve days is the most certain departure a gym has.
 *
 * ── Why it is not folded into the drift score ────────────────────────────────
 *
 * Because the two are different kinds of claim and averaging them destroys
 * both. A member who trains four times a week and whose contract ends on Friday
 * is not "medium risk": she is a near-certain departure WITH good attendance,
 * and those two facts point at completely different actions — ring her about
 * the renewal, and do not ring her about her training. A single blended number
 * would rank her below somebody who has merely gone a bit quiet, which is the
 * one member of the two the gym does not need to call this week.
 *
 * So nothing here touches `drift`, `compareRows`, `summariseDrift` or the
 * cohort spine. `compareRows` is byte-identical to what it was; the band gets
 * its OWN field on the row, its own counts, its own ordering
 * (`compareByTermEnd`) and its own section on the screen. A reader sees both
 * columns and does the combining themselves, which is the only place the
 * combining can honestly happen.
 *
 * ── Whose today ─────────────────────────────────────────────────────────────
 *
 * `ends_on` is a bare `YYYY-MM-DD` in a `date` column: a day in the member's
 * own life, with no instant and no zone in it. So it is compared AS A STRING
 * against the gym's own calendar day, exactly as `freezeState` in
 * src/lib/membershipFreeze.ts compares a pause and for the same stated reason —
 * a member and a front desk in two zones must not disagree about whether a
 * contract has run out. Nothing here parses `ends_on` as an instant, because
 * `Date.parse('2026-09-25')` is UTC midnight and reads back as the 24th for
 * every reader west of Greenwich.
 *
 * The day itself arrives from `gymTodayWindow` in src/lib/gymToday.ts, which is
 * the one place in the console a "today" comes from, and it carries `basis` and
 * `note` with it. A gym that has not set `tenants.timezone` gets the reader's
 * calendar day AND `NO_ZONE_NOTE` beside every figure cut on it — gymToday's
 * header argues that trade at length and this module does not get a second
 * opinion on it. What it does do is carry `basis` onto every row and into the
 * summary, so a screen cannot print the band without being able to say whose
 * Friday it meant.
 *
 * No today at all — the option left off — is a fourth thing again, and it is
 * what every existing caller gets: `term` null on every row, `term` null on the
 * result, and not one other field changed. A caller that has not told this
 * module what day it is does not get a guess.
 */

/**
 * How near an ending contract has to be before it is worth a phone call.
 *
 * Fourteen days, and the number is a compromise that has to be stated rather
 * than tuned, because of what `ends_on` actually does on a rolling plan.
 *
 * NOTHING IN THIS PRODUCT MOVES `ends_on` ON A SCHEDULE. supabase/parts/2616 is
 * deliberate that no trigger touches a membership at midnight, and the only
 * code that pushes the date out is `stripe-webhook` on a renewal order somebody
 * PAID for (via `renewalIsContiguous`). So a member on a monthly plan sits with
 * an end date about a month away at all times, and it only moves when money
 * arrives.
 *
 * That has a consequence worth being blunt about: at a 30-day window every
 * monthly member on the roster would stand in this list every day of the year,
 * and a list that is always the whole gym is a list nobody opens. Fourteen days
 * means a monthly member who renewed on time is absent from it for the first
 * half of each cycle. It does NOT mean the list is only leavers — see
 * `ROLLING_TERM_NOTE`, which is printed on the screen rather than left here.
 *
 * `EXPIRING_SOON_DAYS` in src/lib/coachCredentials.ts is 60 and is deliberately
 * not reused: a first-aid certificate is renewed every three years and a
 * membership every month, so the same window on both would flag one of them
 * never and the other always.
 */
export const ENDING_SOON_DAYS = 14;

/**
 * What a gym reading this list has to be told about it, once, in one wording.
 *
 * Not optional and not null: every gym that sells a monthly plan needs it, and
 * a gym that sells only annual ones is not harmed by reading it. The sentence
 * this replaces is the one nobody wrote, which is why a full list would have
 * been read as a crisis.
 */
export const ROLLING_TERM_NOTE =
  'An end date here is the day the membership is currently recorded to run to. Nothing moves it by itself (it only moves when a renewal is actually paid for), so a member on a rolling monthly plan appears here every month in the fortnight before their next payment. Read this list as “has not renewed yet”, not as “is leaving”.';

/**
 * Where a member stands against their own contract's end date.
 *
 * Six, and the first three are the three ways the record can fail to give a
 * date at all. Each of them is a FACT and none of them may be shown as one of
 * the others:
 *
 *   not-on-books — they hold no active or frozen membership. There is no
 *                  forthcoming expiry to forecast because the departure is not
 *                  forthcoming, it already happened, and `status` says so.
 *   open-ended   — they hold a live membership with NO end date. That is a
 *                  state the schema has always had ("null means open-ended,
 *                  which is not the same as expired", memberships.ends_on) and
 *                  it is not a missing value. It is never ranked as ending
 *                  soon, and it is never reported as "ends never" either: an
 *                  open-ended membership carries no expiry risk and says
 *                  nothing whatever about behavioural risk, which is what the
 *                  drift column beside it is for.
 *   unreadable   — every live membership is dated and at least one of those
 *                  dates cannot be read. Kept apart from 'open-ended' for the
 *                  reason `freezeState` keeps it apart from 'none': a date this
 *                  build cannot read is not the absence of a date, and the
 *                  difference is somebody's access to a building. See
 *                  `termDay` for the value that makes this reachable and for
 *                  why a loose check would have hidden it as 'dated'.
 *
 * The last three split a readable date by where the gym's today falls:
 *
 *   expired      — the date has already passed while the status still says
 *                  active or frozen. NOT the same finding as ending soon and
 *                  never counted with it; see `compareByTermEnd`.
 *   ending       — today, or within `ENDING_SOON_DAYS`.
 *   dated        — further out than that.
 */
export type TermEnd =
  | 'not-on-books'
  | 'open-ended'
  | 'unreadable'
  | 'expired'
  | 'ending'
  | 'dated';

export interface MemberTerm {
  state: TermEnd;
  /** The day the member's access is currently recorded to run to, `YYYY-MM-DD`.
   *  Non-null only for 'expired', 'ending' and 'dated' — the other three states
   *  have no date to show, which is the whole of what they say. */
  endsOn: string | null;
  /** Whole calendar days from the gym's today to `endsOn`; 0 on the day itself
   *  and negative once it has passed. Null wherever `endsOn` is.
   *
   *  Derived, never authoritative: `state` comes from the string comparison, so
   *  a rounding here can never move a member across the expired boundary. */
  days: number | null;
  /** Whose calendar `state` and `days` were decided on. Carried per row so a
   *  screen cannot show the band without being able to say whose day it used. */
  basis: DayBasis;
}

/**
 * A bare calendar day out of `ends_on`, or null when the value is not one.
 *
 * Two deliberate differences from the two other readers of this column, and
 * both matter.
 *
 * LOOSER THAN `membershipDates.isDay` at the front: a leading `YYYY-MM-DD` is
 * accepted and sliced, so a value that arrives with a time on the end reads the
 * same here as it does in `memberChurn.isDay`. Two modules reading one column
 * and disagreeing about whether they can read it is worse than either rule.
 *
 * STRICTER THAN `memberChurn.isDay` behind that, and this is the one that
 * earns the 'unreadable' state. `/^\d{4}-\d{2}-\d{2}/` matches '2025-13-40' and
 * '2026-02-30'. Neither is a day, and both STRING-COMPARE AS LATER THAN EVERY
 * REAL DATE — so a loose check would file a corrupt end date as "ends a long
 * time from now" and drop that member out of the band entirely. That is the
 * exact failure this band must not have: a real risk hidden as no risk. Round
 * -tripped against the true length of the month instead, so both are refused
 * and the member is shown as unreadable.
 *
 * UTC only in the sense that `lastDayOf` counts in it. Nothing here turns a day
 * into an instant. (utc-day-ok: this validates a calendar day, it does not date
 * an event.)
 */
export function termDay(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (mo < 0 || mo > 11) return null;
  if (d < 1 || d > lastDayOf(y, mo)) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Whole calendar days between two bare days. Null if either is not one.
 *
 * Both operands have already been resolved to the gym's own calendar, so the
 * zone is spent and this is arithmetic on six integers — the same reasoning
 * `gymWeekday` in src/lib/gymZone.ts states where it parses a gym day back as
 * UTC midnight. (utc-day-ok: both ends are calendar days, neither is an
 * instant, and no instant is produced.)
 */
function daysBetweenDays(from: string, to: string): number | null {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b[0], b[1], b[2]) - Date.UTC(a[0], a[1], a[2])) / DAY);
}

/**
 * One member's standing against their contract's end date.
 *
 * `memberships` is every row they hold; only the LIVE ones — active or frozen —
 * are looked at, because a cancelled row's end date is history and this band is
 * about access the member still has.
 *
 * The precedence is the point, and it is the same shape `memberSpans` in
 * src/lib/memberChurn.ts uses for the mirror-image question:
 *
 *  1. ANY live membership with no end date wins outright, as 'open-ended'. A
 *     member holding a monthly that ends Friday and an open-ended row is not
 *     losing access on Friday, and ranking her as expiring would send the gym
 *     to save somebody who is not going anywhere.
 *  2. Otherwise an unreadable date among them wins, because the gym cannot say
 *     when she loses access and must not be shown a guess.
 *  3. Otherwise the LATEST readable end, since access runs to the last of them.
 *     Latest and not soonest, and the same direction `memberSpans` takes
 *     `leftOn`, so the two modules cannot report different last days for one
 *     member.
 */
export function memberTerm(
  memberships: Membership[] | null | undefined,
  today: string,
  basis: DayBasis,
  soonDays: number = ENDING_SOON_DAYS,
): MemberTerm {
  const live = (memberships ?? []).filter((m) => m.status === 'active' || m.status === 'frozen');
  if (!live.length) return { state: 'not-on-books', endsOn: null, days: null, basis };

  // A blank string is the same absence as null. The console's own date field
  // sends an empty box through as null (see `datesPatch`), but a CSV import and
  // a hand-written row can both put '' in, and '' is not an unreadable date.
  if (live.some((m) => m.endsOn == null || String(m.endsOn).trim() === '')) {
    return { state: 'open-ended', endsOn: null, days: null, basis };
  }

  const days = live.map((m) => termDay(m.endsOn));
  if (days.some((d) => d == null)) {
    return { state: 'unreadable', endsOn: null, days: null, basis };
  }

  // `today` itself has to be a day before any comparison against it means
  // anything — the same first guard `freezeState` applies, and for the same
  // reason: a comparison against a non-date silently answers one way.
  const dayToday = termDay(today);
  const endsOn = (days as string[]).reduce((a, b) => (a > b ? a : b));
  if (dayToday == null) return { state: 'unreadable', endsOn, days: null, basis };

  const horizon = addDays(dayToday, Math.max(0, Math.round(soonDays)));
  const n = daysBetweenDays(dayToday, endsOn);

  // String comparison throughout, on two values this module has just proved are
  // bare days. `horizon` comes from `addDays` in termDates.ts, which is
  // calendar arithmetic on three integers rather than a 24-hour addition, so
  // the fortnight is fourteen days long across a clock change too.
  if (endsOn < dayToday) return { state: 'expired', endsOn, days: n, basis };
  if (horizon != null && endsOn <= horizon) return { state: 'ending', endsOn, days: n, basis };
  return { state: 'dated', endsOn, days: n, basis };
}

/**
 * The gym's contract-end picture, beside the behavioural one and never mixed
 * into it.
 *
 * Every count is null over a roster that is not WHOLE, and that is the rule the
 * brief for this band put first: a retention list over a truncated read is not
 * the gym's retention picture. "Six memberships end in the next fortnight" over
 * the first thousand rows of a larger gym is a figure that reads as complete
 * and is a fraction, and the members past the ceiling are exactly the ones
 * nobody would think to look for. The per-row `term` survives — an individual's
 * own end date is a fact about that row whether or not the row next to it
 * arrived — so the rows that DID come back are still honest; only the counting
 * stops. `isWholeSlice` is the gate, not `state !== 'failed'`.
 */
export interface TermSummary {
  /** The day every state on every row was decided against. */
  today: string;
  basis: DayBasis;
  /** `NO_ZONE_NOTE` when the day is the reader's rather than the gym's. Null
   *  when there is nothing to disclose. Straight through from gymToday so there
   *  is one wording of this in the product. */
  note: string | null;
  /** The window `ending` was cut with, in days. */
  soonDays: number;
  /** Whether the counts below are over the whole roster. False means every
   *  count is null, and the screen owes the reader the truncation banner. */
  whole: boolean;
  ending: number | null;
  /** Already past, with the status still live. A data finding rather than a
   *  forecast, and never added to `ending` — see `compareByTermEnd`. */
  expired: number | null;
  openEnded: number | null;
  unreadable: number | null;
  /** Held no live membership at all. Counted so `ending + expired + openEnded +
   *  unreadable + dated + notOnBooks` accounts for every row and a reader can
   *  see nobody has been dropped. */
  dated: number | null;
  notOnBooks: number | null;
  /** Always present. See `ROLLING_TERM_NOTE`. */
  rollingNote: string;
}

/**
 * The band's own ordering, and the reason this is a second function rather than
 * a change to `compareRows`.
 *
 * `compareRows` orders by a break in somebody's pattern and the coach's client
 * book orders by the same rule, which is what stops the two screens naming
 * different people. Folding a contract date into it would move members in both
 * lists for a reason the coach's book knows nothing about.
 *
 * ── Expired does not sit at the top of "ending soon" ────────────────────────
 *
 * The two are separate groups here, ending first. An end date that has already
 * passed while the status still says Active is not a departure forecast at all
 * — it is the state `datesNotes` in src/lib/membershipDates.ts warns an owner
 * about in so many words: "an end date does not close a membership by itself".
 * That member is training on a contract the record says has run out, which is a
 * billing and access problem and is acted on by a different person on a
 * different day. Sorting the two together by days-until would put the
 * longest-expired row at the very top of a list headed "ending soon", which is
 * wrong about the row and wrong about the heading.
 *
 * Within 'ending', soonest first: the most certain departure leads.
 *
 * Within 'expired', MOST RECENTLY expired first, which is the opposite of
 * soonest-first and is deliberate. A date that passed last week is a renewal
 * conversation still worth having; one that passed two years ago is a stale row
 * nobody is going to phone about. Putting the ancient ones at the top is how a
 * list stops being read at all.
 *
 * Rows with no term — no `today` was supplied — sort last, by name, exactly as
 * `compareRows` puts its unjudged rows last and for the same reason: there is
 * no ranking to apply and interleaving them would imply one.
 */
export function compareByTermEnd(a: RetentionRow, b: RetentionRow): number {
  const ra = termRank(a.term);
  const rb = termRank(b.term);
  if (ra !== rb) return ra - rb;
  const sa = a.term?.state;
  if (sa === 'ending' || sa === 'dated') {
    const c = String(a.term?.endsOn ?? '').localeCompare(String(b.term?.endsOn ?? ''));
    if (c !== 0) return c;
  } else if (sa === 'expired') {
    const c = String(b.term?.endsOn ?? '').localeCompare(String(a.term?.endsOn ?? ''));
    if (c !== 0) return c;
  }
  return (a.name ?? '￿').localeCompare(b.name ?? '￿') || a.memberId.localeCompare(b.memberId);
}

function termRank(t: MemberTerm | null): number {
  switch (t?.state) {
    case 'ending': return 0;
    case 'expired': return 1;
    case 'dated': return 2;
    case 'unreadable': return 3;
    case 'open-ended': return 4;
    case 'not-on-books': return 5;
    default: return 6;
  }
}

/**
 * The words for one member's end date, or null when the caller supplied no day
 * to measure against.
 *
 * Every branch says which of the six it is in the member's own terms. None of
 * them is a dash: a dash is what let an open-ended membership and an unreadable
 * date look like the same blank cell.
 */
export function termLine(t: MemberTerm | null): string | null {
  if (!t) return null;
  switch (t.state) {
    case 'not-on-books':
      return 'No live membership. They have already gone.';
    case 'open-ended':
      return 'Open-ended: no end date recorded, so nothing is due to run out.';
    case 'unreadable':
      return 'An end date is recorded on this membership and it could not be read, so this cannot say when access runs out. Check the row.';
    case 'expired': {
      const n = Math.abs(t.days ?? 0);
      return n === 0
        ? `Ran out today (${t.endsOn}), and the status still says live.`
        : `Ran out ${n} day${n === 1 ? '' : 's'} ago (${t.endsOn}), and the status still says live.`;
    }
    case 'ending': {
      const n = t.days ?? 0;
      return n === 0 ? `Ends today (${t.endsOn}).` : `Ends in ${n} day${n === 1 ? '' : 's'} (${t.endsOn}).`;
    }
    case 'dated':
      return `Runs to ${t.endsOn}.`;
  }
}

/**
 * The sentence above the section, or null when there is no day to measure
 * against or no whole roster to count over.
 *
 * Deliberately says nothing at all about drift, and deliberately does not
 * combine the two counts into one "at risk" figure. It reports the certain
 * thing and stops.
 */
export function termHeadline(g: GymRetention): string | null {
  const t = g.term;
  if (!t || t.ending == null || t.expired == null) return null;
  const bits: string[] = [];
  if (t.ending > 0) {
    bits.push(`${t.ending} membership${t.ending === 1 ? '' : 's'} ${t.ending === 1 ? 'ends' : 'end'} in the next ${t.soonDays} days`);
  }
  if (t.expired > 0) {
    bits.push(`${t.expired} ${t.expired === 1 ? 'has' : 'have'} an end date that has already passed while the status still says live`);
  }
  if (!bits.length) {
    return t.openEnded && t.openEnded > 0
      ? `Nothing ends in the next ${t.soonDays} days. ${t.openEnded} membership${t.openEnded === 1 ? ' is' : 's are'} open-ended, which is not the same as nothing being at risk. The pattern column beside it is the one that says that.`
      : `Nothing ends in the next ${t.soonDays} days.`;
  }
  return `${bits.join(', and ')}. This is a different kind of evidence from the bands above: it is what the record states, not what attendance suggests, so a member can be steady here and certain to leave.`;
}

/* ── building the spine ────────────────────────────────────────────────────── */

function buildSpine(
  rows: RetentionRow[],
  o: { now: number; minCohort: number; spineMonths: number; canDrift: boolean },
): CohortSpine {
  const feasibility = cohortFeasibility(rows);
  const undated = rows.filter((r) => r.cohort == null).length;

  const floorNote = `Cohorts under ${o.minCohort} members show counts only. At ${o.minCohort} joiners one member is worth ${fmtPoints(100 / o.minCohort)} points of the percentage; below that a single person moving swings it further than anything an owner would act on, so the rate would be measuring the cohort's size. A cohort is also left without a rate until ${COHORT_MATURITY_DAYS} days after its month ended, since nobody who joined this month has had the chance to leave yet.`;

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
      : `${c.joined} member${c.joined === 1 ? '' : 's'}. One of them is worth ${fmtPoints(p!)} points, so no percentage is shown. The floor is ${floor}.`;
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
    return `${s.roster} on the roster, ${s.onBooks} still holding a membership. Nothing that records attendance could be read, so how many of them are still training is unknown, not zero.`;
  }
  const parts: string[] = [
    `${s.bands.steady} of ${s.roster} holding their own pattern`,
    `${s.bands.watch} slipping`,
    `${s.bands.drifting} well down on it`,
  ];
  if (s.bands.unknown) parts.push(`${s.bands.unknown} the record cannot judge`);
  let out = `${parts.join(', ')}.`;
  if (s.offTimetable) {
    out += ` ${s.offTimetable} stopped booking classes but ${s.offTimetable === 1 ? 'is' : 'are'} still coming through the door. A class-only report would have written ${s.offTimetable === 1 ? 'them' : 'them all'} off.`;
  }
  if (s.quiet != null && s.quiet > 0) {
    out += ` ${s.quiet} not through the door once while the log was recording others.`;
  }
  return out;
}
