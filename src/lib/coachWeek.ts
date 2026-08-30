// One client's planned week, arranged for the person coaching them.
//
// `planned_days` shipped with a `planned_days_coach_read` policy written for
// exactly this and nothing read it. A client could mark Thursday as a travel
// day and Friday as legs, and the only person who could see either was the
// client — so a coach spent Friday afternoon chasing a session that had been
// called off on Sunday.
//
// ── This file adds no vocabulary ───────────────────────────────────────────
//
// Every judgement below is src/lib/dayPlan.ts's: `planOutcome` decides what may
// be said about a day, `planConflict` decides whether a mark and the programme
// disagree, and `DAY_TYPE_LABEL` names the day. What is here is the arrangement
// — which days are in view, which side of today they sit, and the same
// sentences re-voiced for a coach reading about somebody else. dayPlan speaks
// to the client in the second person ("Your program schedules Push"); handing
// those strings to a coach would have them read a sentence addressed to the
// wrong person about a programme that is theirs, not the reader's.
//
// ── A plan is still not a record, and here it is not even a claim ──────────
//
// The screen this feeds does NOT read the client's training log, and that is a
// decision rather than an omission. `workouts.performed_at` is a timestamptz —
// an instant — so turning it into "was anything logged on their Tuesday"
// requires the client's own timezone, and the schema stores no such column.
// Answering it in the COACH's zone would attribute a client's late-evening
// session to the following day for half the pairs of people using this app,
// and it would do so silently.
//
// So every row here goes through `planOutcome` with `logged` null, which is the
// tri-state's own meaning of "the log did not answer" — it did not, because it
// was not asked. A passed day therefore comes back 'log-unknown' and the coach
// is told plainly that this screen cannot say what happened. That is the whole
// of the guard the header of dayPlan.ts asks for: there is no input to this
// module that makes it say a plan was kept.
//
// Pure and dependency-free apart from dayPlan and localDate, so the window
// arithmetic can be run under the three zones the repo tests in.
import { dateParts } from './localDate';
import {
  compareIsoDays, planConflict, planOutcome, DAY_TYPE_LABEL,
  type PlanConflict, type PlanOutcome, type PlannedDay, type PlannedDayType,
} from './dayPlan';

/**
 * How much of the past is worth showing, in days.
 *
 * A week, and no more. The only thing a passed plan adds is the reason a
 * session did not happen — "they marked Thursday as travel" is what stops a
 * coach opening a chasing message — and that reason is stale within days.
 * Further back it is a list of intentions nobody can check against anything,
 * which is noise wearing the same shape as information.
 */
export const DAYS_BEHIND = 7;

/**
 * How far forward, counting today, in days.
 *
 * A fortnight rather than a week, because the things worth catching are planned
 * in weekly units and a seven-day window shows them too late. A deload week
 * starting Monday appears in a rolling week's view on Monday — the day it
 * begins, by which point the programme for it is already the wrong programme.
 * Fourteen days always contains the whole of the next calendar week whatever
 * day the coach opens this, which is the horizon a coach can still act on.
 */
export const DAYS_AHEAD = 14;

/**
 * Whole days from `a` to `b`, or null when either will not parse.
 *
 * Built with `Date.UTC` on the parts read out of each string, which is NOT the
 * bug src/lib/localDate.ts describes. That bug is parsing a bare date and then
 * reading it back through local getters; here both endpoints are constructed
 * from digits and only ever subtracted from one another, so no timezone is
 * consulted in either direction and no DST transition can shorten a day.
 */
export function daysBetweenIso(a: string, b: string): number | null {
  const pa = dateParts(a), pb = dateParts(b);
  if (!pa || !pb) return null;
  const ms = Date.UTC(pb[0], pb[1], pb[2]) - Date.UTC(pa[0], pa[1], pa[2]);
  return Math.round(ms / 86_400_000);
}

/** The bare date `days` either side of this one, or null when unreadable. */
export function shiftIso(dateISO: string, days: number): string | null {
  const p = dateParts(dateISO);
  if (!p) return null;
  const d = new Date(Date.UTC(p[0], p[1], p[2] + days));
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The span of dates a coach is shown, inclusive at both ends. */
export interface PlanWindow { fromISO: string; toISO: string }

export function planWindow(
  todayISO: string,
  behind: number = DAYS_BEHIND,
  ahead: number = DAYS_AHEAD,
): PlanWindow | null {
  // `ahead` counts today, so the last day in view is ahead - 1 from here.
  const fromISO = shiftIso(todayISO, -behind);
  const toISO = shiftIso(todayISO, ahead - 1);
  return fromISO && toISO ? { fromISO, toISO } : null;
}

/** Which side of today a date sits on. Named rather than a boolean because
 *  today is neither: a day being lived is not yet history and is no longer a
 *  forecast, and the screen says something different about it. */
export type DaySide = 'gone' | 'today' | 'ahead';

export function sideOf(dateISO: string, todayISO: string): DaySide | null {
  const c = compareIsoDays(dateISO, todayISO);
  if (c == null) return null;
  return c < 0 ? 'gone' : c === 0 ? 'today' : 'ahead';
}

/** A planned day with everything dayPlan can say about it worked out once. */
export interface CoachPlanDay {
  plan: PlannedDay;
  side: DaySide;
  /** Always from `planOutcome`. Never 'log-agrees' or 'nothing-logged' while
   *  this screen does not read the log — see the file header. */
  outcome: PlanOutcome;
  /** From `planConflict`, null when there is none AND when the programme could
   *  not be read. The two are kept apart by the caller, which knows which. */
  conflict: PlanConflict | null;
  /** Days from today. Negative behind, 0 today. */
  offset: number;
}

/**
 * The programme's focus for a weekday (0 Sun … 6 Sat), as `scheduledFocus`
 * returns it: a string for a scheduled session, null for a day the programme
 * leaves empty, and `undefined` when the programme is not known at all.
 *
 * The third case is not pedantry. A coach reads `assigned_programs` only for
 * clients currently theirs and only for rows they assigned themselves
 * (assigned_programs_coach_rw, supabase/parts/69), so "no row came back" does
 * not mean "this client has no programme" — it can equally mean the programme
 * is another coach's. `undefined` travels through `planConflict` untouched and
 * no conflict is claimed on it.
 */
export type ScheduledFocus = (weekday: number) => string | null | undefined;

/** 0 Sun … 6 Sat for a bare date, built locally so the weekday is the one the
 *  client would name. Same rule as `weekdayOfIso`, which this defers to via
 *  dateParts rather than re-deriving. */
function weekdayOf(dateISO: string): number | null {
  const p = dateParts(dateISO);
  return p ? new Date(p[0], p[1], p[2]).getDay() : null;
}

/** The three answers a coach can get, kept apart deliberately. */
export type WeekState = 'unreadable' | 'none' | 'planned';

export interface CoachWeek {
  /** 'unreadable' the read failed; 'none' it succeeded and this client has
   *  marked nothing in the window; 'planned' there is something to show. */
  state: WeekState;
  /** Today and forward, soonest first. */
  ahead: CoachPlanDay[];
  /** Behind today, most recent first — the nearest miss is the one being asked
   *  about. */
  gone: CoachPlanDay[];
  /** The subset of `ahead` where the mark and the programme disagree, in date
   *  order. Ahead only: a disagreement is worth surfacing while it can still be
   *  settled, and one on a day already gone is an argument about the past. It
   *  is still drawn on the past row itself, where it explains the day. */
  conflicts: CoachPlanDay[];
}

/** A fresh one each time. Sharing a frozen constant would hand every caller the
 *  same arrays, which is fine until one of them sorts in place. */
const empty = (state: WeekState): CoachWeek => ({ state, ahead: [], gone: [], conflicts: [] });

/**
 * Arrange one client's marks around the coach's today.
 *
 * `days` null means the read failed and is the ONLY thing that produces
 * 'unreadable'. An empty array is a real answer — this client has marked
 * nothing in these three weeks — and the screen is expected to say so in words
 * that do not read as a failure.
 *
 * Rows outside the window are dropped here as well as in the query. The filter
 * is cheap and it means the arrangement can be tested without a database, which
 * is the half of this that can be quietly wrong.
 */
export function coachWeek(
  days: readonly PlannedDay[] | null,
  todayISO: string,
  focusOn: ScheduledFocus,
  window: PlanWindow | null = planWindow(todayISO),
): CoachWeek {
  if (!days) return empty('unreadable');
  if (!window) return empty('none');

  const rows: CoachPlanDay[] = [];
  for (const plan of days) {
    const side = sideOf(plan.dateISO, todayISO);
    const offset = daysBetweenIso(todayISO, plan.dateISO);
    if (!side || offset == null) continue; // a date that will not parse is not a day
    const fromC = compareIsoDays(plan.dateISO, window.fromISO);
    const toC = compareIsoDays(plan.dateISO, window.toISO);
    if (fromC == null || fromC < 0) continue;
    if (toC == null || toC > 0) continue;
    const outcome = planOutcome(plan.type, plan.dateISO, todayISO, null);
    if (!outcome) continue;
    const weekday = weekdayOf(plan.dateISO);
    // A date with no readable weekday cannot be matched against a programme, so
    // the programme is unknown for it rather than empty.
    const scheduled = weekday == null ? undefined : focusOn(weekday);
    rows.push({ plan, side, outcome, conflict: planConflict(plan.type, scheduled), offset });
  }

  const ahead = rows.filter((r) => r.side !== 'gone').sort((a, b) => a.offset - b.offset);
  const gone = rows.filter((r) => r.side === 'gone').sort((a, b) => b.offset - a.offset);
  return {
    state: rows.length ? 'planned' : 'none',
    ahead,
    gone,
    conflicts: ahead.filter((r) => r.conflict),
  };
}

/* ── the same sentences, addressed to the coach ────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * 'Thu 3 Sep'. Assembled rather than handed to `toLocaleDateString`, for the
 * reason `thousands` in src/lib/checklist.ts is assembled: this string is
 * asserted in a test and rendered on devices in every locale the app ships to,
 * and a formatter that changes underneath both makes the test meaningless.
 */
export function dayHeading(dateISO: string): string {
  const p = dateParts(dateISO);
  if (!p) return '—';
  const wd = weekdayOf(dateISO);
  return `${wd == null ? '' : WEEKDAYS[wd] + ' '}${p[2]} ${MONTHS[p[1]]}`;
}

/** 'Today', 'Tomorrow', 'In 4 days', 'Yesterday', '5 days ago'. Which side of
 *  today a date is on has to be legible without counting dates in your head. */
export function whenLabel(dateISO: string, todayISO: string): string {
  const n = daysBetweenIso(todayISO, dateISO);
  if (n == null) return '—';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

/**
 * What may be said about one planned day, to their coach.
 *
 * Every branch is a named member of `PlanOutcome` and none of them says the
 * plan was kept. Three of the six cannot occur while this screen does not read
 * the training log; they are written anyway rather than left to a default,
 * because the day somebody adds that read is the day a missing branch becomes
 * a blank line under a client's name — and because the wording is where the
 * rule lives, so it should be reviewable now rather than improvised then.
 */
export function coachPlanLine(type: PlannedDayType, outcome: PlanOutcome, who: string): string {
  const label = DAY_TYPE_LABEL[type].toLowerCase();
  switch (outcome) {
    case 'not-yet':
      return `${who} has marked this a ${label}. It hasn’t happened yet — this is what they intend, not what they did.`;
    case 'today':
      return `${who} has marked today a ${label}. The day is still running, so there is nothing to hold it against yet.`;
    case 'log-unknown':
      return `${who} marked this a ${label} and the day has gone. This screen doesn’t read their training log, so it can’t tell you whether anything was logged against it.`;
    case 'nothing-logged':
      return `${who} marked this a ${label} and nothing was logged on the day. That is not evidence they kept to it — an unlogged session looks exactly the same from here.`;
    case 'log-agrees':
      return `${who} marked this a ${label} and there is training logged on the day. The log is what happened; this row is only what they meant to do.`;
    case 'log-disagrees':
      return `${who} marked this a ${label} and there is training logged on the day. Both stand as they are — neither has been changed to match the other.`;
  }
}

/**
 * A disagreement between the mark and the programme, to the coach who wrote the
 * programme. `planConflict` decides whether there is one; this only says it in
 * the right voice, and says it as something to raise rather than something to
 * fix here — nothing on this screen writes to either side.
 */
export function coachConflictLine(
  conflict: PlanConflict,
  type: PlannedDayType,
  who: string,
): string {
  const label = DAY_TYPE_LABEL[type].toLowerCase();
  return conflict.kind === 'plan-schedules-a-session'
    ? `Your programme puts ${conflict.focus} on this day and ${who} has marked it a ${label}. Worth agreeing which one stands before the day arrives.`
    : `${who} has marked this a training day and your programme schedules nothing on it. Their mark doesn’t add a session to the programme — it says what they intend to do.`;
}

/**
 * Why no day on this screen is being compared against a programme, or null when
 * they are. Said out loud because a screen showing no conflicts looks identical
 * whether it checked and found none or never checked at all.
 */
export function programmeCaveat(known: boolean, who: string): string | null {
  return known
    ? null
    : `No programme of yours is assigned to ${who} that this app can read, so nothing below has been checked against one. That is not the same as their week agreeing with it.`;
}

/** The client's own words on a day, or null. Where a travel day and a refeed
 *  live until the app can act on either — which makes the note the only place
 *  the reason for a marked day is ever written down. */
export function planNote(day: CoachPlanDay): string | null {
  const n = (day.plan.note ?? '').trim();
  return n || null;
}
