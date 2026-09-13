// Two classes in one room at one time — the thing every scheduling product
// refuses and this one did not ask about.
//
// ── What was missing ──────────────────────────────────────────────────────
//
// app/(trainer)/calendar.tsx checks a PT booking against the classes the coach
// teaches before it writes one: `classClashes` in src/lib/booking.ts, with
// `classCheckCaveat` for the case where the timetable could not be read. The
// screen where classes are actually TYPED IN asked nothing. A coach adding
// "Tuesday 18:00 Reformer, Studio 2" over the Tuesday 18:00 Spin already in
// Studio 2 got no warning, the row was written, and both classes went on sale.
// Members booked both. The first anybody found out was when two rooms' worth
// of people arrived at one door.
//
// Repeat ×12 makes it twelve of those from one press.
//
// ── Why this is a warning and not a refusal ───────────────────────────────
//
// `gym_classes.room` is free text and always has been — the branch picker that
// preceded it offered six hardcoded Dubai locations and was removed for saying
// things about gyms that were not true. Free text means:
//
//   · a blank room is the ordinary case, not an error. A gym with one floor
//     does not name it. Nothing can be checked for those rows and this says so
//     rather than reporting them clear.
//   · "Studio 2" and "studio 2 " are one room to everybody who reads the
//     timetable, so the match is trimmed and folded — the same normalisation
//     `seriesKey` in ./classSeries.ts applies to the same fields, and for the
//     same reason.
//   · a big room legitimately runs two things at once. A gym that splits a hall
//     down the middle is not making a mistake, and a hard block would be this
//     module overruling somebody who can see the room and it cannot.
//
// So: the coach is told what is already in that room at that hour, by name and
// time, and decides. What this must never do is stay quiet.
//
// ── And never "clear" from a read that did not finish ─────────────────────
//
// The check runs over the rows the screen happens to be holding. Under
// 'partial' those are real but the far end of the timetable is missing, and
// under 'error' there are none at all — so an unchecked hour would come back
// looking exactly like a free one. `checkable` is false in both cases and
// `roomClashNote` says which, because silence here is the app asserting a room
// is free on the strength of a list it never received.
//
// Pure — no supabase, no react-native, no clock. Used only by
// app/(trainer)/classes.tsx.

/** One class as this module needs to see it. A structural subset of `GymClass`,
 *  so the screen passes its own rows straight in. */
export interface RoomSpan {
  id: string;
  title: string;
  startsAt: string;
  durationMin: number;
  branch: string;
  room: string;
  /**
   * `gym_classes.status`. A called-off class is not in the room.
   *
   * Optional, because `GymClass.status` is — a row that arrived without one is
   * a class that is ON, not a class in an unknown state, and `fold` turns the
   * absence into '' so it can never match 'cancelled'. Defaulting the other way
   * would quietly stop warning about every such row.
   */
  status?: string;
}

/** Why a room could not be checked, when it could not. */
export type RoomUncheckable =
  /** The class being typed in has no room recorded, so there is nothing to
   *  compare. Not a fault — most gyms do not name their one floor. */
  | 'no-room'
  /** The timetable itself was not read in full. The dangerous one. */
  | 'not-whole';

export interface RoomClash {
  /** What is already in that room across those hours, soonest first. Empty is
   *  only meaningful when `checkable` is true. */
  clashes: RoomSpan[];
  /** Whether the question was actually answered. False means `clashes` is empty
   *  because nothing was asked, NEVER because the room is free. */
  checkable: boolean;
  /** Null exactly when `checkable` is true. */
  reason: RoomUncheckable | null;
}

/** Free text folded to the thing a human reads. Blank stays blank. */
function fold(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase();
}

/** Start and end of a span in ms, or null when the start will not parse. A row
 *  whose date is unreadable is not silently treated as sitting at epoch. */
function spanOf(startsAt: string, durationMin: number): { from: number; to: number } | null {
  const from = Date.parse(startsAt);
  if (!Number.isFinite(from)) return null;
  // A missing or nonsense duration is not zero minutes, which would make the
  // span a point and overlap nothing. Zero-length spans cannot clash, and a
  // class that cannot clash is the wrong answer to give about a real booking,
  // so an unreadable duration is widened to nothing and the row is skipped by
  // the caller instead of being reported clear.
  const mins = Number(durationMin);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return { from, to: from + mins * 60_000 };
}

/** Half-open overlap: back-to-back classes do not clash. An 18:00–19:00 and a
 *  19:00–20:00 in the same room are a timetable, not a collision. */
function overlaps(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  return a.from < b.to && b.from < a.to;
}

/**
 * What is already in `room` at `branch` across every instant in `starts`.
 *
 * `starts` is a list because Repeat writes a term in one press, and a clash on
 * week nine is as real as one on week one — checking only the first occurrence
 * would clear a run that collides eleven times.
 *
 * `whole` is the caller's own read status, already decided (`isWhole(status)`).
 * It is a required argument rather than an optional one so that a caller cannot
 * get a clean answer by forgetting to say whether they had the whole timetable.
 */
export function roomClashesFor(
  starts: readonly string[],
  durationMin: number,
  branch: string,
  room: string,
  classes: readonly RoomSpan[],
  whole: boolean,
): RoomClash {
  if (!whole) return { clashes: [], checkable: false, reason: 'not-whole' };
  const wantRoom = fold(room);
  if (!wantRoom) return { clashes: [], checkable: false, reason: 'no-room' };
  const wantBranch = fold(branch);

  const mine = starts
    .map((s) => spanOf(s, durationMin))
    .filter((x): x is { from: number; to: number } => x !== null);
  // Every proposed instant was unreadable, so nothing was compared. Reported as
  // unchecked rather than clear — this is the same rule as `not-whole`, arriving
  // from the caller's side instead of the server's.
  if (!mine.length) return { clashes: [], checkable: false, reason: 'not-whole' };

  const hit = classes.filter((c) => {
    // A called-off class has vacated the room. `restoreClass` can put it back,
    // and a coach who restores one into an hour something else now occupies is
    // making a different decision on a different screen.
    if (fold(c.status) === 'cancelled') return false;
    if (fold(c.room) !== wantRoom) return false;
    if (fold(c.branch) !== wantBranch) return false;
    const theirs = spanOf(c.startsAt, c.durationMin);
    if (!theirs) return false;
    return mine.some((m) => overlaps(m, theirs));
  });

  return {
    clashes: hit.slice().sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    checkable: true,
    reason: null,
  };
}

/**
 * What to put in front of the coach, or null when there is nothing to say.
 *
 * Null for a clean, checked answer — a "no clashes" banner on every class added
 * is furniture, and the one time it matters it gets skimmed past with the rest.
 * Null also for 'no-room', which is the ordinary state of a gym with one floor
 * and not something to nag about.
 *
 * `when` renders one clashing class's time in the reader's own locale; it is
 * passed in rather than built here so this module keeps no clock and no locale
 * of its own, and so the sentence reads in the same format as the rows above it.
 */
export function roomClashNote(r: RoomClash, room: string, when: (iso: string) => string): string | null {
  if (!r.checkable) {
    return r.reason === 'not-whole'
      ? 'Your timetable could not be read in full, so this was NOT checked against the classes already in that room. That is a connection problem and not an empty room.'
      : null;
  }
  if (!r.clashes.length) return null;
  const named = r.clashes.slice(0, 3)
    .map((c) => `${c.title} at ${when(c.startsAt)}`)
    .join(', ');
  const rest = r.clashes.length > 3 ? `, and ${r.clashes.length - 3} more` : '';
  const n = r.clashes.length;
  return `${room.trim()} already has ${n === 1 ? 'a class' : `${n} classes`} across ${n === 1 ? 'that hour' : 'those hours'}: ${named}${rest}. `
    + `Both would be on sale and members could book either, so two rooms' worth of people would arrive at one door.`;
}
