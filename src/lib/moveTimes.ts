// Where a session can be moved TO, when the coach has not already opened it.
//
// ── the dead end this exists to remove ─────────────────────────────────────
//
// app/(trainer)/calendar.tsx builds the Move sheet's list like this:
//
//     sessions.filter((x) => x.status === 'available' && …)
//
// and the sheet's own comment states the consequence out loud: "Nothing here
// creates an hour: a move goes into a slot that already exists." So a coach
// whose client asks to shift Tuesday 7am to 8am is told, in the sheet's own
// words, to "Open one from Weekly Availability or Add a Session first" — go
// away, publish an hour to the whole roster, come back, and hope nobody took
// it in between. A client asking to move an hour is the single most ordinary
// thing that happens to a diary, and it was the one thing the diary refused.
//
// The refusal is not a small one either. The alternative route is Cancel, and
// supabase/parts/461 lists what Cancel does to a move: the client's hour is
// handed to whoever was first on its waitlist before the client has been put
// anywhere, the client is sent a cancellation they did not ask for, and
// re-booking them draws a SECOND pack credit for one hour of training.
//
// ── the two halves, and why both are needed ────────────────────────────────
//
// SERVER. supabase/parts/1830 adds `reschedule_client_session_at`, which takes
// an INSTANT rather than a destination row: it frees the old hour and creates
// the new booking inside one transaction, carrying the five pack markers, and
// hands the freed hour to its waitlist only once the client is in their new
// one. Part 461's function is unchanged and still used whenever a real open
// slot is picked — see `MoveTime.slotId` below.
//
// A client-side "create the slot, then move into it" was written first and
// thrown away. It is two writes with a gap in the middle, and the gap is the
// whole problem: the slot it creates is BOOKABLE, published to every client
// the coach has, so the failure mode of the second write is not "nothing
// happened" but "somebody else took the hour you were making for Ana". There
// is no sentence a screen can print about that which is both true and useful.
//
// SCREEN. This module answers the other half — which times to offer. The claim
// a listed time makes is exactly one thing and it is worth stating precisely:
//
//     NOTHING OF THIS COACH'S IS IN IT.
//
// Not "the client is free" (this app cannot know that), not "the room is free"
// (nor that). Free means the span overlaps no session of theirs that is booked,
// no time they have blocked out, and no class they are down to teach — the same
// three obstacles `answer_session_request` (part 740) checks on the server, in
// the same order, because a list offering times the server will refuse is worse
// than no list. The server checks again under the lock; this is what lets the
// coach be told which times not to bother tapping.
//
// And the claim is only as good as the reads behind it, which is why
// `moveTimesCaveat` exists and why every one of its branches is a different
// sentence. A coach's own diary read at 'partial' can be missing the very
// booking that occupies the hour being offered.
import type { LoadStatus } from '../ui/loadStatus';

/** Something of the coach's that occupies time. The three the server checks. */
export type MoveBlockerKind = 'booked' | 'blocked' | 'class';

export interface MoveBlocker {
  /** The session id where there is one. Null for a class, which is not a
   *  session — the id is here only so the hour being MOVED can be excluded
   *  from its own obstacle list. */
  id?: string | null;
  startsAt: string;
  durationMin: number;
  kind: MoveBlockerKind;
}

/** An hour the coach has already published. A move into one of these goes
 *  through part 461 and touches no new row. */
export interface MoveOpenSlot {
  id: string;
  startsAt: string;
  durationMin: number;
}

/** A stretch of a weekday the coach said they work, in minutes past local
 *  midnight. Half-open: `[startMin, endMin)`. */
export interface WorkWindow {
  startMin: number;
  endMin: number;
}

/** One offerable start time. */
export interface MoveTime {
  /** ISO instant, which is what the server is sent. */
  startsAt: string;
  /** The same instant in milliseconds, for sorting and for keys. */
  startMs: number;
  /**
   * The coach's own open slot at exactly this time and length, or null.
   *
   * Non-null means the cheap, proven path: part 461's `reschedule_client_session`
   * moves into an existing row. Null means part 1830's
   * `reschedule_client_session_at` creates the booking. The screen must not
   * choose by preference — it is a fact about the diary, not a setting.
   */
  slotId: string | null;
  /** Inside a window the coach said they work. Offered either way; grouped so
   *  a coach is not asked to scroll past 5am to reach 8am. */
  inHours: boolean;
}

/** Quarter-hour. Finer than a coach thinks in and coarse enough that a day is
 *  a list rather than a wall of numbers. */
export const MOVE_STEP_MIN = 15;

/**
 * The bounds of the day when the coach has stated no working hours for it.
 *
 * Deliberately not 00:00–24:00. A coach with no availability row for Tuesday —
 * which after part 731 is a real and common state, because slot generation
 * skipped every row with a null timezone and nothing backfilled it — would
 * otherwise be handed ninety-six times, most of them the middle of the night.
 * These bounds are a PRESENTATION default and make no claim about the coach's
 * life: every time inside them is still checked against the diary, and a coach
 * who works at 4am reaches it through their weekly availability, which is where
 * that fact belongs.
 */
export const MOVE_DAY_START_MIN = 5 * 60;
export const MOVE_DAY_END_MIN = 22 * 60;

/** How many times one day may offer. A guard on the render, not on the diary:
 *  a fifteen-minute grid over a seventeen-hour day is sixty-eight rows. */
export const MOVE_TIMES_CAP = 96;

const MIN = 60_000;

/**
 * The weekday's availability rows, merged into windows.
 *
 * `trainer_availability` holds one row per offered slot — a coach who works
 * Tuesday 07:00 to 19:00 has forty-eight of them after `expandRange`
 * (src/lib/availabilityRange.ts), each 15 minutes long and each abutting the
 * next. Offering a move only at the START of each of those is the same dead end
 * one level down, so they are merged: touching or overlapping rows become one
 * window and the grid runs across it.
 *
 * Rows for other weekdays are dropped, not merged in. A window is a statement
 * about one day of the week.
 */
export function workWindows(
  slots: readonly { dow: number; hour: number; minute: number; dur: number }[],
  dow: number,
): WorkWindow[] {
  const spans = slots
    .filter((s) => s.dow === dow)
    .map((s) => ({
      startMin: Math.max(0, s.hour * 60 + s.minute),
      endMin: Math.max(0, s.hour * 60 + s.minute) + Math.max(0, s.dur),
    }))
    .filter((s) => s.endMin > s.startMin)
    .sort((a, b) => a.startMin - b.startMin);
  const out: WorkWindow[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    // `>=` rather than `>`: 07:00–07:15 and 07:15–07:30 are one window, and
    // treating them as two would put a seam at every quarter hour.
    if (last && s.startMin <= last.endMin) last.endMin = Math.max(last.endMin, s.endMin);
    else out.push({ startMin: s.startMin, endMin: s.endMin });
  }
  return out;
}

export interface MoveTimesInput {
  /** The local day being offered. `monthIndex` is 0-11, as `Date` takes it. */
  year: number;
  monthIndex: number;
  day: number;
  /** The length of the session being moved. A move keeps its length — that is
   *  what makes it the same session at a different hour. */
  durationMin: number;
  /** The session being moved. Its own hour is not an obstacle to itself: the
   *  server frees it before it books the new one, so 7:00–8:00 may move to
   *  7:30. Passing this is what stops the sheet hiding the near misses, which
   *  are the commonest move there is. */
  movingId: string;
  /** Everything of the coach's that occupies time on this day. */
  blockers: readonly MoveBlocker[];
  /** The coach's already-published open hours. */
  open: readonly MoveOpenSlot[];
  /** Windows for THIS weekday, from `workWindows`. Empty means the coach has
   *  stated none, and the day falls back to `MOVE_DAY_START_MIN`. */
  work: readonly WorkWindow[];
  /** Now, passed in. Never `Date.now()` inside — a screen holding a frozen
   *  clock would offer hours that have already gone. */
  nowMs: number;
  stepMin?: number;
}

/**
 * The times on one local day that this coach could move a session into.
 *
 * Built from local wall-clock components rather than by adding milliseconds to
 * a midnight, and that is a daylight-saving decision. "8am on Sunday" is a
 * wall-clock fact; `midnight + 8 * 3600_000` is 7am or 9am on the two Sundays a
 * year a clock moves, and `npm run test:zones` runs this under Auckland and Los
 * Angeles, whose transitions fall in opposite months. Spring-forward also makes
 * two grid entries name the same instant — 02:30 and 03:30 both resolve to
 * 03:30 — so the list is de-duplicated on the instant.
 */
export function moveTimes(input: MoveTimesInput): MoveTime[] {
  const step = Math.max(5, input.stepMin ?? MOVE_STEP_MIN);
  const dur = Math.max(1, input.durationMin);
  const busy = input.blockers
    .filter((b) => !(b.kind !== 'class' && b.id != null && b.id === input.movingId))
    .map((b) => ({ s: Date.parse(b.startsAt), e: Date.parse(b.startsAt) + Math.max(0, b.durationMin) * MIN }))
    .filter((b) => Number.isFinite(b.s));
  const openAt = new Map<number, string>();
  for (const o of input.open) {
    const ms = Date.parse(o.startsAt);
    // Only an EXACT match counts. An open 30-minute slot at 8am is not a place
    // to put a 60-minute session, and quietly stretching it would publish a
    // booking across an hour the coach never opened while telling them nothing
    // new was created.
    if (Number.isFinite(ms) && o.durationMin === dur && !openAt.has(ms)) openAt.set(ms, o.id);
  }

  const windows: WorkWindow[] = input.work.length
    ? input.work.map((w) => ({ startMin: w.startMin, endMin: w.endMin }))
    : [{ startMin: MOVE_DAY_START_MIN, endMin: MOVE_DAY_END_MIN }];
  const stated = input.work.length > 0;

  const seen = new Set<number>();
  const out: MoveTime[] = [];
  const dayStart = stated ? MOVE_DAY_START_MIN : windows[0].startMin;
  const dayEnd = stated ? MOVE_DAY_END_MIN : windows[0].endMin;
  // When the coach HAS stated hours, the grid still runs across the whole
  // presentation day so a deliberately unusual time is reachable; the stated
  // windows then decide `inHours` rather than deciding what exists. When they
  // have not, there is nothing to be outside of and the day is the grid.
  const lo = stated ? Math.min(dayStart, ...windows.map((w) => w.startMin)) : dayStart;
  const hi = stated ? Math.max(dayEnd, ...windows.map((w) => w.endMin)) : dayEnd;

  for (let m = lo; m <= hi - dur && out.length < MOVE_TIMES_CAP; m += step) {
    // Hours past 23 are not rolled into the next day by hand — `Date` does that
    // itself, correctly, and a window running to 24:00 is the ordinary way to
    // say "until midnight".
    const d = new Date(input.year, input.monthIndex, input.day, Math.floor(m / 60), m % 60, 0, 0);
    const ms = d.getTime();
    if (!Number.isFinite(ms) || seen.has(ms)) continue;
    seen.add(ms);
    if (ms <= input.nowMs) continue;
    const end = ms + dur * MIN;
    if (busy.some((b) => ms < b.e && b.s < end)) continue;
    const inHours = windows.some((w) => m >= w.startMin && m + dur <= w.endMin);
    out.push({ startsAt: d.toISOString(), startMs: ms, slotId: openAt.get(ms) ?? null, inHours });
  }
  return out;
}

/** The two groups the sheet draws, in the order it draws them. Never sorted
 *  together: a coach scanning for 8am should not have to read past 05:00. */
export function groupMoveTimes(times: readonly MoveTime[]): { inHours: MoveTime[]; outside: MoveTime[] } {
  return {
    inHours: times.filter((t) => t.inHours),
    outside: times.filter((t) => !t.inHours),
  };
}

/**
 * What the list of free times cannot promise, or null when it can promise
 * everything it says.
 *
 * Three separate reads stand behind the word "free" and each of them fails on
 * its own. They are reported separately rather than folded into one "something
 * is missing", because the next step differs: an unread class timetable means
 * check the timetable, an unread diary means pull to refresh, and neither is
 * "the server will sort it out".
 *
 * The sessions read is deliberately NOT handled here. Under 'error' there is no
 * list at all and the sheet says so instead of qualifying an empty one — see
 * `emptyMoveTimesLine`.
 */
export function moveTimesCaveat(sessions: LoadStatus, classes: LoadStatus): string | null {
  const parts: string[] = [];
  if (sessions === 'partial') {
    parts.push('Only part of your calendar came back, so a time listed here may already have something in it.');
  }
  if (classes === 'error') {
    parts.push('Your class timetable could not be read, so these times do not account for a class you are down to teach.');
  } else if (classes === 'partial') {
    parts.push('Only part of your class timetable came back, so these times may not account for every class you teach.');
  }
  if (!parts.length) return null;
  // The reassurance goes last and it is a real one: part 1830 re-checks all
  // three under the row lock and refuses with the obstacle named, so the worst
  // outcome of a stale list is a refusal rather than a double booking.
  parts.push('The move is checked again on the server, so an occupied hour is refused rather than booked twice.');
  return parts.join(' ');
}

/**
 * The one line an empty list of times is allowed to print.
 *
 * Five answers, because `[]` means five things here. The fifth is the one this
 * whole module exists for and it is a real state, not a defensive branch: a
 * coach whose day is genuinely full has nowhere to move a client TO on that
 * day, and telling them that plainly — rather than "no open slots", which sent
 * them to Weekly Availability — is the difference between picking another day
 * and cancelling somebody.
 */
export function emptyMoveTimesLine(
  status: LoadStatus,
  dayLabel: string,
  statedHours: boolean,
): string {
  switch (status) {
    case 'loading':
      return `Still reading your calendar for ${dayLabel}.`;
    case 'error':
      return `Your calendar could not be read, so the hours you have free on ${dayLabel} are not known. `
        + 'Nothing is listed because nothing came back. Pull down to refresh and try again.';
    case 'partial':
      return `Only part of your calendar came back, so what is free on ${dayLabel} is not established. `
        + 'Pull down to refresh and open this again.';
    case 'ready':
      return statedHours
        ? `Every hour of ${dayLabel} already has something of yours in it, so there is nowhere to move this to `
          + 'on that day. Try another day.'
        : `Every hour of ${dayLabel} already has something of yours in it. You have not set working hours for `
          + 'that day, so only the daytime was looked at — set them in Weekly Availability, or try another day.';
  }
}

/* ── the answer that comes back from part 1830 ──────────────────────────── */

/**
 * Why a move to a time the coach had not opened did not happen.
 *
 * A superset of `CoachMoveRefusal` in src/lib/reschedule.ts, and deliberately
 * its own type rather than a widening of that one. Part 461 moves BETWEEN ROWS
 * and its refusals are about a destination row — 'taken' means somebody booked
 * the slot. Part 1830 has no destination row, so it cannot be taken; what it
 * can hit instead is an obstacle in the span, and it names which of the three.
 */
export type MoveAtRefusal =
  /** Not this coach's session, not booked, or nobody in it. */
  | 'not-yours'
  /** The session being moved has already begun. */
  | 'already-started'
  /** The time asked for is in the past. */
  | 'past'
  /** A one-to-one of this coach's is already booked across it. */
  | 'clash-booked'
  /** The coach marked that time as unavailable. */
  | 'clash-blocked'
  /** The coach is down to teach a class then. */
  | 'clash-class'
  /** The exclusion constraint caught something that landed mid-flight, and this
   *  branch genuinely does not know which of the three it was. */
  | 'clash'
  /** Not a time the server would accept — malformed, or a length it refuses. */
  | 'bad-time'
  /** The call itself did not land. The only one where nobody knows whether
   *  anything happened, so it is the one that says to check first. */
  | 'unreachable';

export interface MoveAtReport {
  moved: boolean;
  reason: MoveAtRefusal | null;
  /** The client whose hour moved, from the SERVER's copy of the row rather than
   *  the screen's, which the move has just made stale. Null on every refusal. */
  clientId: string | null;
  /** The new session's id, when one was made. */
  sessionId: string | null;
  /** Somebody was waiting for the hour that was freed, and now has it. */
  promoted: boolean;
  /** How many are still in line for the freed hour afterwards. */
  waiting: number;
  /** The class the coach is down to teach, on 'clash-class' only. */
  className: string | null;
}

export const MOVE_AT_NOT_MOVED: MoveAtReport = {
  moved: false, reason: 'unreachable', clientId: null, sessionId: null,
  promoted: false, waiting: 0, className: null,
};

/**
 * What to say when a move to a chosen time did not happen.
 *
 * Every branch ends with the state of the world, for the reason
 * `coachMoveRefusalLine` states next door: a refusal is indistinguishable from
 * a failure unless somebody says so, and the one thing a coach must not walk
 * away believing is that a client's hour has changed when it has not.
 *
 * `unreachable` is the only branch that does not assert where the session is,
 * because it is the only one where nobody knows.
 */
export function moveAtRefusalLine(
  r: MoveAtReport, who: string | null, at: string | null, to: string | null,
): string {
  const subject = who && at ? `${who}'s ${at} session` : who ? `${who}'s session` : at ? `The ${at} session` : 'That session';
  const still = `${subject} has not moved and is still booked as it was.`;
  const target = to ? `${to} ` : 'That time ';
  switch (r.reason) {
    case 'clash-booked':
      return `${target}already has a session of yours booked across it. ${still} Pick another time.`;
    case 'clash-blocked':
      return `${target}is inside time you marked as unavailable. ${still} Pick another time, or unblock it first.`;
    case 'clash-class':
      return r.className
        ? `You are down to teach ${r.className} across ${to ?? 'that time'}. ${still} Pick another time.`
        : `You are down to teach a class across ${to ?? 'that time'}. ${still} Pick another time.`;
    case 'clash':
      return `Something of yours landed across ${to ?? 'that time'} while this was being sent, so the hour is no `
        + `longer free. ${still} Pull down to refresh and pick another time.`;
    case 'already-started':
      return `That session has already begun, so there is nothing to move. ${still} Mark what happened instead.`;
    case 'past':
      return `${target}has already passed. ${still} Pick a time still ahead of now.`;
    case 'not-yours':
      return `${still} It may have been cancelled or moved from the client's own phone since this screen loaded. `
        + 'Pull down to refresh and look again.';
    case 'bad-time':
      return `${target}was not a time the server would accept, so nothing was changed. ${still} Pick another time.`;
    case 'unreachable':
    default:
      return `The move did not reach the server, so it may or may not have happened. Do not tell `
        + `${who ?? 'the client'} anything yet. Pull down to refresh and check where the session is before trying again.`;
  }
}

/**
 * The confirm in front of a move to a time the coach had not opened.
 *
 * One sentence more than the open-slot confirm next to it, and the extra
 * sentence is the whole difference between the two acts: this one PUTS A NEW
 * HOUR IN THE DIARY. A coach who does not know that will not know to look for
 * it, and the two facts after it are the server's — part 1830 writes nothing to
 * `charges` and carries the credit rather than drawing a second one.
 */
export function moveAtConfirmBody(who: string, from: string, to: string, inHours: boolean): string {
  return `${who} moves from ${from} to ${to}.\n\n`
    + `${to} is not one of your open slots, so this puts the session straight into your diary at that time. `
    + (inHours ? '' : 'It is outside the working hours you have set for that day. ')
    + 'Nothing is charged and no session comes off their pack — it is the same session at a different time. '
    + `${from} goes back on your calendar, or straight to whoever is first in line for it. `
    + 'They are notified once it has moved.';
}
