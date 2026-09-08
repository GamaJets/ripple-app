// How long since a muscle was last trained — and nothing else, on purpose.
//
// ── The word this file will not say ────────────────────────────────────────
//
// "Recovered" is a claim about a person. It depends on how hard the session
// was, how well they slept, what they ate, how old they are, how long they have
// trained, whether they are ill, whether they are in a deficit, and on the
// individual muscle. This app measures none of those. What it has is a log of
// sets with timestamps on it.
//
// So there is no `recovered` boolean here, no readiness percentage, no green
// tick and no "ready to train" flag, and that absence is the feature rather
// than an omission. A Recovery Map that colours a chest green at 48 hours is
// making a physiological assertion about a member out of a subtraction of two
// timestamps, and it will make it identically for a set of light flyes and for
// a max-effort press to failure — with the additional problem that the person
// reading it may train through genuine injury because a screen told them they
// were ready.
//
// What this file returns is ELAPSED TIME SINCE THE LAST LOGGED SET, banded, and
// bounded. Every name in it says "rest" or "since", never "recovery" of a body.
// `REST_MEANS` below is the sentence a screen shows so a member is never left
// to supply the missing word themselves.
//
// The module is called muscleRecovery because the screen is called the Recovery
// Map and a file named for something else would be found by nobody. The
// distinction is held in the API, which is where it has to be held.
//
// ── The second thing it will not say: "never" ──────────────────────────────
//
// A muscle with nothing against it in a 30-day window has not been "never
// trained". It has not been trained IN THIRTY DAYS, which is a different and
// much smaller claim, and the first one is false for most people it would be
// shown to — this app has members with three years of history behind a window
// that reads ninety days of it.
//
// ── Bounds, which is the part that is easy to get wrong ────────────────────
//
// The elapsed figure is exact only when the read was whole AND the muscle was
// found. The other three cases each bound it in a different direction, and a
// screen that prints all four the same way is stating three things it does not
// know. See `RestBound`.
import { isWhole, type LoadStatus } from '../ui/loadStatus';
import type { MuscleWorkBoard, MuscleEffort } from './muscleWork';

/**
 * Which way an elapsed figure is uncertain.
 *
 *   'exact'   the read was whole and a set was found. `days` is the gap.
 *   'atMost'  the read was a prefix (see src/lib/rowCap.ts) and a set was
 *             found. A row that did not come back could be MORE recent, so the
 *             true gap is at most `days` — never longer, possibly shorter.
 *   'atLeast' the read was whole and no set in the window named this muscle.
 *             The true gap is at least the whole window, and may be years.
 *   'unknown' nothing can be said: the read failed, is still in flight, or came
 *             back as a prefix with no set found — in which case the muscle may
 *             have been trained yesterday and simply not be in the page.
 *
 * The last one is the reason this is four values and not a boolean. A truncated
 * read with no hit looks exactly like a muscle that has not been trained, and
 * reporting it as one is how a member gets told to train a muscle they worked
 * this morning.
 */
export type RestBound = 'exact' | 'atMost' | 'atLeast' | 'unknown';

/**
 * A band of ELAPSED TIME. Named for the clock, never for a state of the body.
 *
 * There is no 'fresh' and no 'fatigued' here for the reason in the header.
 * These are the divisions a person already uses when they talk about their own
 * week — today, yesterday, a couple of days, most of a week, longer — and each
 * one is a fact about the log that can be checked against it.
 */
export type RestBand =
  | 'today'
  | 'yesterday'
  | 'twoToThree'
  | 'fourToSix'
  | 'aWeekOrMore'
  | 'notInWindow'
  | 'unknown';

/**
 * Where the bands divide, in whole LOCAL calendar days.
 *
 * Exported and named because they are a display choice and somebody will want
 * to argue with them, which they can only do if they can find them. They are
 * NOT the 48-to-72-hour figure that gets quoted for muscle protein synthesis,
 * and they are deliberately not dressed up as it: adopting that number here
 * would smuggle the physiological claim back in through the thresholds after
 * the header refused it at the vocabulary. These are groupings of days.
 */
export const REST_BANDS = { yesterday: 1, twoToThree: 3, fourToSix: 6 } as const;

/** The sentence that goes with any rest figure this file produces. */
export const REST_MEANS =
  'This is the time since you last logged a set for this muscle. It is not a '
  + 'measure of how recovered you are — nothing here knows how hard the session '
  + 'was, how you slept, or how you feel.';

/** One muscle's elapsed time, with the direction of its uncertainty. */
export interface MuscleRest {
  /** The catalogue's own name, lowercased. */
  muscle: string;
  /**
   * Whole LOCAL calendar days between the last counted set and now. 0 is today.
   *
   * Calendar days rather than elapsed hours because that is the unit the answer
   * is read in: a set at 23:00 last night is "yesterday" nine hours later, and
   * "0 days" would be wrong in the only way that matters. `hours` is there for
   * anything that needs the raw gap.
   *
   * Under 'atLeast' this is the WINDOW, which is a lower bound on the gap.
   * Null under 'unknown', where there is no figure at all.
   */
  days: number | null;
  /** Elapsed hours, floored. Exact where `days` is banded. Null under
   *  'atLeast' and 'unknown': there is no instant to subtract from. */
  hours: number | null;
  band: RestBand;
  bound: RestBound;
  /** `YYYY-MM-DD` of the last counted set, or null. */
  lastDay: string | null;
  /**
   * Sets on that last day, so a screen can show what the muscle was asked to do
   * and not only when.
   *
   * Deliberately NOT combined with `days` into a single number. A score mixing
   * "three days ago" with "eleven sets" is a readiness index, it would be read
   * as one, and this file has already said why it will not produce one. Both
   * figures are here; the screen puts them side by side and the person decides.
   */
  lastDaySets: number | null;
  /** True when the artwork can draw this muscle. False ones still get a row —
   *  they are real work and belong in a list even when they cannot be a colour
   *  on a body. */
  drawn: boolean;
}

const DAY = 86_400_000;

/**
 * Whole LOCAL calendar days between two instants, DST-safe.
 *
 * Both ends are anchored at MIDDAY of their own local day before subtracting,
 * which is the trick `dayCursor` in src/lib/streaks.ts uses and for the same
 * reasons: a local day is 23 hours twice a year and 25 the other time, so
 * `(b - a) / 86400000` off midnight rounds to the wrong day on those two
 * mornings, and in Chile, Cuba and Lord Howe midnight itself does not exist on
 * one of them. Noon is twelve hours from either edge and no shift is that big,
 * so the difference of two noons is always a whole number of days after
 * rounding.
 */
function calendarDaysBetween(fromMs: number, toMs: number): number {
  const noon = (ms: number) => {
    const d = new Date(ms);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  };
  return Math.round((noon(toMs) - noon(fromMs)) / DAY);
}

/** Which band a whole number of days falls in. Never called for the two cases
 *  that have no gap to band. */
export function restBand(days: number): RestBand {
  if (days <= 0) return 'today';
  if (days <= REST_BANDS.yesterday) return 'yesterday';
  if (days <= REST_BANDS.twoToThree) return 'twoToThree';
  if (days <= REST_BANDS.fourToSix) return 'fourToSix';
  return 'aWeekOrMore';
}

/**
 * Elapsed time for one muscle, from a board and the muscle's row on it.
 *
 * `effort` is null when the muscle has no work in the window — which is not the
 * same as no work, and the bound says which.
 */
function restOf(board: MuscleWorkBoard, muscle: string, effort: MuscleEffort | null): MuscleRest {
  const drawn = effort?.drawn ?? false;
  // whole-ok: 'partial' does not travel in `board.status` here, it travels in
  // `board.isFloor` — and every branch below that could be wrong under it
  // consults that instead. The two questions this function asks are answered
  // separately: "how long since this muscle was trained" is safe under a
  // truncated read, because `capped()` returns the NEWEST sets and the newest
  // set is what a rest gap is measured from, so the gap is reported with
  // `bound: 'atMost'` rather than refused; "has this muscle not been trained at
  // all" is not safe, and `unusable || board.isFloor` refuses it outright and
  // returns 'unknown'. `restMap` below adds untouched muscles only under
  // `isWhole`. Folding 'partial' into `unusable` would throw away every rest gap
  // for a heavy trainer, which is the reader this map is drawn for.
  const unusable = board.status === 'error' || board.status === 'loading';
  if (!effort || effort.lastTrainedMs == null) {
    // No set found. Either the window genuinely contains none, or the page we
    // were handed does not contain the one that exists. Only the first of those
    // supports a sentence.
    if (unusable || board.isFloor) {
      return {
        muscle, days: null, hours: null, band: 'unknown', bound: 'unknown',
        lastDay: null, lastDaySets: null, drawn,
      };
    }
    const windowDays = Math.max(1, Math.round((board.nowMs - board.sinceMs) / DAY));
    return {
      muscle, days: windowDays, hours: null, band: 'notInWindow', bound: 'atLeast',
      lastDay: null, lastDaySets: null, drawn,
    };
  }
  if (unusable) {
    return {
      muscle, days: null, hours: null, band: 'unknown', bound: 'unknown',
      lastDay: effort.lastDay, lastDaySets: null, drawn,
    };
  }
  const days = Math.max(0, calendarDaysBetween(effort.lastTrainedMs, board.nowMs));
  const hours = Math.max(0, Math.floor((board.nowMs - effort.lastTrainedMs) / 3_600_000));
  return {
    muscle,
    days,
    hours,
    band: restBand(days),
    bound: board.isFloor ? 'atMost' : 'exact',
    lastDay: effort.lastDay,
    lastDaySets: effort.lastDaySets,
    drawn,
  };
}

/**
 * Rest for every muscle on the board, plus every muscle in the catalogue's
 * vocabulary that has none — but ONLY when that absence can be stated.
 *
 * The vocabulary rows are the whole point of a Recovery Map (the muscle you
 * have not touched is the one you want to see), and they are also the rows most
 * able to lie. `board.vocabulary` is null unless the catalogue read was whole,
 * and this refuses to invent a list when it is: a map missing its untouched
 * muscles is incomplete, and a map asserting a muscle is untouched off a
 * partial catalogue is wrong.
 *
 * Longest gap first, which is the order the screen is read in.
 */
export function restMap(board: MuscleWorkBoard): MuscleRest[] {
  const out: MuscleRest[] = [];
  const seen = new Set<string>();
  for (const e of board.muscles) {
    out.push(restOf(board, e.muscle, e));
    seen.add(e.muscle);
  }
  // Untouched muscles are added only when BOTH reads support the claim: the
  // catalogue read gives the list, and the log read has to be whole for "no set
  // named it" to mean anything at all.
  if (board.vocabulary && isWhole(board.status)) {
    for (const m of board.vocabulary) {
      if (seen.has(m)) continue;
      out.push(restOf(board, m, null));
    }
  }
  const rank = (r: MuscleRest): number => {
    if (r.bound === 'unknown') return -1;          // nothing known sorts last
    if (r.bound === 'atLeast') return Number.MAX_SAFE_INTEGER;
    return r.days ?? 0;
  };
  return out.sort((a, b) => rank(b) - rank(a) || a.muscle.localeCompare(b.muscle));
}

/** One muscle's rest off a board. Case-insensitive, for a caller holding a
 *  layer name from the artwork or a name a coach typed. */
export function restFor(board: MuscleWorkBoard, muscle: string): MuscleRest {
  const k = String(muscle ?? '').trim().toLowerCase();
  return restOf(board, k, board.muscles.find((m) => m.muscle === k) ?? null);
}

/**
 * The sentence for one muscle's rest.
 *
 * The bound is IN THE WORDS, not appended as a caveat, because a caveat after a
 * number is read as decoration and the number is what sticks. "Not trained in
 * the last 30 days" and "Last trained 3 days ago" are both statements a reader
 * can check against their own memory; "Recovered" is not.
 */
export function restLine(r: MuscleRest): string {
  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  switch (r.bound) {
    case 'unknown':
      return 'We cannot say when this was last trained.';
    case 'atLeast':
      return `Not trained in the last ${plural(r.days ?? 0)}.`;
    case 'atMost': {
      const d = r.days ?? 0;
      const when = d === 0 ? 'today' : d === 1 ? 'yesterday' : `${plural(d)} ago`;
      return `Last trained ${when} in the part of your log we could read — it may be more recent.`;
    }
    default: {
      const d = r.days ?? 0;
      if (d === 0) return 'Trained today.';
      if (d === 1) return 'Trained yesterday.';
      return `Last trained ${plural(d)} ago.`;
    }
  }
}

/**
 * What the Recovery Map as a whole may claim, or null when it may claim nothing.
 *
 * One sentence over the map rather than one per row. It exists because the two
 * bad readings of this screen are whole-map readings — "everything on here is
 * recovered" and "these muscles have never been trained" — and neither is
 * answered by a caption under a single muscle.
 */
export function restMapNote(board: MuscleWorkBoard): string | null {
  if (board.status === 'error') {
    return 'We could not read your training, so this map is not about you yet.';
  }
  if (board.status === 'loading') return null;
  const days = Math.max(1, Math.round((board.nowMs - board.sinceMs) / DAY));
  // Composed rather than chosen between. A truncated CATALOGUE makes the board
  // partial as well — a movement whose row did not come back lands in
  // `unmatched` — so an if/else here dropped the sentence about the missing
  // untouched muscles every time the catalogue was the thing that was short,
  // which is precisely when it was needed.
  const out = [REST_MEANS];
  if (board.isFloor) {
    out.push('Your log was read in part, so a muscle may have been trained more recently '
      + 'than it says here.');
  }
  if (!board.vocabulary) {
    out.push('We could not read the whole exercise catalogue, so muscles you have not trained '
      + 'are missing from this map rather than listed as untrained.');
  } else if (!board.isFloor) {
    out.push(`It looks back ${days} days, so "not trained" means not in that time rather than `
      + 'not ever.');
  }
  return out.join(' ');
}
