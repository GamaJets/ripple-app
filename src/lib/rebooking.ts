// Who trained with this coach recently and has nothing in the diary.
//
// ── the question a calendar never asks ─────────────────────────────────────
//
// app/(trainer)/calendar.tsx can answer "who is coming" for every day in the
// month. It cannot answer "who has stopped coming", because that person is not
// a row on any day — they are an ABSENCE, and an absence has no cell to be
// drawn in. A client who trained every Tuesday for a year and did not rebook
// after the last one simply stops appearing, and the diary looks tidier for it.
//
// This is not the same question as src/lib/clientDrift.ts asks and it must not
// be confused with it. `assessDrift` measures a change in somebody's own
// training RATE against a fifty-six day baseline built from check-ins,
// workouts, completed sessions and gym door swipes — four reads this screen
// does not make. The question here is narrower, colder and answerable from the
// diary alone:
//
//     HAD AN APPOINTMENT. HAS NONE.
//
// A client can be perfectly steady by every drift measure and still have
// nothing on the books, because the last thing they did was turn up, say
// "same time next week?" and leave without either of you writing it down.
//
// ── what makes the answer trustworthy, and where it is not ────────────────
//
// `useSessions` reads `sessions` ordered `starts_at` DESCENDING and capped
// (src/ui/sessions.tsx). On a newest-first read the cut is at the OLD end, so:
//
//   · the FUTURE half is always whole. "Has nothing booked ahead" is therefore
//     safe to state even under 'partial' — a booking that exists cannot have
//     fallen off the end this read cuts.
//   · the PAST half may be cut. "Trained in the last four weeks" is therefore
//     NOT safe to state under a truncated read: somebody who did is simply
//     missing. That is an under-report — a coach is never told to chase
//     somebody who is already booked — and `rebookCoverageNote` says so rather
//     than letting a short list read as a clean book.
//
// The one gap nothing here can close is stated in src/lib/sessionHistory.ts
// under CLIENT_CANCELLED_GAP_NOTE: when a client cancels their own booking,
// `cancel_my_session` frees the slot and nulls `client_id`, so the row stops
// being theirs in any readable sense. A client whose last act was to cancel
// their last session may not appear here at all. `REBOOK_CANCELLED_GAP_NOTE` is
// the sentence that says so, and it is shown rather than worked around, because
// there is no read that recovers it.
import type { LoadStatus } from '../ui/loadStatus';
import { rangeCoverage, type ReadBoundary } from './sessionHistory';

const DAY = 86_400_000;

/** The local calendar day an instant falls on, as a day number. Built from
 *  local components and compared in UTC, which is the one way to subtract two
 *  local days without a clock change getting into the arithmetic. */
function localDayIndex(ms: number): number {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/**
 * How far back "recently" reaches.
 *
 * Four weeks, and the number is a judgement about the act rather than about
 * training frequency. A fortnight catches everybody who trains weekly and
 * misses the fortnightly client entirely; a quarter surfaces people who left in
 * the spring, which is a different problem with a different conversation. Four
 * weeks is the window in which "shall we get the next one in?" is still an
 * ordinary thing to say.
 */
export const REBOOK_LOOKBACK_DAYS = 28;

/** The minimum this module needs to know about a session row. */
export interface RebookRow {
  clientId: string | null;
  startsAt: string;
  durationMin: number;
  /** The SLOT state — available, booked, blocked. Never the delivery result. */
  status?: string | null;
  /** `sessions.outcome`. Null means nobody has said what happened. */
  outcome?: string | null;
}

export interface Unrebooked {
  clientId: string;
  /** The last appointment they had, whatever became of it. */
  lastStartsAt: string;
  /** When that appointment ended. */
  lastEndMs: number;
  /**
   * Whole LOCAL DAYS between the day that session was on and today. Zero on
   * the day itself, one for yesterday.
   *
   * Calendar days rather than elapsed milliseconds, and the difference is not
   * cosmetic: a session at 6pm yesterday is eighteen hours ago, which
   * `floor(elapsed / 86,400,000)` calls zero and a coach calls yesterday. It is
   * also the daylight-saving-safe reading — the two days a year that are
   * twenty-three and twenty-five hours long are still one day apart.
   */
  daysSince: number;
  /** True when that last appointment was recorded as cancelled or not attended,
   *  rather than delivered or still unmarked. A different conversation: they
   *  did not train, so this is not "book the next one", it is "what happened". */
  lastMissed: boolean;
}

/**
 * Whether a row is an appointment belonging to a named client.
 *
 * An `available` slot that has gone by belongs to nobody and is not evidence
 * anybody trained — the inference supabase/parts/33 exists to end. A row
 * carrying an outcome is kept whatever its slot state, because recording an
 * outcome is somebody stating this was a real session.
 */
function isAppointment(r: RebookRow): boolean {
  if (!r.clientId) return false;
  return r.status === 'booked' || (r.outcome != null && r.outcome !== '');
}

/**
 * The clients who had an appointment inside the window and have none ahead.
 *
 * Longest-since first, because that is the order in which a coach loses people.
 * Ties go to the name-free, stable key — the client id — so the list does not
 * reshuffle between renders.
 *
 * `nowMs` is passed in. A frozen clock here reports last week's list forever,
 * and this is a screen that stays mounted for days.
 */
export function unrebooked(
  rows: readonly RebookRow[],
  nowMs: number,
  lookbackDays: number = REBOOK_LOOKBACK_DAYS,
): Unrebooked[] {
  const since = nowMs - Math.max(1, lookbackDays) * DAY;
  const hasAhead = new Set<string>();
  const last = new Map<string, { startsAt: string; endMs: number; missed: boolean }>();

  for (const r of rows) {
    if (!isAppointment(r) || !r.clientId) continue;
    const s = Date.parse(r.startsAt);
    if (!Number.isFinite(s)) continue;
    const end = s + Math.max(0, r.durationMin) * 60_000;
    // Its END, not its start. The hour somebody is standing in is not a past
    // session and it is not a future booking either — but it is certainly not a
    // reason to chase them, so an in-progress session counts as "ahead".
    if (end > nowMs) {
      // A cancelled appointment in the future is not a booking. It is a row
      // with a note on it saying the opposite.
      if (r.outcome === 'cancelled' || r.outcome === 'late_cancelled') continue;
      hasAhead.add(r.clientId);
      continue;
    }
    if (end < since) continue;
    const prev = last.get(r.clientId);
    if (!prev || end > prev.endMs) {
      last.set(r.clientId, {
        startsAt: r.startsAt,
        endMs: end,
        missed: r.outcome === 'no_show' || r.outcome === 'cancelled' || r.outcome === 'late_cancelled',
      });
    }
  }

  const out: Unrebooked[] = [];
  for (const [clientId, l] of last) {
    if (hasAhead.has(clientId)) continue;
    out.push({
      clientId,
      lastStartsAt: l.startsAt,
      lastEndMs: l.endMs,
      daysSince: Math.max(0, localDayIndex(nowMs) - localDayIndex(l.endMs)),
      lastMissed: l.missed,
    });
  }
  return out.sort((a, b) => b.daysSince - a.daysSince || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
}

/**
 * Whether the list may be shown at all.
 *
 * 'partial' is admitted here, and that is a deliberate departure from the usual
 * `isWhole` gate — with the reason in the module header. The claim each row
 * makes is "this person has nothing booked ahead", and the future half of a
 * newest-first read is whole even when the read was cut. What 'partial' costs
 * is rows that should be in the list and are not, which `rebookCoverageNote`
 * states. 'loading' and 'error' produce no list at all.
 */
export function rebookingListable(status: LoadStatus): boolean {
  return status === 'ready' || status === 'partial';
}

/**
 * What the list cannot promise, or null when it promises everything.
 *
 * The boundary is `readBoundary` over the same rows — how far back the read
 * actually reached — and the window is the lookback. `rangeCoverage` answers
 * whether the two overlap, and its 'edge' and 'beyond' are two different
 * shortfalls: part of the window was read, or none of it was.
 */
export function rebookCoverageNote(
  boundary: ReadBoundary,
  status: LoadStatus,
  nowMs: number,
  dayLabel: (iso: string) => string,
  lookbackDays: number = REBOOK_LOOKBACK_DAYS,
): string | null {
  const from = nowMs - Math.max(1, lookbackDays) * DAY;
  const cover = rangeCoverage(from, nowMs, boundary, status);
  if (cover === 'covered') return null;
  if (cover === 'unknown') {
    return 'Your sessions have not been read in full, so this is not a list of everybody who has not rebooked.';
  }
  const back = boundary.oldestISO
    ? `Your calendar is loaded back to ${dayLabel(boundary.oldestISO)} and no further`
    : 'Your calendar is not loaded back that far';
  return cover === 'beyond'
    ? `${back}, so none of the last ${lookbackDays} days was read. Anybody who trained in that time and has not `
      + 'rebooked is missing from this list rather than absent from your book.'
    : `${back}, so only part of the last ${lookbackDays} days was read. Somebody who trained before that and has `
      + 'not rebooked is missing from this list rather than absent from your book.';
}

/** Said wherever this list is shown, because no read can close it. */
export const REBOOK_CANCELLED_GAP_NOTE =
  'A client who cancelled their own last session may not be here. Cancelling hands the hour back to you, so the '
  + 'booking stops being theirs and there is nothing left to read.';

/** The heading over the list, or null when there is nothing to head. */
export function unrebookedHeading(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? 'One client with nothing booked' : `${n} clients with nothing booked`;
}

/**
 * The line under one of them.
 *
 * Says the fact and not the inference. "Last trained 9 days ago, nothing since"
 * is something the diary knows; "at risk of leaving" is not, and belongs to
 * src/lib/clientDrift.ts, which measures it properly against four sources.
 *
 * `when` is the caller's formatter for the date — this module formats none, for
 * the reason src/lib/sessionHistory.ts gives: every locale decision in this
 * repo goes through `appLocale()`.
 */
export function unrebookedNote(u: Unrebooked, when: (iso: string) => string): string {
  const ago = u.daysSince === 0 ? 'earlier today'
    : u.daysSince === 1 ? 'yesterday'
    : `${u.daysSince} days ago`;
  const head = u.lastMissed
    ? `Their last session, ${when(u.lastStartsAt)}, did not go ahead — ${ago}.`
    : `Last session ${when(u.lastStartsAt)}, ${ago}.`;
  return `${head} Nothing booked since.`;
}

/** The line when nobody is on the list, which is a real and good answer and
 *  deserves to be said rather than left as a blank space. */
export function noUnrebookedLine(lookbackDays: number = REBOOK_LOOKBACK_DAYS): string {
  return `Everybody who has trained with you in the last ${lookbackDays} days has something booked.`;
}
