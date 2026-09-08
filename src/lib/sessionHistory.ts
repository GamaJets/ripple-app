// What became of a session that has already happened, and how far back the
// screen showing it can honestly claim to see.
//
// ── The two questions this module answers ──────────────────────────────────
//
// Every app in this repo could show the week ahead and none of them could show
// the week behind. The client calendar pages backwards but draws its months out
// of one capped read and says nothing when it runs off the end of it; the
// client's Personal Training screen listed past sessions by APPROVAL state
// only, so a session the coach marked as a no-show and a session nobody has
// marked at all were the same row; the coach's Mark Sessions screen is a queue
// of the unmarked and empties itself as the coach works, which is the opposite
// of a record; and the Studio's session page read a fixed thirty days with no
// way to ask for the thirty before them.
//
// So there are two questions, and they are separate:
//
//   1. WHAT HAPPENED to this session. `sessions.outcome` is the answer
//      (33-session-outcomes.sql) and `pastVerdict` below is the one place that
//      reads it. Null is not "nothing happened" — it is nobody having said, and
//      src/lib/gymSessions.ts already calls that "still needs an outcome
//      recorded" and already refuses to price payroll while any exist. The same
//      words are used here rather than a second vocabulary for one state.
//
//   2. HOW FAR BACK the read reached. A history assembled from a capped read
//      has an edge, and past that edge the screen knows nothing. Drawing an
//      empty March because the read stopped in April is the same lie as
//      drawing an empty March because the member did not train — and it is the
//      lie src/lib/historyWindow.ts was written for one screen at a time.
//      `readBoundary` and `monthCoverage` are that rule, generalised.
//
// ── The disagreement is shown, never resolved ──────────────────────────────
//
// A session can be marked 'completed' by the coach and DISPUTED by the client
// at the same time. Those are two different people saying two different things
// and neither of them is this module's to overrule:
//
//   · src/lib/sessionDispute.ts is explicit that a dispute writes to
//     `session_approvals` and to nothing else, precisely so that a member
//     cannot decide from a phone what a coach is paid.
//   · src/lib/gymSessions.ts computes payroll from `outcome` and would be
//     wrong to read an objection as an outcome.
//
// So `pastVerdict` returns the outcome AND the dispute, side by side, and every
// screen renders both. This is the same rule the client calendar already
// applies to a planned day that disagrees with the coach's program: the
// disagreement is SHOWN and neither side is edited.
//
// ── A cancelled session stays in the history ───────────────────────────────
//
// supabase/parts/195 is the argument, made about classes: deleting a cancelled
// class destroys the evidence that it was wanted and quietly improves the
// month's fill rate. The same holds one row down. `pastSessions` therefore
// keeps 'cancelled' and 'late_cancelled' rows, and keeps them apart from each
// other, because gyms pay for one and not the other and collapsing them here
// would decide a payroll question that belongs to the gym.
//
// KNOWN GAP, stated because a screen has to say it out loud: when a CLIENT
// cancels their own booking, `cancel_my_session` (supabase/parts/126) frees the
// slot by setting `status = 'available'` and `client_id = null`. That row is
// then no longer the member's in any readable sense, so it cannot appear in
// their history at all. Nothing in this module can recover it, and no screen
// built on this module may imply that a member's own cancellations are listed.
// `CLIENT_CANCELLED_GAP_NOTE` is the sentence that says so.
//
// THE GAP IS STILL HERE AND IS NO LONGER THE END OF THE STORY. The session row
// is unrecoverable, but the CANCELLATION is recorded in its own table —
// `public.session_cancellations`, written by a trigger since supabase/parts/380
// — and src/lib/sessionCancellations.ts reads it. So the sentence below now
// points at that list instead of only at a late fee on a receipt. What it must
// never do is drop the admission: these rows, the ones this module produces,
// still do not contain a member's own cancellations, and a reader of a list
// built from `sessions` is entitled to be told so.
import type { LoadStatus } from '../ui/loadStatus';
import { dateParts } from './localDate';

/* ── 1. what became of it ──────────────────────────────────────────────────── */

/**
 * What the record says happened to a session whose time has passed.
 *
 * Five states, not four. 'cancelled' and 'late_cancelled' are the two values
 * `sessions.outcome` already distinguishes and `isPayable` already treats
 * differently; folding them together to make a tidier list would move money.
 *
 * 'unmarked' is a state in its own right and never a synonym for either
 * 'delivered' or 'cancelled'. It is the state src/lib/gymSessions.ts blocks a
 * payroll settlement on.
 */
export type PastState = 'delivered' | 'missed' | 'cancelled' | 'late_cancelled' | 'unmarked';

/** The order a person reads them in, best-known first. Used for tallies. */
export const PAST_STATES: readonly PastState[] =
  ['delivered', 'missed', 'late_cancelled', 'cancelled', 'unmarked'] as const;

/** Short label for a chip or a row. Sentence case: these sit inside prose. */
export const PAST_STATE_LABEL: Record<PastState, string> = {
  delivered: 'delivered',
  missed: 'not attended',
  late_cancelled: 'cancelled late',
  cancelled: 'cancelled',
  unmarked: 'not yet marked',
};

/**
 * The full sentence for a state, for the line under a row.
 *
 * 'unmarked' borrows gymSessions' own wording rather than inventing a second
 * one — a coach who reads "still needs an outcome recorded" here and on the
 * payroll blocker is reading about the same thing.
 */
export const PAST_STATE_NOTE: Record<PastState, string> = {
  delivered: 'Recorded as delivered.',
  missed: 'Recorded as not attended.',
  late_cancelled: 'Cancelled inside the notice period.',
  cancelled: 'Cancelled with notice.',
  unmarked: 'This session still needs an outcome recorded, so what happened is not established.',
};

/** The minimum a row needs for this module to reason about it. */
export interface HistoryRow {
  startsAt: string;
  durationMin?: number | null;
  /** The SLOT state — available, booked, blocked. Never the delivery result. */
  status?: string | null;
  /** `sessions.outcome`. Null means nobody has said. */
  outcome?: string | null;
  outcomeAt?: string | null;
  /** From `session_approvals`, where the client app carries it. */
  approvalState?: string | null;
  disputedAt?: string | null;
}

/** What the record says, and what the client says, kept apart. */
export interface PastVerdict {
  state: PastState;
  /** When the outcome was recorded. Null while unmarked, and null on an older
   *  row whose `outcome_at` was never written — which is not the same as the
   *  session having no outcome, so the two are never conflated. */
  at: string | null;
  /** The client has objected to this session. Independent of `state`: a
   *  disputed session that the coach marked delivered is BOTH, and both show. */
  disputed: boolean;
  disputedAt: string | null;
}

/**
 * Whether this session's time has passed.
 *
 * Its END, not its start. A session in progress is not history, and putting the
 * hour somebody is standing in into a list headed "what already happened" is
 * how a coach comes to mark an outcome for a session they are still delivering.
 * A missing or unreadable duration falls back to nothing rather than to a
 * guessed hour: the start alone is the only instant we actually know.
 */
export function hasEnded(row: HistoryRow, now: number = Date.now()): boolean {
  const start = Date.parse(row.startsAt);
  if (!Number.isFinite(start)) return false;
  const mins = typeof row.durationMin === 'number' && Number.isFinite(row.durationMin)
    ? Math.max(0, row.durationMin) : 0;
  return start + mins * 60_000 <= now;
}

/**
 * Whether this row is a session at all, as opposed to an hour nobody booked.
 *
 * An `available` slot that has gone by is not a session that happened and must
 * never be counted as one — that inference is the whole reason
 * 33-session-outcomes.sql exists. A row carrying an outcome is kept whatever
 * its slot state, because recording an outcome is somebody stating that this
 * was a real session.
 */
export function wasBooked(row: HistoryRow): boolean {
  return row.status === 'booked' || (row.outcome != null && row.outcome !== '');
}

/**
 * What became of one session.
 *
 * An `outcome` value this build has never heard of reads as 'unmarked', not as
 * delivered. A value added to the check constraint later must not silently
 * arrive on somebody's screen as work they were paid for; unmarked is the state
 * that asks a human to look, which is the correct answer to "we do not know
 * what this is".
 */
export function pastVerdict(row: HistoryRow): PastVerdict {
  const disputed = row.approvalState === 'disputed';
  const disputedAt = disputed ? (row.disputedAt ?? null) : null;
  let state: PastState;
  switch (row.outcome) {
    case 'completed': state = 'delivered'; break;
    case 'no_show': state = 'missed'; break;
    case 'cancelled': state = 'cancelled'; break;
    case 'late_cancelled': state = 'late_cancelled'; break;
    default: state = 'unmarked'; break;
  }
  return {
    state,
    at: state === 'unmarked' ? null : (row.outcomeAt ?? null),
    disputed,
    disputedAt,
  };
}

/**
 * The sessions that have already happened, newest first.
 *
 * Cancelled and disputed rows are in. Open slots and blocked time are out —
 * they are not sessions. The sort is total: `startsAt` then whatever secondary
 * key the caller's rows carry is not available here, so ties fall back to the
 * order they arrived in, which is stable in every JS engine this runs on.
 */
export function pastSessions<T extends HistoryRow>(rows: T[], now: number = Date.now()): T[] {
  return rows
    .filter((r) => wasBooked(r) && hasEnded(r, now))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
}

/** How many of each state, plus how many the client has objected to. */
export interface PastTally {
  delivered: number;
  missed: number;
  cancelled: number;
  late_cancelled: number;
  unmarked: number;
  disputed: number;
  total: number;
}

/**
 * Count the states in a list of past sessions.
 *
 * A COUNT over a truncated read is a figure computed from an unknown fraction
 * of the set, which src/ui/loadStatus.ts forbids under 'partial'. This function
 * does not know the status, so it does not guard — the caller does, and every
 * caller here gates on `isWhole` before printing any of these numbers.
 */
export function tallyPast(rows: HistoryRow[], now: number = Date.now()): PastTally {
  const t: PastTally = {
    delivered: 0, missed: 0, cancelled: 0, late_cancelled: 0, unmarked: 0, disputed: 0, total: 0,
  };
  for (const r of pastSessions(rows, now)) {
    const v = pastVerdict(r);
    t[v.state] += 1;
    if (v.disputed) t.disputed += 1;
    t.total += 1;
  }
  return t;
}

/**
 * Said on every client-facing history, because it cannot be worked around in
 * code: a booking the member cancelled themselves is not in THESE rows.
 *
 * It now names where they are instead. The sentence used to end at the late fee
 * on a receipt, which was the only surviving trace this module knew about; the
 * cancellation itself has its own record (see the header) and a note that
 * stopped short of saying so would send somebody looking for their own history
 * to a screen that has never had it.
 */
export const CLIENT_CANCELLED_GAP_NOTE =
  'A session you cancelled yourself is not listed here. Cancelling hands the hour back to your coach, '
  + 'so the booking stops being yours — it is under Sessions You Cancelled, below. Where a late fee was '
  + 'recorded it is on your receipts.';

/* ── 2. how far back the read reached ──────────────────────────────────────── */

/**
 * The oldest instant a read actually covers, and whether anything older was
 * simply never asked for.
 *
 * `truncated` is `capped().truncated` from src/lib/rowCap.ts — true when the
 * set was larger than the cap and what came back is a prefix of it. On a
 * newest-first read that prefix is the RECENT end, so the cut is at the far
 * end of the person's history and `oldestISO` is exactly where the screen's
 * knowledge stops.
 *
 * A read that was NOT truncated is whole: `bounded` is false and the screen may
 * say an empty month was empty. This must stay a no-op for everybody under the
 * cap, for the same reason `wholeMonths` must — a boundary announced to every
 * member with forty sessions on file would be noise that teaches people to
 * ignore the one case it matters in.
 */
export interface ReadBoundary {
  /** ISO of the oldest row the read reached, or null when no rows came back. */
  oldestISO: string | null;
  /** True when older rows exist and were not read. */
  bounded: boolean;
}

export function readBoundary(rows: { startsAt: string }[], truncated: boolean): ReadBoundary {
  let oldest: number | null = null;
  let oldestISO: string | null = null;
  for (const r of rows) {
    const t = Date.parse(r.startsAt);
    if (!Number.isFinite(t)) continue;
    if (oldest == null || t < oldest) { oldest = t; oldestISO = r.startsAt; }
  }
  // Truncated with nothing readable in it is not a boundary anybody can name.
  // Claiming one would put a date on screen that came from nowhere.
  return { oldestISO, bounded: truncated && oldestISO != null };
}

/**
 * How much of a given calendar month the screen actually knows about.
 *
 *   'covered' — the whole month is inside the read. An empty one is empty.
 *   'edge'    — the read starts PART-WAY THROUGH this month. Days before the
 *               boundary were never read, so the month is not empty, it is
 *               half-known. This is the case src/lib/historyWindow.ts handles
 *               by dropping the month from a CHART, which is right there and
 *               wrong here: a calendar cannot hide a month, so it says which
 *               day it is complete from instead.
 *   'beyond'  — the whole month is older than anything read. Nothing is known.
 *   'unknown' — the read has not finished, or it failed. An empty month under
 *               'error' is the single worst thing this whole job can render,
 *               so it gets its own answer rather than falling through to
 *               'covered'.
 *
 * The month is LOCAL. `year`/`monthIndex` are what `dateParts` returns —
 * monthIndex is 0-11 — and the boundaries are built with the local Date
 * constructor, because "a past month" means a run of days in the reader's own
 * life. Reading them as UTC puts the first and last day of every month on the
 * wrong side of the edge in half the world.
 */
export type MonthCoverage = 'covered' | 'edge' | 'beyond' | 'unknown';

export function monthCoverage(
  year: number,
  monthIndex: number,
  boundary: ReadBoundary,
  status: LoadStatus,
): MonthCoverage {
  // whole-ok: 'partial' is the entire reason this function exists, and it
  // arrives through `boundary` rather than through `status`. `readBoundary` is
  // built with `truncated`, so under a truncated read `boundary.bounded` is true
  // and carries the oldest day that actually came back — which is what turns
  // this month into 'edge' or 'beyond' rather than 'covered'. That is a strictly
  // better answer than `isWhole` could give: a member whose read was capped in
  // 2023 still gets a truthful 'covered' for last month, and only the months the
  // truncation genuinely reached are marked. 'loading' and 'error' have no
  // boundary to reason from at all, which is why they and only they stop here.
  if (status === 'loading' || status === 'error') return 'unknown';
  if (!boundary.bounded || boundary.oldestISO == null) return 'covered';
  const oldest = Date.parse(boundary.oldestISO);
  if (!Number.isFinite(oldest)) return 'covered';
  const monthStart = new Date(year, monthIndex, 1, 0, 0, 0, 0).getTime();
  const nextMonth = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0).getTime();
  if (oldest <= monthStart) return 'covered';
  if (oldest >= nextMonth) return 'beyond';
  return 'edge';
}

/** The same question for an arbitrary run of local days — a week, a fortnight.
 *  `fromISO`/`toISO` are half-open at the end, like `weekWindow` in
 *  src/lib/gymRota.ts, so a Sunday-night session is inside its own week and a
 *  Monday-morning one is not counted in two. */
export function rangeCoverage(
  fromMs: number,
  toMs: number,
  boundary: ReadBoundary,
  status: LoadStatus,
): MonthCoverage {
  // whole-ok: the same trade as `monthCoverage` above, for an arbitrary run of
  // days instead of a calendar month, and it matters more here because the runs
  // asked about are short. A week or a fortnight sits at the newest end of the
  // read, and `capped()` keeps the newest rows — so under a truncated read the
  // honest answer for almost every window this is called with is 'covered', and
  // `boundary.oldestISO` is what proves it rather than assumes it. Refusing on
  // 'partial' would mark a fully-read week as half-known for every member with
  // more than a thousand sessions behind them.
  if (status === 'loading' || status === 'error') return 'unknown';
  if (!boundary.bounded || boundary.oldestISO == null) return 'covered';
  const oldest = Date.parse(boundary.oldestISO);
  if (!Number.isFinite(oldest)) return 'covered';
  if (oldest <= fromMs) return 'covered';
  if (oldest >= toMs) return 'beyond';
  return 'edge';
}

/**
 * What the screen says about a month it cannot fully see, or null when there is
 * nothing to say.
 *
 * Null for 'covered' deliberately: a note on every month is a note nobody
 * reads. The three that are not covered each get a different sentence, because
 * "we have not read that far" and "we could not read it" are different problems
 * with different next steps, and a single "something is missing" leaves the
 * reader unable to tell which.
 *
 * `dayLabel` is the caller's formatter for the boundary date — this module
 * never formats a date, because every locale decision in this repo goes through
 * `appLocale()` and a library that hardcodes one is how `check:locale` earns
 * its keep.
 */
export function monthCoverageNote(
  coverage: MonthCoverage,
  boundary: ReadBoundary,
  dayLabel: (iso: string) => string,
): string | null {
  switch (coverage) {
    case 'covered':
      return null;
    case 'unknown':
      // True whether the grid is blank or showing a cached copy, because both
      // happen here: 'unknown' covers the read still being in flight AND the
      // read having failed, and a failed read leaves whatever this device had
      // before it on screen. "This month is blank" would be false in the second
      // case and the sentence would read as a rendering fault.
      return 'This month has not been read, so anything shown for it may be out of date and anything missing '
        + 'may simply not have loaded. It is not a statement that nothing happened. Pull down to try again.';
    // These two say what is MISSING rather than that the month is blank. A
    // calendar draws more than one thing — logged workouts come from a
    // different read entirely — so "this month is blank" can be false on the
    // very screen this sentence appears on, and a false sentence beside a grid
    // reads as a rendering fault rather than as missing data.
    case 'beyond':
      return boundary.oldestISO
        ? `No sessions have been read for this month. Your record is loaded back to ${dayLabel(boundary.oldestISO)} `
          + 'and no further, so anything before that is missing from this screen rather than absent from your record.'
        : 'No sessions have been read for this month, so anything in it is missing from this screen rather than '
          + 'absent from your record.';
    case 'edge':
      return boundary.oldestISO
        ? `Only part of this month has been read. Sessions are loaded from ${dayLabel(boundary.oldestISO)} onwards; `
          + 'anything earlier in the month is missing from this screen rather than absent from your record.'
        : 'Only part of this month has been read, so days earlier in it may be missing from this screen.';
  }
}

/**
 * The one line an empty history is allowed to print.
 *
 * This is the single most important function in the module and it exists
 * because `[]` means four different things. Modelled on `emptyBookingsLine` in
 * src/lib/bookingsRead.ts, which made the same argument about the same screen's
 * upcoming half — a member whose read was refused was told their own record was
 * empty, in the past tense, as a fact about their life.
 *
 * Under 'partial' the list has rows by definition, so an empty one under
 * 'partial' can only mean the rows that came back all fell outside the filter —
 * and the ones that did not come back may not have. It is still not "nothing".
 */
export function emptyHistoryLine(status: LoadStatus, what: string = 'sessions'): string {
  switch (status) {
    case 'loading':
      return `Still reading your ${what}.`;
    case 'error':
      return `We could not read your ${what}, so this is not a record of nothing happening — `
        + 'it is a read that failed. Pull down to try again.';
    case 'partial':
      return `Only part of your ${what} could be read, and none of that part is here. `
        + 'There may be more on the server that this screen has not seen.';
    case 'ready':
      return `No ${what} have happened yet.`;
  }
}
