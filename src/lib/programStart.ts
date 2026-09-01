/**
 * "THIS STARTS MONDAY" — and the honest limits of saying it in this app.
 *
 * ── What a coach does today ───────────────────────────────────────────────
 *
 * `assignProgramTo` writes an `assigned_programs` row and the client's Train
 * tab reads it on the next render. There is no date anywhere in that path. So a
 * coach who writes next week's block on a Thursday afternoon has exactly two
 * options: replace their client's Friday session with week one of a block that
 * has not begun, or sit on their phone on Sunday night and tap Assign at the
 * right moment. Coaches do the second one. That is the app making a
 * self-employed person set an alarm to do a database write.
 *
 * ── What this file can honestly do, and what it cannot ────────────────────
 *
 * It stores the date the coach chose and it does the arithmetic the COACH's
 * screens need from it: has the block started, which week of it is this person
 * standing in, has it run out. All of that is real and all of it is on the
 * coach's side of the app.
 *
 * IT DOES NOT CHANGE WHAT THE CLIENT SEES. The client's "today's session" is
 * decided in `app/(client)/workouts.tsx` and `app/(client)/week.tsx` — a modulo
 * over the programme's days in one and an exact weekday match in the other —
 * and neither of them reads a start date, because neither of them has been
 * taught to. So the moment a programme lands on a client's row it is what they
 * are training, start date or no start date. That is the truth today and every
 * screen that shows a start date says it in as many words: `CLIENT_STARTS_NOW`
 * below is the sentence, written once so that the day the client app is taught
 * about start dates there is exactly one string to delete and one grep that
 * finds every place that promised otherwise.
 *
 * Saying it plainly is not a consolation prize. A coach who believes the date
 * is enforced and assigns a block "starting Monday" on a Thursday has just
 * replaced their client's Friday session, silently, believing they did not.
 * That is strictly worse than the Sunday night alarm.
 *
 * ── Whose Monday ──────────────────────────────────────────────────────────
 *
 * The COACH's, and the same argument `app/(trainer)/client-week.tsx` makes at
 * length applies unchanged: there is no client timezone column anywhere in this
 * schema, `workouts.performed_at` is an instant, and a day boundary that had to
 * be guessed would be guessed wrong for hours a day for every coach and client
 * in different zones. `starts_on` is a bare DATE — no time, no offset — because
 * a date with an offset would be claiming an accuracy the app does not have. It
 * is the day the coach wrote on the plan, and both of them read it as a date.
 *
 * The consequence is stated rather than hidden: for a few hours a day a coach
 * in Dubai and a client in Los Angeles disagree about which day today is, so a
 * block can read as "week 2" for one of them and "week 1" for the other. No
 * figure anywhere is computed from that boundary except the week number itself,
 * and the week number is always shown with the start date beside it.
 *
 * Pure and framework-free, so it runs under the three timezones the repo tests.
 */
import { compareIsoDays, isoToday } from './dayPlan';
import { dateParts } from './localDate';

/** Milliseconds in a day, used only for whole-day arithmetic against local
 *  midnights. Never for a duration — see `daysBetween`. */
const DAY_MS = 86_400_000;

/**
 * Whole calendar days from `from` to `to`, or null when either is unreadable.
 *
 * Built from local midnights and then ROUNDED, which is the part that matters.
 * `new Date(y, m, d)` is local midnight, and two local midnights either side of
 * a daylight-saving change are 23 or 25 hours apart — so a plain division
 * hands back 6.958333 for a week that ends on the clocks going forward, and
 * `Math.floor` of that is 6. A block would silently gain a day twice a year, in
 * March and October, for every coach in a country that changes its clocks.
 * Rounding is correct because the true answer is always an integer and the
 * error is always under an hour in a day.
 */
export function daysBetween(fromISO: string | null | undefined, toISO: string | null | undefined): number | null {
  const a = dateParts(fromISO ?? '');
  const b = dateParts(toISO ?? '');
  if (!a || !b) return null;
  const ms = new Date(b[0], b[1], b[2]).getTime() - new Date(a[0], a[1], a[2]).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / DAY_MS);
}

/**
 * Where a client is standing in a block.
 *
 *   'no-date'   the assignment carries no start date. Every assignment made
 *               before this feature existed is this, and so is every one a
 *               coach makes without choosing a date — which stays the default,
 *               because "assign it now" is what the control has always meant.
 *   'unreadable' a date is stored that this build cannot parse. Reported as its
 *               own state rather than folded into 'no-date': one is the coach
 *               not having said and the other is the app not having understood,
 *               and only the second is a bug worth a coach telling somebody
 *               about.
 *   'before'    the block starts in the future. Which is where the honesty
 *               matters most — the client is ALREADY training week one.
 *   'during'    the block is running and `week` says which one.
 *   'after'     the block's last week has passed. Not an error and not
 *               "finished": nothing in this app knows whether they did it. It
 *               is a prompt to write the next block.
 */
export type BlockPhase = 'no-date' | 'unreadable' | 'before' | 'during' | 'after';

export interface BlockPosition {
  phase: BlockPhase;
  /** Which week of the block, 1-based, under 'during'. Null under every other
   *  phase — a week number for a block that has not started is a number nobody
   *  can act on, and null is what stops a screen printing "Week 0". */
  week: number | null;
  /** How many weeks the block is. Carried so a screen can say "week 3 of 8"
   *  without asking a second module and getting a different answer. */
  weeks: number;
  /** Whole days from the start date to today. Negative before it starts. Null
   *  when there is no readable date. Raw, for a screen to phrase. */
  dayOffset: number | null;
}

/**
 * Which week of the block today falls in.
 *
 * `weeks` is the block's own length from `weekCount` in src/lib/programBlock.ts,
 * and a value below one is treated as one: a programme always has at least the
 * week its `days` describe, and a zero here would make every block read 'after'
 * on the day it started.
 *
 * The week runs from the START DATE, not from Monday. A block that begins on a
 * Wednesday has its week one running Wednesday to Tuesday, and that is right:
 * the coach chose the day, and re-anchoring to the calendar week would put the
 * client in week two after five days. `app/(client)/week.tsx` renders a
 * Monday-first calendar and is a different question — what is on each named
 * day — which is unaffected either way.
 */
export function blockPosition(
  startsOn: string | null | undefined,
  todayISO: string,
  weeks: number,
): BlockPosition {
  const n = Number.isFinite(weeks) && weeks >= 1 ? Math.floor(weeks) : 1;
  if (startsOn == null || String(startsOn).trim() === '') {
    return { phase: 'no-date', week: null, weeks: n, dayOffset: null };
  }
  const offset = daysBetween(startsOn, todayISO);
  if (offset == null) return { phase: 'unreadable', week: null, weeks: n, dayOffset: null };
  if (offset < 0) return { phase: 'before', week: null, weeks: n, dayOffset: offset };
  const week = Math.floor(offset / 7) + 1;
  if (week > n) return { phase: 'after', week: null, weeks: n, dayOffset: offset };
  return { phase: 'during', week, weeks: n, dayOffset: offset };
}

/** `blockPosition` against the device's own clock. Separated so every test can
 *  pass a fixed today and nothing in this file reads a clock it was not given. */
export function blockPositionNow(
  startsOn: string | null | undefined,
  weeks: number,
  now: Date = new Date(),
): BlockPosition {
  return blockPosition(startsOn, isoToday(now), weeks);
}

/**
 * The line a coach reads, in sentence case.
 *
 * Every branch is a different fact and none of them is a count over something
 * unread — the only input is a date the coach typed and a clock, both of which
 * are certain. The 'before' branch is the one that carries the warning, because
 * it is the one where a coach's belief and the app's behaviour part company.
 */
export function blockPositionLine(pos: BlockPosition, startsOn: string | null | undefined, who: string): string {
  switch (pos.phase) {
    case 'no-date':
      return `No start date on this assignment, so it began the moment it was sent — which is how every assignment in this app has always worked.`;
    case 'unreadable':
      return `A start date is stored against this assignment and this build cannot read it, so there is no week number to give. What ${who} is training is unaffected.`;
    case 'before': {
      const days = pos.dayOffset == null ? null : Math.abs(pos.dayOffset);
      const when = days === 1 ? 'tomorrow' : days == null ? `on ${startsOn}` : `in ${days} days`;
      return `You wrote this block to start ${when}. ${who} is training week one of it already — the date is your record of the plan, and their Train tab does not wait for it.`;
    }
    case 'during':
      return pos.weeks > 1
        ? `Week ${pos.week} of ${pos.weeks}, counted from the ${startsOn} you set.`
        : `Started ${startsOn}. This programme is one week long, so there is no week to count.`;
    case 'after':
      return `This block ran ${pos.weeks} week${pos.weeks === 1 ? '' : 's'} from ${startsOn} and its last week has passed. Nothing here says whether ${who} did it — that is what their logged training answers.`;
  }
}

/**
 * THE SENTENCE. What a start date does and does not do, said to the coach.
 *
 * A constant rather than a phrase composed at four call sites, for the reason
 * given at the top of this file: when the client app learns to honour a start
 * date, this string is deleted and the compiler finds every screen that was
 * making the promise. A sentence assembled inline at each screen would leave
 * three of them still saying it a year later.
 */
export const CLIENT_STARTS_NOW =
  'A start date is your own record of when the block begins. It does not hold the programme back: '
  + "the client's Train tab shows whatever is on their assignment from the moment it is saved, so assigning "
  + 'a future block mid-week replaces this week as well.';

/**
 * Whether a date is one this app will store as a start date.
 *
 * Refused, not corrected, and there is deliberately no upper bound: a coach
 * writing a block that starts in four months is planning a season, which is
 * ordinary. The lower bound is not "today" either — a coach recording that a
 * block began last Monday is recording something true, and refusing it would
 * force them to lie about it or leave it blank.
 *
 * What IS refused is a string that is not a calendar date, because the whole of
 * `blockPosition` is arithmetic on it and a stored value that cannot be parsed
 * puts every assignment carrying it into 'unreadable' forever.
 */
export function isStartDate(v: string | null | undefined): boolean {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const p = dateParts(s);
  if (!p) return false;
  // Round-tripped, so '2026-02-30' is refused rather than rolling forward into
  // March. `new Date(2026, 1, 30)` is the 2nd of March and would be stored as a
  // start date the coach never chose, on a plan they printed.
  const d = new Date(p[0], p[1], p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] && d.getDate() === p[2];
}

/**
 * Whether one start date is later than another, for ordering a client's blocks.
 *
 * Thin, and it exists so that no screen writes its own string comparison over
 * dates. `YYYY-MM-DD` does sort lexically and every one of the four places that
 * has relied on that in this codebase was correct — until one of them was
 * handed a value with a time on the end. `compareIsoDays` parses.
 */
export function laterStart(a: string | null | undefined, b: string | null | undefined): boolean {
  const c = compareIsoDays(String(a ?? ''), String(b ?? ''));
  return c != null && c > 0;
}
