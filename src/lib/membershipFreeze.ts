// Pausing a membership, with dates on it.
//
// ── what was already here, and what was not ───────────────────────────────
//
// `MembershipStatus` has included `'frozen'` since the beginning and
// `setMembershipStatus` can set it. What none of that has is DATES, and
// without them a freeze is three separate problems:
//
//   · Somebody has to remember to unfreeze it. Nobody does. A member comes
//     back from four weeks away, the status still says frozen, and the door
//     turns them away — or worse, it does not, and nobody can say what they
//     were entitled to.
//   · The member loses the time they paid for. A month's membership frozen
//     for two weeks is a month that ran for two weeks, and the end date sat
//     exactly where it was.
//   · Nothing can be arranged in advance. "I am away from the 12th" has to be
//     actioned ON the 12th, by a person, at a desk.
//
// So this module is about two dates and what follows from them. It decides
// nothing about access — `frozen` already means what it means at the door —
// and nothing about money.
//
// ── the end date moves, and that is the point ─────────────────────────────
//
// A freeze that does not extend the term is a cancellation with extra steps.
// `thawedEndsOn` is the arithmetic, and it is deliberately generous at the
// boundary: a freeze from the 12th to the 12th is ONE day, not zero, because
// that is a day the member could not train.
import { addDays } from './termDates';

/** A bare `YYYY-MM-DD`, or nothing. Compared as a string throughout — no Date
 *  is constructed here, so nothing can move a day by a timezone. */
type Day = string | null | undefined;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: Day): v is string => typeof v === 'string' && ISO.test(v);

/** Where a membership stands against its freeze dates today. */
export type FreezeState =
  /** No freeze recorded. */
  | 'none'
  /** A freeze that has not started yet. */
  | 'scheduled'
  /** Today is inside the freeze. */
  | 'frozen'
  /** The freeze has finished. The membership is running again. */
  | 'thawed'
  /** Dates are recorded and this build cannot read them. Never treated as
   *  'none': a membership whose freeze could not be read must not be described
   *  as one that was never frozen. */
  | 'unreadable';

export interface Freeze {
  from: Day;
  to: Day;
}

/**
 * Which of the five this membership is in, today.
 *
 * `today` is the GYM's day, not the reader's — a member and a front desk in
 * two zones must not disagree about whether a freeze has started. The caller
 * supplies it from `tenants.timezone` (see src/lib/gymZone.ts), which is the
 * same discipline every other gym-day figure in this codebase follows.
 */
export function freezeState(f: Freeze | null | undefined, today: string): FreezeState {
  if (!f || (f.from == null && f.to == null)) return 'none';
  if (!isDay(f.from) || !isDay(f.to) || !isDay(today)) return 'unreadable';
  // A backwards range is not a freeze, and guessing which end was meant is how
  // a member loses a month. Unreadable, and the screen says so.
  if (f.to < f.from) return 'unreadable';
  if (today < f.from) return 'scheduled';
  // Inclusive at both ends: the last day of a freeze is a day the member
  // could not train, so it is part of it.
  if (today <= f.to) return 'frozen';
  return 'thawed';
}

/**
 * How many days the freeze covers, both ends included. Null when it cannot be
 * read.
 *
 * Inclusive because a freeze from the 12th to the 12th is one day the member
 * could not use, not zero. Every gym's paperwork counts it that way and a
 * member counting the days they got back will too.
 */
export function frozenDays(f: Freeze | null | undefined): number | null {
  if (!f || !isDay(f.from) || !isDay(f.to) || f.to < f.from) return null;
  // Counted by walking bare dates through `addDays`, which is UTC-anchored and
  // is the one place in this codebase allowed to do this arithmetic. A
  // millisecond subtraction would be wrong twice a year: a fixed 86,400,000 is
  // not a day across a clock change, and these are calendar days.
  let n = 1;
  let cursor = f.from;
  // Bounded, because a typo'd year ('2206-06-12') would otherwise walk for two
  // hundred thousand iterations. The bound is three years and not one: this
  // function only COUNTS, and `freezeRefusal` is what decides a year is too
  // long. At 400 the count returned null for anything over about thirteen
  // months, so the refusal said "those dates could not be read" about a range
  // it understood perfectly well and should have called too long — which the
  // test caught.
  while (cursor < f.to && n <= 1100) {
    const next = addDays(cursor, 1);
    if (!next) return null;
    cursor = next;
    n += 1;
  }
  return cursor === f.to ? n : null;
}

/**
 * The end date after the frozen days are given back, or null when there is
 * nothing to move.
 *
 * Null for an open-ended membership — one with no `endsOn` runs until somebody
 * stops it, so there is no date to extend and pretending otherwise would
 * invent a term nobody sold. Null also when the freeze cannot be read, because
 * moving an end date on a range we do not understand is the one outcome worse
 * than not moving it.
 */
export function thawedEndsOn(endsOn: Day, f: Freeze | null | undefined): string | null {
  if (!isDay(endsOn)) return null;
  const days = frozenDays(f);
  if (days == null || days <= 0) return null;
  return addDays(endsOn, days);
}

/**
 * What to tell somebody about the freeze, in the words they would use.
 *
 * `endsOn` and `newEndsOn` are already formatted by the caller — this module
 * owns the sentence and not the date format, which belongs to
 * src/lib/format.ts and its locale.
 */
export function freezeLine(
  state: FreezeState,
  parts: { from?: string | null; to?: string | null; days?: number | null; newEndsOn?: string | null },
): string | null {
  const back = parts.days != null && parts.newEndsOn
    ? ` The ${parts.days === 1 ? 'day' : `${parts.days} days`} ${parts.days === 1 ? 'is' : 'are'} added back on the end, so it now runs to ${parts.newEndsOn}.`
    : '';
  switch (state) {
    case 'none':
      return null;
    case 'scheduled':
      return parts.from && parts.to
        ? `Paused from ${parts.from} to ${parts.to}.${back}`
        : 'A pause is recorded on this membership.';
    case 'frozen':
      return parts.to
        ? `Paused until ${parts.to}. It starts again by itself the day after.${back}`
        : 'Paused. It starts again by itself.';
    case 'thawed':
      return parts.to ? `The pause ended on ${parts.to} and this is running again.${back}` : null;
    case 'unreadable':
      // Never silence. A membership with dates this build cannot read is not a
      // membership that was never paused, and the difference is somebody's
      // access to a building.
      return 'A pause is recorded on this membership and the dates on it could not be read, so this app cannot say when it runs. Ask the gym before relying on it.';
  }
}

/**
 * Why a proposed freeze will not do, or null when it will.
 *
 * Only the mistakes a person can make with two dates. Everything else — can
 * this plan be frozen at all, how many freezes a year — is the gym's policy
 * and this app does not hold it, the same position `classCancel.ts` takes.
 */
export function freezeRefusal(from: Day, to: Day, today: string): string | null {
  if (!isDay(from) || !isDay(to)) return 'Pick both dates — the first day of the pause and the last.';
  if (to < from) return 'The last day is before the first. Tap the dates again in the other order.';
  if (isDay(today) && to < today) {
    return 'Those dates have already passed. A pause can only cover days that are still to come.';
  }
  const days = frozenDays({ from, to });
  if (days == null) return 'Those dates could not be read.';
  if (days > 365) return 'A pause longer than a year is not a pause. End the membership instead, and sell them a new one when they come back.';
  return null;
}
