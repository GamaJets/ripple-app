// Coach · blocking more than one day at a time.
//
// ── What was there ────────────────────────────────────────────────────────
//
// `doBlock` in app/(trainer)/calendar.tsx blocks ONE day, or one hour range
// inside one day, per confirmation. That is the whole of it. A coach going away
// for a fortnight taps through fourteen sheets; a coach who never works Sunday
// blocks this Sunday and then remembers again next week, or does not.
//
// ── Why this is not the calendar-sync item ────────────────────────────────
//
// The roadmap's S6 is "let a coach block time from the phone's own calendar",
// and that is NOT what this is. Reading the device calendar needs
// `expo-calendar`, which is not a dependency of this project — so it is a new
// native module and therefore a new binary, which is exactly the objection that
// took two-way calendar sync (S3) off this wave. OTA carries JavaScript only.
//
// What is actually painful about blocking time is not that the phone knows and
// the app does not. It is that the app makes a coach do it fourteen times. That
// half ships today and needs nothing new.
//
// ── THE RULE THIS MODULE HOLDS ────────────────────────────────────────────
//
// A PARTIAL SUCCESS IS NOT A SUCCESS AND IT IS NOT A FAILURE.
//
// `block_time` refuses a day that already has a session booked in it — rightly:
// somebody arranged to be there, so the coach cancels it themselves, which
// tells the client. Over fourteen days that refusal will fire for some days and
// not others, and the two sentences a coach must never be shown are "blocked"
// (when four days are still open and bookable) and "not blocked" (when ten days
// were). Both are the app describing a diary that is not the diary.
//
// So every call's outcome is kept, and `summariseBlocks` names what happened to
// each kind. A coach who reads "10 blocked, 4 not — you have sessions booked on
// those" knows exactly what is left to do; nothing else does.
import { fmtPointDay } from './format';
import { dateParts, localDate } from './localDate';

/** How many days ahead a single range may cover. Sixty is a long holiday and
 *  well short of anything that would take minutes to write; it is a guard
 *  against a slip on a picker rather than a policy about time off. */
export const MAX_BLOCK_DAYS = 60;

/** How many weeks a weekly repeat may run for. Thirteen is a term, which is the
 *  unit coaches actually think in — and past that a standing arrangement is
 *  better expressed by not offering the hours at all. */
export const MAX_BLOCK_WEEKS = 13;

/** What the coach asked for. */
export interface BlockPlan {
  /** The first day, as a local `YYYY-MM-DD`. */
  from: string;
  /** How many consecutive days, including the first. 1 is the old behaviour. */
  days: number;
  /** How many times the whole run repeats, a week apart. 1 is "just once". */
  repeatWeeks: number;
}

/**
 * The local dates a plan covers, oldest first, with no duplicates.
 *
 * Built by adding to the DAY-OF-MONTH rather than by adding milliseconds. Those
 * are not the same thing twice a year: adding 86,400,000ms across a daylight
 * saving change lands at 23:00 or 01:00 the previous or next day, and a coach
 * who blocked their holiday in March would find one day of it missing and
 * another blocked twice. `setDate` moves calendar days and is correct on both
 * boundaries.
 *
 * Returns an empty array for anything outside the guards rather than clamping.
 * Clamping would block a period the coach never asked for, and the thing being
 * blocked is time clients cannot book — the failure is invisible until somebody
 * cannot get an appointment.
 */
export function blockDates(plan: BlockPlan): string[] {
  // `localDate` and not `new Date(y, m - 1, d)`: `dateParts` returns a MONTH
  // INDEX, 0-11, and the subtraction that looks right beside a `YYYY-MM-DD`
  // string moves every range a month into the past. src/lib/localDate.ts exists
  // because this app has already shipped two off-by-one date bugs that were
  // invisible to their author, and reusing its constructor is how a third is
  // avoided rather than found later.
  const start = localDate(plan.from);
  if (!start) return [];
  if (!Number.isInteger(plan.days) || plan.days < 1 || plan.days > MAX_BLOCK_DAYS) return [];
  if (!Number.isInteger(plan.repeatWeeks) || plan.repeatWeeks < 1 || plan.repeatWeeks > MAX_BLOCK_WEEKS) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (let w = 0; w < plan.repeatWeeks; w++) {
    for (let i = 0; i < plan.days; i++) {
      const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      dt.setDate(dt.getDate() + w * 7 + i);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      // A run longer than a week overlaps its own repeat. Blocking the same day
      // twice is not harmful — the server answers 'already-blocked' — but it
      // costs a round trip per duplicate and makes the tally a coach reads
      // ("14 blocked") a number about calls rather than about days.
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  out.sort();
  return out;
}

/** What the server said about one day. The four outcomes `block_time` and its
 *  caller can actually produce, kept apart because three of them mean
 *  different things to the coach and only one is a fault. */
export type BlockOutcome =
  /** Blocked. */
  | 'blocked'
  /** Refused: a session is booked in that period. Not a fault — somebody
   *  arranged to be there, and cancelling it is the coach's to do because it
   *  tells the client. */
  | 'booked'
  /** Refused: time overlapping this is already blocked. Also not a fault, and
   *  the outcome most of a repeat produces on its second run. */
  | 'already-blocked'
  /** The call did not land. The ONLY one of the four that means "this day may
   *  still be bookable and you should try again". */
  | 'failed';

export interface BlockResult {
  /** Local `YYYY-MM-DD`. */
  day: string;
  outcome: BlockOutcome;
  /** Open slots the server withdrew. Zero on anything but 'blocked'. */
  withdrawn: number;
}

export interface BlockSummary {
  blocked: number;
  booked: string[];
  already: number;
  failed: string[];
  withdrawn: number;
  /** True when at least one day is not blocked for a reason the coach has to do
   *  something about — a booked session, or a call that did not land. */
  needsAttention: boolean;
}

export function summariseBlocks(results: readonly BlockResult[]): BlockSummary {
  const booked = results.filter((r) => r.outcome === 'booked').map((r) => r.day);
  const failed = results.filter((r) => r.outcome === 'failed').map((r) => r.day);
  return {
    blocked: results.filter((r) => r.outcome === 'blocked').length,
    booked,
    already: results.filter((r) => r.outcome === 'already-blocked').length,
    failed,
    withdrawn: results.reduce((n, r) => n + (r.withdrawn || 0), 0),
    needsAttention: booked.length > 0 || failed.length > 0,
  };
}

/** A day as a coach reads one: "12 Aug 2026". Local, via `dateParts`, so a bare
 *  date is not pulled a day backwards west of Greenwich. */
function readable(day: string): string {
  const p = dateParts(day);
  return p ? fmtPointDay(p[0], p[1], p[2]) : day;
}

const list = (days: readonly string[]): string => {
  const shown = days.slice(0, 4).map(readable);
  const rest = days.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
};

/**
 * What to tell the coach afterwards, in one paragraph.
 *
 * Every clause is about days rather than about calls, and the two refusals are
 * named separately because only one of them needs the coach to do anything. The
 * paragraph never opens with "Blocked" when something was not: a coach skimming
 * an alert takes the shape of it and not the words, and the shape has to match
 * the diary.
 */
export function blockSummaryLine(s: BlockSummary): string {
  const parts: string[] = [];
  parts.push(s.blocked === 0
    ? 'Nothing was blocked.'
    : `${s.blocked} day${s.blocked === 1 ? '' : 's'} blocked — nobody can book across ${s.blocked === 1 ? 'it' : 'them'}.`);
  if (s.withdrawn > 0) {
    parts.push(`${s.withdrawn} open slot${s.withdrawn === 1 ? ' was' : 's were'} withdrawn.`);
  }
  if (s.already > 0) {
    parts.push(`${s.already} ${s.already === 1 ? 'was' : 'were'} already covered by time you had blocked before, so ${s.already === 1 ? 'it was' : 'they were'} left alone.`);
  }
  if (s.booked.length > 0) {
    parts.push(`${s.booked.length} could not be blocked because you have a session booked: ${list(s.booked)}. Cancel those yourself — that tells the client — and then block the day.`);
  }
  if (s.failed.length > 0) {
    parts.push(`${s.failed.length} did not save at all, so ${s.failed.length === 1 ? 'that day is' : 'those days are'} still bookable: ${list(s.failed)}. Try again once you have signal.`);
  }
  return parts.join(' ');
}

/** The label on the confirm button, so the coach reads what they are about to
 *  do rather than a generic verb. Null when the plan covers nothing, which is
 *  the caller's cue to disable it. */
export function blockPlanLabel(plan: BlockPlan): string | null {
  const days = blockDates(plan);
  if (days.length === 0) return null;
  if (days.length === 1) return 'Block This Day';
  return `Block ${days.length} Days`;
}
