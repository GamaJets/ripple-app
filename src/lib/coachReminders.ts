// Coach · the two things this app reminds everybody about except the coach.
//
// ── What was measured ─────────────────────────────────────────────────────
//
// `scheduleLocal` (src/ui/pushNotifications.ts) is wired into exactly three
// places: src/ui/sessions.tsx line 274, the CLIENT's booking flow;
// app/(client)/classes.tsx, the CLIENT's class booking; and
// app/(client)/dashboard.tsx, the client's streak. Every local reminder this
// product sends is sent to a member.
//
// The coach is the one person in the transaction the app never reminds. They
// are also the person for whom missing it is worst: a client who forgets their
// 6:30 has wasted their own hour, and a coach who forgets it has stood somebody
// up.
//
// The second silence is quieter and costs money rather than goodwill. The
// unmarked-session queue on app/(trainer)/sessions.tsx exists, and
// app/(trainer)/dashboard.tsx draws a card counting it — but only for a coach
// who opens the app. Nothing prompts them, and until the queue is cleared the
// statement, the payroll figure and the analytics revenue line are all wrong by
// exactly those sessions. `settlementBlocker` in src/lib/gymSessions.ts already
// refuses to settle a period containing them, which is the right refusal and
// also the reason the backlog is expensive: it blocks somebody's pay.
//
// ── Pure, and why that matters here ───────────────────────────────────────
//
// Everything below is arithmetic on times and a set of ids. The scheduling
// itself is in src/ui/coachReminders.ts, which cannot be tested without a
// phone. The parts that can be silently wrong — which sessions are due a
// reminder, which armed reminders are now stale, and whether the weekly backlog
// prompt is owed — are all here.
//
// ── THE RULE THIS MODULE HOLDS ────────────────────────────────────────────
//
// AN ARMED REMINDER FOR A SESSION THAT MOVED IS WORSE THAN NO REMINDER.
//
// A local notification is scheduled on the handset and survives the app being
// closed. If a client cancels their Tuesday 6:30 and the coach's phone still
// holds the banner, the coach is told at 5:30 to go to a session that is not
// happening — and, worse, they will believe the app is telling them their
// diary. So `staleReminders` is not an optimisation: every arming is paired
// with a cancellation pass over what the diary no longer contains, and a
// session whose START TIME moved counts as stale even though its id has not
// changed.
import type { LoadStatus } from '../ui/loadStatus';
import { weekKey } from './nudge';

/** What is remembered about one armed reminder. Stored on the device. */
export interface ArmedReminder {
  /** The id `scheduleNotificationAsync` returned, so it can be taken back. */
  notifId: string;
  /** The start time the reminder was armed AGAINST. Compared on every pass —
   *  a session moved by an hour keeps its id and needs a new banner. */
  startsAt: string;
}

/** The device's memory of what it has armed, keyed by session id. */
export type ArmedMap = Record<string, ArmedReminder>;

/**
 * How long before a session the coach is told.
 *
 * An hour, matching the client's own reminder in src/ui/sessions.tsx. Not
 * longer: a coach's day is made of these, and a two-hour warning for a 6:30
 * arrives while they are with somebody else. Not shorter either — the whole
 * value is being told while there is still time to travel.
 */
export const COACH_LEAD_MINUTES = 60;

/**
 * How far ahead reminders are armed.
 *
 * iOS caps a single app at 64 pending local notifications, silently, by
 * dropping the ones past the limit. A coach with a full book has more than 64
 * sessions in a month, so arming everything the calendar holds would mean the
 * ones nearest today — the only ones that matter — being the ones dropped.
 * Seven days is well inside the cap for any realistic book and is re-armed on
 * every visit to the schedule, which is more often than weekly for anybody this
 * feature is for.
 */
export const ARM_AHEAD_DAYS = 7;

/** The most reminders armed at once, whatever the window holds. A hard stop
 *  under the platform cap, so the sessions nearest today are the ones that
 *  survive rather than the ones the operating system happens to keep. */
export const MAX_ARMED = 40;

const MIN = 60_000;

/** The minimum shape this module needs of a session. `PtSession` in
 *  src/lib/gymSessions.ts satisfies it; so does anything else with a start and
 *  an outcome. */
export interface RemindableSession {
  id: string;
  startsAt: string;
  /** Slot state — available, booked, blocked. A slot nobody has taken is not a
   *  session the coach has to be anywhere for. */
  status: string;
  /** Null until somebody records what happened. A session already marked is
   *  one the coach has dealt with. */
  outcome: string | null;
  clientName: string | null;
}

/** When to fire, or null when that instant has already passed. Null is a real
 *  answer and not a failure: a session starting in twenty minutes gets no
 *  banner, because a reminder that arrives after the thing it reminds about is
 *  a notification telling somebody they are late. */
export function remindAt(startsAt: string, now: number = Date.now()): Date | null {
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return null;
  const at = t - COACH_LEAD_MINUTES * MIN;
  return at > now ? new Date(at) : null;
}

/**
 * The sessions that should have a reminder armed and do not.
 *
 * Four refusals, in order, and each is a different way the coach could be told
 * to be somewhere they do not need to be:
 *
 *   · not booked — an open slot is an offer, not an appointment;
 *   · already marked — a coach who recorded the outcome has been there;
 *   · past, or inside the lead time — see `remindAt`;
 *   · already armed AGAINST THE SAME START — re-arming would give a coach two
 *     identical banners for one session, which is how somebody learns to swipe
 *     these away without reading them.
 *
 * Sorted soonest first and capped, so a book bigger than the platform's pending
 * limit loses the far end rather than the near one.
 */
export function toArm(
  sessions: readonly RemindableSession[],
  armed: ArmedMap,
  now: number = Date.now(),
  /**
   * How far ahead to arm. Defaults to `ARM_AHEAD_DAYS`, which is the COACH's
   * number and is argued for above: a full book has more than sixty-four
   * sessions in a month and iOS silently drops the pending ones past that, so
   * a coach's window is short and is re-armed on every visit to the schedule.
   *
   * A member is not in that position — they have one session at a time — and
   * their window has to cover the case the coach's never does: booking three
   * weeks out and then not opening the app until the morning of it. See
   * `CLIENT_ARM_AHEAD_DAYS` in src/lib/clientReminders.ts.
   */
  aheadDays: number = ARM_AHEAD_DAYS,
): RemindableSession[] {
  const horizon = now + Math.max(0, aheadDays) * 86_400_000;
  const out = sessions.filter((s) => {
    if (s.status !== 'booked') return false;
    if (s.outcome != null) return false;
    const t = Date.parse(s.startsAt);
    if (!Number.isFinite(t) || t > horizon) return false;
    if (remindAt(s.startsAt, now) == null) return false;
    const have = armed[s.id];
    // Same id, same start: nothing to do. Same id, DIFFERENT start: the session
    // moved, and this is the case a plain `if (armed[s.id]) return false` would
    // have missed — leaving the coach with a banner for the old time and none
    // for the new one.
    return !have || have.startsAt !== s.startsAt;
  });
  out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return out.slice(0, MAX_ARMED);
}

/**
 * Armed reminders that no longer describe anything, with the notification id to
 * cancel.
 *
 * Three causes and all three are the same failure from the coach's side — a
 * banner for a session that is not happening:
 *
 *   · the session is gone from the diary entirely (cancelled, deleted);
 *   · it is still there and no longer booked, or has been marked;
 *   · it is still there and starts at a different time.
 *
 * A session that has simply fallen out of the READ WINDOW is NOT stale. That
 * distinction is the one this function could most easily get wrong: the caller
 * passes the ids it actually looked at, and an arming for a session outside
 * that window is left alone rather than cancelled on the strength of a query
 * that never asked about it.
 */
export function staleReminders(
  armed: ArmedMap,
  sessions: readonly RemindableSession[],
  windowFrom: number,
  windowTo: number,
): { sessionId: string; notifId: string }[] {
  const live = new Map(sessions.map((s) => [s.id, s]));
  const out: { sessionId: string; notifId: string }[] = [];
  for (const [id, a] of Object.entries(armed)) {
    const t = Date.parse(a.startsAt);
    // Armed for a time the caller did not read. Nothing is known about it, so
    // nothing is claimed about it — the same rule every read in this repo
    // keeps, applied to a cancellation.
    if (!Number.isFinite(t) || t < windowFrom || t > windowTo) continue;
    const s = live.get(id);
    if (!s || s.status !== 'booked' || s.outcome != null || s.startsAt !== a.startsAt) {
      out.push({ sessionId: id, notifId: a.notifId });
    }
  }
  return out;
}

/**
 * The span of time a read is entitled to speak about, or null when it is
 * entitled to speak about nothing.
 *
 * ── why this is not `min(rows)` to `max(rows)` ────────────────────────────
 *
 * Because the row that matters is the one that is MISSING. `staleReminders`
 * above will not cancel an arming outside the window it is given, which is the
 * right refusal and is also a loaded gun: derive the window from the starts
 * that came BACK and the furthest-future session is exactly `windowTo`, so the
 * moment that session is cancelled or deleted the read returns one row fewer,
 * `windowTo` retreats to the next session in, and the armed banner for the
 * removed one is now outside the window and can never be cancelled. The coach
 * is sent, an hour early, to a session that no longer exists — and it is the
 * LAST session in their diary every time, because that is the only row whose
 * disappearance moves the edge.
 *
 * The same applies at the near end for a member whose oldest row goes.
 *
 * So the window is stated from the READ's own status instead, which is a fact
 * about what was asked for rather than about what came back:
 *
 *   'ready'   the provider holds the whole set, whatever its dates, so the
 *             window is unbounded and a session that is not in the list is
 *             genuinely gone.
 *   'partial' the read stopped at the row cap (src/lib/rowCap.ts) with the
 *             NEWEST rows, so the oldest row that came back is the edge of what
 *             was actually looked at. Everything from there forward may be
 *             spoken about; anything earlier was never read and is left alone.
 *   'loading' nothing has been read. Null, and the caller does nothing at all —
 *   'error'   NOT a cancellation pass over an empty list, which would silently
 *             disarm every reminder on the handset because one query failed.
 *
 * Written for the client's diary first (src/lib/clientReminders.ts, which
 * re-exports it) and lives here for the same reason `toArm`, `staleReminders`
 * and `remindAt` do: the coach and the member are asking the identical question
 * and two copies of the answer would be two chances to fix only one of them.
 * The coach's screen was the one that still derived its window from the rows.
 */
export function readWindow(
  status: LoadStatus,
  starts: readonly string[],
): { from: number; to: number } | null {
  if (status === 'ready') return { from: -Infinity, to: Infinity };
  if (status !== 'partial') return null;
  let min = Infinity;
  for (const s of starts) {
    const t = Date.parse(s);
    if (Number.isFinite(t) && t < min) min = t;
  }
  // A truncated read that returned nothing readable says nothing about any
  // instant, so it may not cancel anything.
  return Number.isFinite(min) ? { from: min, to: Infinity } : null;
}

/**
 * Armed reminders whose session has already started, for pruning the map.
 *
 * Separate from `staleReminders` because these are not cancelled — the
 * notification has already fired, or the operating system has dropped it — and
 * calling cancel on a delivered id is a call that does nothing. What they need
 * is removing from the device's memory, or the map grows for the life of the
 * install and every pass walks a year of dead entries.
 */
export function expiredReminders(armed: ArmedMap, now: number = Date.now()): string[] {
  return Object.entries(armed)
    .filter(([, a]) => {
      const t = Date.parse(a.startsAt);
      // An unparseable start is dropped too. It can never match a live session
      // and can never be cancelled by `staleReminders`, so leaving it would be
      // a row nothing can ever remove.
      return !Number.isFinite(t) || t <= now;
    })
    .map(([id]) => id);
}

/** The banner. The client's name is in it because a coach with four sessions
 *  today needs to know which one, and it is a name they already hold. */
export function reminderBody(s: RemindableSession): string {
  const when = new Date(s.startsAt);
  const time = Number.isFinite(when.getTime())
    ? when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'soon';
  return s.clientName
    ? `${s.clientName} at ${time}, in an hour.`
    : `A session at ${time}, in an hour.`;
}

/* ── the backlog nobody is prompted about ──────────────────────────────────── */

/**
 * Where the weekly backlog prompt has got to. On the DEVICE, keyed by the week
 * it was last shown in — the same shape and the same reasoning as the watch
 * digest in src/ui/nudges.ts: it is a position rather than an answer, and
 * losing it costs one extra banner.
 */
export const BACKLOG_PROMPT_KEY = 'repple.coachBacklog.week';

/** Below this the queue is a normal week's work and not a backlog. A coach who
 *  is told about two unmarked sessions every Monday stops reading the message
 *  that will one day say forty. */
export const BACKLOG_FLOOR = 3;

/**
 * Whether to prompt about the unmarked queue.
 *
 * `n` is `null` when the read did not answer, and null NEVER prompts. That is
 * the LoadStatus rule applied to a notification: "you have unmarked sessions"
 * sent on the strength of a failed query is a banner about somebody's own
 * business that the app has not checked, and the coach who opens the app and
 * finds an empty queue learns to ignore the next one.
 *
 * Weekly, on `weekKey`. Once a week rather than daily because clearing the
 * queue is a sit-down job rather than a two-minute one, and a daily prompt for
 * a job somebody is not going to do today is the definition of nagging.
 */
export function backlogDue(
  n: number | null,
  seenWeek: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (n == null || n < BACKLOG_FLOOR) return false;
  // Inequality and not "is older than", for `watchDigestDue`'s reason: a stored
  // key from a future week — a handset whose clock was wrong, a restored
  // backup — must resolve to "show it", because the alternative is a prompt
  // that never appears again.
  return !seenWeek || seenWeek !== weekKey(now);
}

/**
 * What the prompt says.
 *
 * Names the CONSEQUENCE and not the chore. "You have 12 unmarked sessions" is a
 * fact about a list; "twelve sessions are counted nowhere until you mark them"
 * is the reason to open it, and it is true — `settlementBlocker` refuses to
 * settle a period containing them, `coachStatement` leaves them out, and the
 * analytics revenue line is short by exactly those sessions.
 */
export function backlogBody(n: number): string {
  return `${n} session${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} waiting on an outcome. `
    + `Until ${n === 1 ? 'it is' : 'they are'} marked ${n === 1 ? 'it counts' : 'they count'} nowhere — `
    + 'not in your statement, not in your revenue, and not in anybody’s pay.';
}

/**
 * The same fact for a screen rather than a banner, in all three states.
 *
 * Null when there is nothing to say, so a caller can render nothing at all
 * rather than a row explaining that everything is fine.
 */
export function backlogNote(n: number | null, failed: boolean): string | null {
  if (failed) {
    return 'Whether anything is waiting on an outcome could not be checked, so this is not a clear queue — it is an unknown one.';
  }
  if (n == null || n === 0) return null;
  return backlogBody(n);
}
