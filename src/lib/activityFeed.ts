// What the member's own feed is allowed to say about a session, and what a
// week of that feed adds up to.
//
// Used by app/(client)/activity.tsx and nothing else. It is a module rather
// than two closures on that screen for the usual reason: both answers are
// arithmetic over a record, both were wrong there in ways nobody could see by
// reading the JSX, and neither can be asserted while it lives inside a
// component.
//
// ── 1. A booking is not an event ───────────────────────────────────────────
//
// The feed listed a session with:
//
//     s.status === 'booked' && Date.parse(s.startsAt) <= nowMs
//
// Two separate claims, and both of them are wrong.
//
// THE START IS NOT THE END. `hasEnded` in src/lib/sessionHistory.ts settles
// this already and says why in as many words: "A session in progress is not
// history, and putting the hour somebody is standing in into a list headed
// what already happened" is the mistake. A member who opened this screen ten
// minutes into their own session read that it had happened.
//
// AND THE OUTCOME WAS NEVER ASKED FOR. `sessions.outcome` has carried
// completed / no_show / cancelled / late_cancelled since
// supabase/parts/33-session-outcomes.sql, and src/lib/types.ts says on the
// column that "Booked, and the clock has passed" is the exact inference part 33
// exists to end. The feed made that inference anyway and printed one sentence —
// "Session Booked" — over all five states. A session the coach cancelled on
// Thursday morning sat in the member's own history looking like a session they
// had attended, three rows below the workout they logged instead.
//
// So the verdict is read, not guessed, and it is read through `pastVerdict` so
// the member's feed and the session history screens cannot come to disagree
// about the same hour. An outcome this build has never heard of arrives as
// 'unmarked' — that module's own rule, and the right one: unknown is a state,
// not a synonym for delivered.
//
// ── 2. What a week came to ────────────────────────────────────────────────
//
// A member opening this screen after a week away is asking one question before
// any of the rows answer it. Nothing on the screen answered it; there were
// forty rows, newest first, and the reading was left to them.
//
// The window is a ROLLING SPAN OF INSTANTS — `now - days × 24h` — and never a
// run of calendar days. That is deliberate and it is the reason no `YYYY-MM-DD`
// appears anywhere in this file: a day boundary is a local question, a logged
// set is an instant, and the moment those two are mixed the answer is a day out
// for everybody west of Greenwich. src/lib/myPlanWeek.ts refuses the same thing
// for the same reason and says so on `CAVEAT`.
//
// ── What it will not say ──────────────────────────────────────────────────
//
// No score, no streak, no percentage, and nothing at all when the window is
// empty. "Nothing in the last 7 days" is a sentence about a member, and the
// caller cannot know it is true unless every read behind the feed landed whole
// — which is a judgement about LoadStatus and belongs to the screen, not here.
// `catchUpLine` returns null on an empty week and the screen draws nothing.
import { pastVerdict, hasEnded, wasBooked, type HistoryRow, type PastState } from './sessionHistory';

/* ── sessions ──────────────────────────────────────────────────────────── */

/** A session as the feed needs to see it. Structural: the caller holds a
 *  `TrainingSession` and nothing here needs the rate, the trainer or the id. */
export interface FeedSession extends HistoryRow {
  clientId?: string | null;
  durationMin?: number | null;
}

/** One row the feed may draw for a session that has already finished. */
export interface SessionFeedRow<T> {
  session: T;
  /** What the record says became of it. Never inferred from the clock. */
  state: PastState;
  /** The row's heading. Title case, like every other heading in that feed. */
  title: string;
}

/**
 * The heading for each state.
 *
 * Not `PAST_STATE_LABEL` with a word bolted on: those are sentence-case
 * fragments written to sit inside prose ("2 delivered, 1 not attended"), and a
 * feed heading is a title. The states are the same five and come from the same
 * place, so the two lists cannot drift apart in meaning even though they differ
 * in case.
 *
 * 'unmarked' says what is actually true — the session's time has passed and
 * nobody has recorded what happened — rather than "Session Booked", which is a
 * statement about the past that stopped being the interesting one the moment
 * the hour went by.
 */
export const SESSION_FEED_TITLE: Record<PastState, string> = {
  delivered: 'Session Completed',
  missed: 'Session Not Attended',
  late_cancelled: 'Session Cancelled Late',
  cancelled: 'Session Cancelled',
  unmarked: 'Session Not Yet Marked',
};

/**
 * The member's own finished sessions, newest first.
 *
 * @param sessions every session the provider holds, in any order.
 * @param clientId the signed-in member's id. A null or an empty id matches
 *   NOTHING rather than everything — `clientId` on an open slot is null, and a
 *   loose equality here would hand a member every unbooked hour on the
 *   trainer's calendar as sessions of their own.
 * @param now the instant to judge against. Passed in, never read from the
 *   clock: a render-body `Date.now()` freezes on a screen nothing re-renders,
 *   which is the defect src/ui/today.ts exists for.
 */
export function sessionFeedRows<T extends FeedSession>(
  sessions: readonly T[],
  clientId: string | null | undefined,
  now: number,
): SessionFeedRow<T>[] {
  if (!clientId) return [];
  const rows: SessionFeedRow<T>[] = [];
  for (const s of sessions) {
    if (s.clientId !== clientId) continue;
    // Booked, or carrying an outcome — `wasBooked`'s rule, which keeps a
    // session somebody recorded an outcome for even after its slot state moved,
    // and refuses an `available` hour that simply went by.
    if (!wasBooked(s)) continue;
    if (!hasEnded(s, now)) continue;
    const v = pastVerdict(s);
    rows.push({ session: s, state: v.state, title: SESSION_FEED_TITLE[v.state] });
  }
  return rows.sort((a, b) => Date.parse(b.session.startsAt) - Date.parse(a.session.startsAt));
}

/* ── the week ──────────────────────────────────────────────────────────── */

/** What a feed row is, for counting. The screen tags its own events. */
export type FeedKind = 'workout' | 'pr' | 'checkin' | 'session' | 'other';

/** The tally over the window. Every field is a count of things that happened,
 *  so 0 is a true answer and null never appears — a read that did not land is
 *  the caller's `LoadStatus` and never a zero in here. */
export interface CatchUp {
  workouts: number;
  prs: number;
  checkins: number;
  sessions: number;
  /** Everything in the window, including kinds with no sentence of their own. */
  total: number;
}

/**
 * What happened in the last `days` days.
 *
 * A PR is a workout as well as a record — the screen draws one row for both —
 * so it is counted in `prs` and NOT again in `workouts`. Counting it twice
 * would tell somebody who trained three times that they trained four.
 *
 * Rows with an unparseable or future `at` are outside the window and are not
 * counted. Future in particular: nothing future belongs in a feed of what
 * happened, and a row that got there anyway must not inflate a week.
 */
export function catchUp(
  events: readonly { at: string; kind: FeedKind }[],
  now: number,
  days: number,
): CatchUp {
  const span = Math.max(1, Math.floor(days)) * 86_400_000;
  const from = now - span;
  const c: CatchUp = { workouts: 0, prs: 0, checkins: 0, sessions: 0, total: 0 };
  for (const e of events) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t) || t < from || t > now) continue;
    c.total += 1;
    if (e.kind === 'workout') c.workouts += 1;
    else if (e.kind === 'pr') c.prs += 1;
    else if (e.kind === 'checkin') c.checkins += 1;
    else if (e.kind === 'session') c.sessions += 1;
  }
  return c;
}

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * The one line above the feed, or null when there is nothing to say.
 *
 * Null on an empty window rather than "nothing in the last 7 days", because
 * that is a claim about the member's week and this function cannot see whether
 * the reads behind it landed. The screen holds the status; it draws this only
 * where it would already be willing to say the feed is complete.
 *
 * Sessions count as sessions whatever became of them — a cancelled hour is part
 * of what happened to somebody's week, and the rows below say which is which.
 * The line never grades: no streak, no target, no "only".
 */
export function catchUpLine(c: CatchUp, days: number): string | null {
  const parts: string[] = [];
  const trained = c.workouts + c.prs;
  if (trained > 0) parts.push(`${trained} workout${s(trained)} logged`);
  if (c.prs > 0) parts.push(`${c.prs} personal record${s(c.prs)}`);
  if (c.checkins > 0) parts.push(`${c.checkins} check-in${s(c.checkins)} sent`);
  if (c.sessions > 0) parts.push(`${c.sessions} session${s(c.sessions)} with your coach`);
  if (!parts.length) return null;
  const last = parts.pop() as string;
  const body = parts.length ? `${parts.join(', ')} and ${last}` : last;
  return `In the last ${Math.max(1, Math.floor(days))} days: ${body}.`;
}
