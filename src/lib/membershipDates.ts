// Correcting the two dates a membership runs between.
//
// ── what this is for ──────────────────────────────────────────────────────
//
// `createMembership` writes `started_on` from whatever the caller hands it,
// and the owner app's caller hands it TODAY, every time, with no field on the
// screen. That is right for somebody joining at the desk and wrong for the
// other thing a gym does with this product on day one: type in the members it
// already has. A gym migrating four hundred people files all four hundred as
// having joined the afternoon the owner sat down with the phone.
//
// Nothing downstream recovers from that. Tenure is measured from
// `started_on`, so is cohort retention, so is the billing anniversary, and so
// is the ageing on /accounting. `setMembershipDates` has existed in
// src/lib/gymRecord.ts since the console grew the field; this module is the
// half that decides what may be written and what has to be said out loud
// first, so that the phone and the console cannot come to two different
// answers about the same two dates.
//
// ── why the notes are not refusals ────────────────────────────────────────
//
// Only three things here are actually wrong: an unreadable day, an unreadable
// end, and an end before the start. Everything else an owner might do with
// these fields is legitimate for SOME gym — a membership that ended last
// month is exactly what a migrated record looks like, and a start date in the
// future is a pre-sold January — so the rest is said rather than blocked.
// `classCancel.ts` takes the same position about a gym's own policy.
//
// Pure. One value import — the codebase's single reader for "is this a day" —
// and one type, which is erased.
import { isStartDate } from './programStart';
import { frozenDays } from './membershipFreeze';
import { addDays } from './termDates';
import type { MembershipStatus } from './gymRecord';

/** A bare `YYYY-MM-DD`, or nothing. Compared as a string throughout — no Date
 *  is constructed in this file, so nothing here can move a day by a timezone.
 *  Same rule, and the same reason, as src/lib/membershipFreeze.ts. */
type Day = string | null | undefined;

/**
 * `isStartDate` and not a regexp of this file's own.
 *
 * A `^\d{4}-\d{2}-\d{2}$` test — which is what the freeze module still uses,
 * over dates a person picks from a calendar grid — accepts '2025-13-40'. These
 * two dates are the ones the whole product measures tenure and renewals from,
 * and they can arrive from the typed field inside `DateSheet` as well as from
 * the grid, so the check here round-trips the day rather than matching its
 * shape. See the header of `isStartDate` for the February 30th it refuses.
 */
const isDay = (v: Day): v is string => typeof v === 'string' && isStartDate(v);

/** The two dates as a row holds them, and the three other facts about the row
 *  that change what a correction MEANS. */
export interface MembershipTerm {
  startedOn: Day;
  endsOn: Day;
  frozenFrom: Day;
  frozenTo: Day;
  status: MembershipStatus;
}

/** The two dates as the screen holds them while they are being edited. An
 *  empty end is open-ended, which is a state the schema has always had and is
 *  not the same as expired. */
export interface DraftDates {
  startedOn: Day;
  endsOn: Day;
}

/** Exactly what `setMembershipDates` takes: present-or-absent, because absent
 *  means "leave it alone" and `endsOn: null` means "open-ended". */
export interface DatesPatch {
  startedOn?: string;
  endsOn?: string | null;
}

/**
 * Why these two dates will not do, or null when they will.
 *
 * A membership that starts and ends on the same day is allowed — that is a day
 * pass, and gyms sell them.
 */
export function datesRefusal(d: DraftDates): string | null {
  if (!isDay(d.startedOn)) {
    return 'Pick the day this membership began. Every tenure and renewal figure is measured from it, so it cannot be left empty.';
  }
  // An end is optional and an UNREADABLE end is not the same as no end. The
  // screen sends an empty field through as null on purpose; anything else in
  // there is a value that did not parse, and storing it would put every reader
  // of this row into the state `freezeState` calls 'unreadable'.
  if (d.endsOn != null && String(d.endsOn).trim() !== '' && !isDay(d.endsOn)) {
    return 'That end date could not be read. Leave it empty for a membership that runs until somebody stops it.';
  }
  if (isDay(d.endsOn) && d.endsOn < d.startedOn) {
    return 'It cannot end before it starts. Check which way round the two dates go.';
  }
  return null;
}

/**
 * What actually changed, in the shape the write takes — or null when nothing
 * did.
 *
 * Null is the important half. `setMembershipDates` RETURNS, without writing and
 * without throwing, when it is handed an empty patch; its own header says why.
 * A screen that reads "did not throw" as "saved" would then close the sheet,
 * reload, and show the owner the same wrong start date they just corrected,
 * with a success behind it. So the caller asks this first and refuses to send
 * nothing, which is the same rule as `assertWrote` one layer down: never say a
 * thing happened because no error was thrown.
 */
export function datesPatch(current: DraftDates, next: DraftDates): DatesPatch | null {
  const patch: DatesPatch = {};
  const curStart = isDay(current.startedOn) ? current.startedOn : null;
  if (isDay(next.startedOn) && next.startedOn !== curStart) patch.startedOn = next.startedOn;
  // Both ends normalised to "a day or null" before they are compared. A row
  // holding null and a field holding '' are the same membership — open-ended —
  // and comparing them raw sends `ends_on: null` over a row that already has
  // it, which is a write that changes nothing dressed up as a correction.
  const curEnd = isDay(current.endsOn) ? current.endsOn : null;
  const nextEnd = isDay(next.endsOn) ? next.endsOn : null;
  if (nextEnd !== curEnd) patch.endsOn = nextEnd;
  return Object.keys(patch).length ? patch : null;
}

/**
 * The end date with the pause ALREADY ON THIS ROW taken back off — the term as
 * it was sold.
 *
 * ── the compounding this exists to stop ───────────────────────────────────
 *
 * `thawedEndsOn` is `ends_on + the length of the pause`, and it knows nothing
 * about what is already inside `ends_on`. The header of `setMembershipFreeze`
 * in src/lib/gymRecord.ts is explicit that the shift is applied ONCE, by the
 * owner accepting it on the screen, precisely so that "a corrected pause would
 * compound instead of replace" cannot happen — and it then leaves the screen to
 * hold that line. `datesNotes` below states the same fact from the other side:
 * "the end date on this row is not the term that was sold; it is the term plus
 * the pause."
 *
 * app/(owner)/members.tsx was not holding it. Its pause sheet seeds itself from
 * `frozen_from` / `frozen_to` when a pause is already recorded, and then fed
 * `m.endsOn` — the ALREADY-MOVED date — straight back into `thawedEndsOn`. So
 * reopening the sheet on an existing pause and saving it, changed or unchanged,
 * pushed the end date out by the length of the pause a second time. A member
 * frozen 12–26 June on a membership ending 30 June correctly ran to 15 July;
 * one tap of Save Pause on that same sheet made it 30 July, and every further
 * tap added another fortnight. Nothing else in the product moves `ends_on`, so
 * nothing else would ever have contradicted it.
 *
 * Subtracting is the right inverse because this app is the ONLY writer of
 * `frozen_from` / `frozen_to` anywhere — the console does not have the field —
 * so a readable pause on a row with a readable end date is always a pause whose
 * days were added to that end date by this same screen.
 *
 * Null where there is nothing to work from: an open-ended membership has no
 * date to take days off, and one whose end date cannot be read is one this
 * cannot reason about. A row with NO readable pause is returned unchanged,
 * because there is nothing on it to remove — that is the first freeze, and the
 * case `thawedEndsOn` was always right about.
 */
export function unpausedEndsOn(
  current: Pick<MembershipTerm, 'endsOn' | 'frozenFrom' | 'frozenTo'>,
): string | null {
  if (!isDay(current.endsOn)) return null;
  const given = frozenDays({ from: current.frozenFrom, to: current.frozenTo });
  // No pause recorded, or one this build cannot read. Nothing was given back
  // that can be taken off again, and guessing at a quantity here would be the
  // same mistake in the other direction.
  if (given == null || given <= 0) return current.endsOn;
  return addDays(current.endsOn, -given);
}

/**
 * What the owner needs told before they save, in the order it matters.
 *
 * Empty when the correction speaks for itself. Each of these is a consequence
 * the field cannot show: something that will NOT happen, or something already
 * in the value being replaced.
 */
export function datesNotes(current: MembershipTerm, next: DraftDates, today: string): string[] {
  const patch = datesPatch(current, next);
  if (!patch) return [];
  const out: string[] = [];

  // ── the days a pause already gave back ─────────────────────────────────
  //
  // `thawedEndsOn` pushed `ends_on` out by the length of the pause when the
  // owner accepted it, and it did that ONCE, on purpose — see the header of
  // `setMembershipFreeze`. So the end date on this row is not the term that was
  // sold; it is the term plus the pause. Retyping it by hand overwrites both
  // halves at once, and the days the member was given back disappear with no
  // record anywhere that they ever existed. Said before the save, because
  // afterwards there is nothing left to notice.
  if (patch.endsOn !== undefined && isDay(current.frozenFrom) && isDay(current.frozenTo)) {
    out.push(
      'A pause is recorded on this membership, and the days it gave back are already inside the end date you are '
      + 'replacing. Whatever you type here becomes the whole term — add those days on yourself if they are still owed.',
    );
  }

  // ── a date is not a door ───────────────────────────────────────────────
  //
  // supabase/parts/2616 is deliberate about nothing changing `status` at
  // midnight, so an end date in the past sits beside a status of Active and the
  // turnstile reads the status. An owner who sets the end date to last month
  // and walks away believes they have ended the membership.
  const end = patch.endsOn !== undefined ? patch.endsOn : (isDay(current.endsOn) ? current.endsOn : null);
  const live = current.status === 'active' || current.status === 'frozen';
  if (live && isDay(end) && isDay(today) && end < today) {
    out.push(
      `This ends ${end}, which has already passed, and an end date does not close a membership by itself — the status `
      + `still says ${current.status === 'frozen' ? 'Frozen' : 'Active'}. Cancel it as well if that is what you mean.`,
    );
  }

  // ── what moves with the start date ─────────────────────────────────────
  //
  // Last, because it is the one that is merely true rather than a mistake
  // waiting to happen. It is here at all because the owner correcting a
  // migrated roster is doing it for exactly these figures, and a start date
  // moved by a day moves a billing anniversary with it.
  if (patch.startedOn !== undefined) {
    out.push(
      `Tenure, cohort retention and the billing anniversary are all measured from the start date, so all three move to ${patch.startedOn}.`,
    );
  }

  return out;
}

/**
 * One line for the row, saying what a membership's term is.
 *
 * Null when the start date cannot be read — which a migrated row can genuinely
 * hold, and which must not be printed as though it were a date.
 */
export function termLine(current: MembershipTerm): string | null {
  if (!isDay(current.startedOn)) return null;
  return isDay(current.endsOn)
    ? `${current.startedOn} to ${current.endsOn}`
    : `${current.startedOn}, open-ended`;
}
