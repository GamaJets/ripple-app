// "I work Tuesdays 7am to 7pm" — said once, instead of forty-eight times.
//
// ── Why the availability table is empty ───────────────────────────────────
//
// `useAvailability().addSlot(dow, hour, minute, dur)` adds ONE slot. The sheet
// on the coach's calendar is built around it: pick a day, pick an hour, pick a
// quarter, pick a length, add. To offer 07:00–19:00 in fifteen-minute slots a
// coach taps that forty-eight times for one day, and three hundred and thirty-
// six times for a week.
//
// Nobody has. This database holds eight coach accounts, ten coaching
// relationships, zero rows in `trainer_availability` and zero rows in
// `sessions`. The first step of the entire personal-training loop has never
// once been completed by a real person — not because it is hidden, but because
// what it asks for is unreasonable.
//
// So the unit a coach thinks in — a stretch of the day they are available —
// becomes the unit they enter, and this module turns one into the many the
// schema stores.
//
// ── Why the range is expanded here and not stored as a range ──────────────
//
// A range is the better thing to TYPE and the worse thing to STORE. Every
// consumer of `trainer_availability` — `run_open_slot_extension` in part 650,
// `generateSlots` on the calendar, the duplicate check in `addSlot`, the unique
// index — works on discrete (dow, hour, minute) rows, and a slot is the thing a
// client books. Storing ranges would mean teaching all of that to subtract a
// booking from the middle of a stretch, which is how you end up with a coach
// available 07:00–19:00 except 11:15–11:30 and no honest way to write it down.
//
// Expanding on entry also keeps the coach's edit reversible in the way they
// expect: they can delete the one 11:15 they changed their mind about without
// the other forty-seven moving.
import { WEEK_DAYS } from './weekStart';

/** One slot, in the shape `addSlot` takes. */
export interface RangeSlot {
  dow: number;
  hour: number;
  minute: number;
  dur: number;
}

export interface RangeInput {
  /** Days of the week this range applies to. 0 = Sunday, per WEEK_STARTS_ON. */
  days: readonly number[];
  /** Minutes from midnight. 7am is 420. */
  fromMin: number;
  /** Minutes from midnight, exclusive — the moment the last slot ENDS. */
  toMin: number;
  /** How long one session is. */
  durationMin: number;
  /**
   * Dead time between the end of one slot and the start of the next. Zero is a
   * back-to-back day and is the default, because a coach who wants a gap says
   * so and a coach who does not should not have to.
   */
  gapMin?: number;
}

/**
 * The most availability rows a coach may hold in total.
 *
 * This is `ROW_CAP` from src/lib/rowCap.ts, restated as a number rather than
 * imported so this module stays free of the read layer — and it is the only
 * ceiling that is real. `trainer_availability` is read under that cap, so a
 * week past it comes back `partial` and the screen correctly refuses to call
 * it whole.
 *
 * The first version of this file capped ONE RANGE at 300, reasoning from a
 * comment that called 168 slots "the absolute most". That was wrong in the
 * direction that matters: seven days of 07:00-19:00 in quarter-hours is 336,
 * which is an entirely ordinary thing for a busy coach to offer, and it was
 * refused outright.
 *
 * The largest week that can physically exist is seven days of twenty-four
 * hours in quarter-hours: 672. That is comfortably under 1000, so NO legal
 * combination of days, times and lengths can breach this. It is kept as a
 * backstop against a caller passing nonsense, not as a limit anybody meets.
 */
export const MAX_WEEK_SLOTS = 1000;

/** The largest week that can exist: 7 days x 24h in quarter-hours. Asserted in
 *  the tests as being under MAX_WEEK_SLOTS, so the cap can never start
 *  refusing a real week without a test going red. */
export const LARGEST_POSSIBLE_WEEK = 7 * 24 * 4;

/** The longest a single session may be. Beyond this the coach has almost
 *  certainly typed the end time into the duration box. */
export const MAX_DURATION_MIN = 480;

const HHMM = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * How many slots this range would produce, without building them.
 *
 * Separate from `expandRange` so a screen can put the number on the button
 * before the coach presses it — "Add 48 slots" is a different decision from
 * "Add", and it is the one place this feature can surprise somebody.
 */
export function rangeSlotCount(r: RangeInput): number {
  const step = r.durationMin + Math.max(0, r.gapMin ?? 0);
  if (step <= 0 || r.durationMin <= 0) return 0;
  const span = r.toMin - r.fromMin;
  if (span < r.durationMin) return 0;
  // The last slot must END by `toMin`, so what matters is how many whole
  // sessions fit — not how many step boundaries there are. A 07:00–08:00 range
  // of 45-minute sessions is ONE slot, not two: the second would run to 09:30.
  let n = 0;
  for (let at = r.fromMin; at + r.durationMin <= r.toMin; at += step) n++;
  return n * Math.max(0, new Set(r.days).size);
}

/**
 * Why this range cannot be added, or null when it can.
 *
 * Every one of these is a refusal a coach can act on, and each names the number
 * that is wrong rather than saying "invalid".
 */
export function rangeBlocker(r: RangeInput, alreadyHeld = 0): string | null {
  const days = new Set(r.days);
  if (days.size === 0) return 'Pick at least one day.';
  for (const d of days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) return 'One of those days is not a day of the week.';
  }
  if (!Number.isFinite(r.fromMin) || !Number.isFinite(r.toMin)) return 'Set a start and an end time.';
  if (r.fromMin < 0 || r.toMin > 24 * 60) return 'Times have to fall inside one day.';
  if (r.toMin <= r.fromMin) {
    // Named rather than swapped. A coach who typed 19:00 to 07:00 may have meant
    // an overnight shift, which this cannot express, and silently reversing it
    // would give them 07:00–19:00 — twelve hours they did not offer.
    return `${HHMM(r.toMin)} is not after ${HHMM(r.fromMin)}. A stretch that runs past midnight has to be added as two.`;
  }
  if (!Number.isFinite(r.durationMin) || r.durationMin <= 0) return 'Set how long one session is.';
  if (r.durationMin > MAX_DURATION_MIN) {
    return `A single session of ${r.durationMin} minutes is longer than this will add. Check you have not typed the end time in the length box.`;
  }
  if ((r.gapMin ?? 0) < 0) return 'A gap cannot be negative.';

  const span = r.toMin - r.fromMin;
  if (span < r.durationMin) {
    return `${HHMM(r.fromMin)} to ${HHMM(r.toMin)} is ${span} minutes, which is not long enough for one ${r.durationMin}-minute session.`;
  }
  const n = rangeSlotCount(r);
  if (n === 0) return 'That range produces no slots.';
  // Counted against what the coach ALREADY holds, because the ceiling is on the
  // week and not on one gesture. Unreachable for any real week — see the note
  // on MAX_WEEK_SLOTS — and kept so a caller passing nonsense is refused with a
  // sentence rather than silently writing a week nothing can read whole.
  if (alreadyHeld + n > MAX_WEEK_SLOTS) {
    return `That would take your weekly hours to ${alreadyHeld + n} slots, and Repple cannot read a week longer than ${MAX_WEEK_SLOTS} in one go. `
      + 'Make the sessions longer, or remove some hours you no longer offer.';
  }
  return null;
}

/**
 * The slots, in the order a person reads a week: day, then time.
 *
 * Returns an empty array for anything `rangeBlocker` refuses, so a caller that
 * forgets to check gets nothing rather than something wrong.
 */
export function expandRange(r: RangeInput, alreadyHeld = 0): RangeSlot[] {
  if (rangeBlocker(r, alreadyHeld)) return [];
  const step = r.durationMin + Math.max(0, r.gapMin ?? 0);
  const out: RangeSlot[] = [];
  for (const dow of [...new Set(r.days)].sort((a, b) => a - b)) {
    for (let at = r.fromMin; at + r.durationMin <= r.toMin; at += step) {
      out.push({ dow, hour: Math.floor(at / 60), minute: at % 60, dur: r.durationMin });
    }
  }
  return out;
}

/**
 * What the range does NOT cover, when the arithmetic does not come out even.
 *
 * 07:00–19:00 in fifty-minute sessions leaves the last twenty minutes unused,
 * and a coach who set an end time of 19:00 will read the last slot ending at
 * 18:40 as a bug unless somebody says otherwise. Null when it divides exactly.
 */
export function remainderNote(r: RangeInput): string | null {
  if (rangeBlocker(r)) return null;
  const step = r.durationMin + Math.max(0, r.gapMin ?? 0);
  let last = r.fromMin;
  for (let at = r.fromMin; at + r.durationMin <= r.toMin; at += step) last = at + r.durationMin;
  const left = r.toMin - last;
  if (left <= 0) return null;
  // `left` is measured to the end of the window, but the fit test is
  // `duration + gap` — so with 55 minutes left, a 50-minute session and a
  // 10-minute gap, the sentence read "the remaining 55 minutes is not long
  // enough for another 50-minute session". It plainly is; the gap is the
  // obstacle, and a coach reading that would shorten the session rather than
  // the gap and find nothing had changed.
  const gap = r.gapMin || 0;
  const needed = r.durationMin + gap;
  if (gap > 0 && left >= r.durationMin) {
    return `The last session ends at ${HHMM(last)}. The remaining ${left} minute${left === 1 ? '' : 's'} `
      + `would fit another ${r.durationMin}-minute session but not the ${gap}-minute gap before it `
      + `(${needed} minutes are needed), so nothing is offered then.`;
  }
  return `The last session ends at ${HHMM(last)}. The remaining ${left} minute${left === 1 ? '' : 's'} `
    + `is not long enough for another ${r.durationMin}-minute session, so nothing is offered then.`;
}

/**
 * Which of these slots the coach already offers.
 *
 * Duplicates are counted and skipped, never added and never treated as an
 * error. A coach extending Tuesday from 07:00–12:00 to 07:00–19:00 re-enters
 * the morning by definition, and refusing the whole range for it — which is
 * what the server's unique index would do to each row individually — would make
 * the obvious gesture the one that fails.
 */
export function splitAgainstExisting(
  slots: readonly RangeSlot[],
  existing: readonly { dow: number; hour: number; minute: number }[],
): { fresh: RangeSlot[]; duplicates: number } {
  const have = new Set(existing.map((e) => `${e.dow}:${e.hour}:${e.minute}`));
  const fresh: RangeSlot[] = [];
  let duplicates = 0;
  for (const s of slots) {
    if (have.has(`${s.dow}:${s.hour}:${s.minute}`)) { duplicates++; continue; }
    fresh.push(s);
  }
  return { fresh, duplicates };
}

/** What the button says, so the count is a decision and not a surprise. */
export function addButtonLabel(fresh: number, duplicates: number): string {
  if (fresh === 0 && duplicates > 0) return 'You already offer all of these';
  if (fresh === 0) return 'Nothing to add';
  return `Add ${fresh} slot${fresh === 1 ? '' : 's'}`;
}

/** A plain summary of what is about to happen, for the line under the button. */
export function rangeSummary(r: RangeInput, fresh: number, duplicates: number): string | null {
  if (rangeBlocker(r)) return null;
  const dayNames = [...new Set(r.days)].sort((a, b) => a - b).map((d) => WEEK_DAYS[d]).join(', ');
  const head = `${HHMM(r.fromMin)}–${HHMM(r.toMin)} on ${dayNames}, in ${r.durationMin}-minute sessions.`;
  if (duplicates === 0) return head;
  if (fresh === 0) {
    return `${head} You already offer every one of these, so nothing would change.`;
  }
  return `${head} ${duplicates} of them you already offer and ${duplicates === 1 ? 'it will be' : 'they will be'} left alone.`;
}

/**
 * What happened, counted from what the server actually accepted.
 *
 * `saved` is how many writes came back confirmed — NOT how many were attempted.
 * `addSlot` returns `'local'` for a row that never reached the server, and a
 * coach told "48 slots added" over twelve that landed has a week their clients
 * cannot see three quarters of.
 */
export function addOutcome(saved: number, attempted: number, duplicates: number): string {
  if (attempted === 0 && duplicates > 0) {
    return 'You already offered all of those times, so nothing was changed.';
  }
  if (saved === 0) {
    return `None of those ${attempted} slot${attempted === 1 ? '' : 's'} could be saved, so your clients cannot book any of them yet. `
      + 'They are not on this phone either — try again when you have a connection.';
  }
  const head = `${saved} slot${saved === 1 ? '' : 's'} added.`;
  const tail = duplicates > 0
    ? ` ${duplicates} you already offered ${duplicates === 1 ? 'was' : 'were'} left alone.`
    : '';
  if (saved === attempted) {
    return `${head}${tail} Open them for booking with Generate Open Slots.`;
  }
  const lost = attempted - saved;
  return `${head}${tail} ${lost} could not be saved and ${lost === 1 ? 'is' : 'are'} not offered to anybody — try again.`;
}
