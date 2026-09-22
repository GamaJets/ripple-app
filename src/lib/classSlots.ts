// Which slots on the timetable work, and which do not.
//
// ── The gap this fills ────────────────────────────────────────────────────
//
// app/(owner)/class-analytics.tsx reads every class in a range — per class,
// branch, trainer and START TIME — and groups it two ways: by branch and by
// kind. It never groups by WHEN, which is the first question every other
// product in this market answers for a gym owner on a phone, and the one an
// owner is actually trying to settle when they open a class report: which hours
// of which days are full, which are running half empty, and what should be cut
// or duplicated.
//
// Nothing new is read for it. `ClassSummaryRow.startsAt` is already in hand and
// the gym's timezone is already fetched on the same screen (for `fetchClassPay`)
// — it was simply consumed inline and thrown away.
//
// ── Why this is a timezone question and not a formatting one ──────────────
//
// `gymWeekday` in src/lib/gymZone.ts was written for exactly this grouping, and
// its own header says why: a 06:00 class bucketed on the reader's clock "either
// splits into two buckets side by side or merges with the 07:00 one, so the fill
// rate the grouping exists to compute is taken over the wrong set of classes,
// and 'Tuesday 06:00 Spin is half empty' becomes something an owner abroad sees
// and an owner at the gym does not."
//
// So both `gymWeekday` and `gymHour` are used as they are: they return NULL for
// a missing, blank or unrecognised zone rather than falling back to the device.
// A row that cannot be placed on the gym's clock is counted as unplaced and
// reported — it is never dropped into a bucket, and it is never dropped
// silently. At a gym that has not set a timezone every row is unplaced, the
// slot list is empty, and the difference between that and "no classes ran" is
// the whole of what `unplaced` exists to say.
//
// ── Two rules inherited rather than reinvented ───────────────────────────
//
// · A FILL RATE IS OVER THE SAME ROWS ON BOTH SIDES. `summariseClassRows` in
//   src/lib/classRates.ts carries the scar: capacity added `r.capacity || 0` so
//   a class with no capacity recorded contributed nothing to the denominator,
//   while `booked` added every row — and the owner screen printed "Avg Fill
//   117%". Here the denominator and the numerator are both taken over the rows
//   that recorded a capacity, and a slot where none did has `fill: null`, not 0.
//
// · A CLASS WITH NOTHING TICKED IS NOT A CLASS NOBODY CAME TO. `noPresent`
//   counts classes that had bookings and no attendance recorded, and it is
//   named for what the data says rather than for what it might mean: an empty
//   room and an untaken register are indistinguishable in this table, and
//   collapsing them into "nobody turned up" would tell an owner to cut a class
//   that is full of people whose coach does not use the tick.
//
// Pure: rows and a zone string in, a ranked list and two counts out. No
// storage, no supabase, no Date.now(), so `npm test` reaches all of it and the
// caller decides what to draw.
import { gymWeekday, gymHour } from './gymZone';
// `WEEK_DAYS` is indexed by COLUMN in the drawn week, not by `getDay()` value —
// the two coincide only while `WEEK_STARTS_ON` is 0, and a project that moves it
// to Monday would otherwise silently relabel every slot here by one day without
// a single test failing. `dayIndexInWeek` is the conversion that already exists
// for exactly this, so it is used rather than the coincidence.
import { WEEK_DAYS, dayIndexInWeek } from './weekStart';
import type { ClassSummaryRow } from './classRates';

/** One recurring slot on the timetable — a weekday and an hour at the gym,
 *  with every class that ran in it across the range folded together. */
export interface ClassSlot {
  /** 0–6 as `Date#getUTCDay` numbers them, Sunday first, AT THE GYM. */
  weekday: number;
  /** 0–23 at the gym. The bucket is the hour, not the exact minute: an 18:00
   *  and an 18:15 class are the same evening slot to an owner deciding what to
   *  run, and splitting them would put one class in each bucket. */
  hour: number;
  /** 'Tue 18:00'. Built here so the screen and any other reader cannot come to
   *  label the same bucket two ways. */
  label: string;
  /** How many classes ran in this slot across the range. */
  classes: number;
  /** Places, over the classes in this slot that RECORDED a capacity. */
  capacity: number;
  /** Bookings, over those same classes — the denominator's own rows. */
  bookedOfPriced: number;
  /** Bookings over every class in the slot, capacity recorded or not. A total
   *  in its own right, and never a fill numerator. */
  booked: number;
  attended: number;
  /** `bookedOfPriced / capacity`, or null where no class in this slot recorded
   *  what it could hold. Null is not 0: a slot with no capacity on record has
   *  no proportion of it filled. */
  fill: number | null;
  /** Classes in this slot that had bookings and nobody marked present. See the
   *  header: this is what the data says, not "nobody came". */
  noPresent: number;
}

export interface SlotBreakdown {
  /** Ranked. See `rankSlots` for the order and why it is that one. */
  slots: ClassSlot[];
  /**
   * Classes that could not be placed on the gym's clock, and are therefore in
   * NO slot above.
   *
   * Non-zero for one of two reasons and the caller says which: the gym has not
   * set a timezone (or its read failed), in which case this is every class in
   * the range; or a row carried a `startsAt` that would not parse. Either way
   * the figure is a named unknown rather than an absence — a slot list that
   * quietly omitted them would under-report exactly the hours nobody is
   * looking at.
   */
  unplaced: number;
  /** Classes across the WHOLE range — placed or not — that had bookings and
   *  nobody marked present. Counted over every row, because whether a register
   *  was taken has nothing to do with whether the clock could be read. */
  noPresent: number;
  /** Classes considered. `slots` sums to `classes - unplaced`. */
  classes: number;
}

/** 'Tue 18:00' — the weekday's short name and the hour, zero-padded.
 *
 *  `weekday` is a `getDay()`/`getUTCDay()` value, which is what `gymWeekday`
 *  returns; `dayIndexInWeek` turns it into the column `WEEK_DAYS` is keyed by. */
export function slotLabelFor(weekday: number, hour: number): string {
  const day = WEEK_DAYS[dayIndexInWeek(weekday)] ?? '—';
  return `${day} ${String(hour).padStart(2, '0')}:00`;
}

/**
 * Fold a range of classes into the recurring slots they ran in, at the gym's
 * own clock.
 *
 * `zone` is `tenants.timezone`. Null, blank or unrecognised means every row is
 * unplaced — deliberately, and see the header: bucketing on the reader's device
 * would put a Gulf gym's 06:00 class in a London owner's 02:00 bucket and
 * report a fill rate over the wrong set of classes.
 */
export function classSlots(
  rows: readonly ClassSummaryRow[] | null | undefined,
  zone: string | null | undefined,
): SlotBreakdown {
  const list = rows ?? [];
  const by = new Map<string, ClassSlot>();
  let unplaced = 0;
  let noPresent = 0;

  for (const r of list) {
    // Counted over every row, placed or not. Whether somebody ticked a register
    // is not a fact about the clock.
    const blank = r.booked > 0 && r.attended === 0;
    if (blank) noPresent += 1;

    const weekday = gymWeekday(r.startsAt, zone);
    const hour = gymHour(r.startsAt, zone);
    // Both, not either. A row with one and not the other cannot be labelled, and
    // a half-placed class in a bucket is worse than one counted as unplaced.
    if (weekday == null || hour == null) { unplaced += 1; continue; }

    const key = `${weekday}:${hour}`;
    const slot = by.get(key) ?? {
      weekday, hour, label: slotLabelFor(weekday, hour),
      classes: 0, capacity: 0, bookedOfPriced: 0, booked: 0, attended: 0,
      fill: null, noPresent: 0,
    };
    slot.classes += 1;
    slot.booked += r.booked;
    slot.attended += r.attended;
    if (blank) slot.noPresent += 1;
    // The fill denominator and its numerator, taken over the same rows. A class
    // that never recorded what it could hold is in neither.
    if (typeof r.capacity === 'number' && r.capacity > 0) {
      slot.capacity += r.capacity;
      slot.bookedOfPriced += r.booked;
    }
    by.set(key, slot);
  }

  const slots = [...by.values()];
  for (const s of slots) s.fill = s.capacity > 0 ? s.bookedOfPriced / s.capacity : null;

  return { slots: rankSlots(slots), unplaced, noPresent, classes: list.length };
}

/**
 * The order an owner reads these in.
 *
 * By fill, emptiest first, because the question this section exists to answer
 * is which slots to cut — a full slot needs no decision and a half-empty one
 * does. A slot with no fill rate (nothing in it recorded a capacity) sorts
 * LAST rather than first: it is not the emptiest slot, it is the one nothing is
 * known about, and putting it at the top of a list headed by its emptiest
 * entries would read as a verdict.
 *
 * Ties break on bookings, descending, so of two equally empty slots the busier
 * one — the one with more people to move — is the one an owner sees first, and
 * then on the label, so the order is stable across reads rather than left to
 * whatever the Map happened to hold.
 */
export function rankSlots(slots: readonly ClassSlot[]): ClassSlot[] {
  return [...slots].sort((a, b) => {
    if (a.fill == null && b.fill == null) return cmpTail(a, b);
    if (a.fill == null) return 1;
    if (b.fill == null) return -1;
    if (a.fill !== b.fill) return a.fill - b.fill;
    return cmpTail(a, b);
  });
}

function cmpTail(a: ClassSlot, b: ClassSlot): number {
  if (a.booked !== b.booked) return b.booked - a.booked;
  if (a.weekday !== b.weekday) return a.weekday - b.weekday;
  return a.hour - b.hour;
}

/**
 * What the section says about the classes it could not place, or null when
 * there are none.
 *
 * Three sentences and not one, because the three silences send an owner to
 * three different places. A gym with no timezone set has a setting to change; a
 * gym whose zone read was refused has nothing to change and should not be sent
 * to change it; and a handful of unparseable start times at a gym whose clock is
 * known is a data problem in those rows rather than in the gym's setup.
 *
 * `zoneUnread` is `fetchGymZone`'s own distinction — `{ zone: null, error: null }`
 * is a gym that has not said, `{ error }` is a read that did not come back — and
 * it is passed through rather than inferred, for the reason equipment.tsx and
 * rota.tsx both spell out: "this gym has not set a timezone" is an instruction
 * to change a setting that may already be right.
 */
export function unplacedNote(
  b: SlotBreakdown,
  zone: string | null | undefined,
  zoneUnread: boolean,
): string | null {
  if (b.unplaced <= 0) return null;
  const n = b.unplaced;
  const cls = `${n} class${n === 1 ? '' : 'es'}`;
  if (zoneUnread) {
    return `This gym’s timezone could not be read, so ${cls} could not be placed on the gym’s clock `
      + 'and none of them are counted below. That is a read that did not come back, not a gym with no '
      + 'timezone set. Nothing about the timetable has changed.';
  }
  if (!zone) {
    return `This gym has not set a timezone, so ${cls} could not be placed on the gym’s clock and none `
      + 'of them are counted below. Times bucketed on this phone’s clock would put an early class in '
      + 'the wrong hour for anybody reading from another country. Set it in Operations.';
  }
  return `${cls} could not be placed on the gym’s clock because ${n === 1 ? 'its start time' : 'their start times'} `
    + `could not be read, so ${n === 1 ? 'it is' : 'they are'} not counted below. Everything else here is complete.`;
}
