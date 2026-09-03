// The one sentence describing the set that set a record.
//
// ── The defect this closes ─────────────────────────────────────────────────
//
// `PR.bodyweight` in src/lib/streaks.ts exists for one reason, and its own
// docstring states it as a prohibition:
//
//   "Carried so a row can read 'bodyweight +20 kg × 8' instead of presenting a
//    figure that is partly derived from a weigh-in as though it had been on a
//    bar."
//
// `personalRecords` prices a bodyweight set at `setLoadKg` — the member's
// weight on the day, PLUS anything belted on — so `PR.weight` for a weighted
// pull-up is 104 for an 84 kg member with 20 kg hung off them. That figure is
// a real load and it is the right thing to estimate a 1RM from. It is not a
// thing that was ever on a bar, and printing "104 kg × 12" says it was.
//
// app/(client)/records.tsx honoured the flag in two of its three renderings of
// the same record and not in the third — and the third was the HERO, which is
// the figure people quote and screenshot. One member, one set, two sentences,
// eleven lines apart on one screen:
//
//   hero: "Pull-up · best set 104 kg × 12"
//   row:  "Best set 12 reps at bodyweight +20 kg"
//
// The flag was not missing there. The branch was, because the phrase was
// written out by hand at each of the three sites and one of the three hands
// forgot. So the phrase moves here, where there is one of it.
//
// ── Why the caller passes formatted labels ────────────────────────────────
//
// Because unit conversion is not this module's business and must not become
// it. `liftLabel`/`est1RMIn` in src/lib/units.ts already own the kilogram round
// trip and the pounds reader, and a second opinion about it here is exactly how
// the screen and the coach's console end up a pound apart on one lift. What
// this owns is which of five sentences to say.
import { bodyweightSetLabel } from './bodyweightSets';

/** What a screen prints where a load could not be read. `fig(null)` in
 *  src/ui/kit.tsx renders this, and it is passed in rather than imported so
 *  this module stays free of react-native. */
export const UNKNOWN_LOAD = '—';

/**
 * Where the phrase is going, which is the only thing the two differ in.
 *
 * 'screen' is read; 'spoken' is what a screen reader says. "104 kg × 12" is
 * fine to look at and is not a sentence — VoiceOver reads the multiplication
 * sign as "times" or, on some voices, not at all.
 */
export type Voice = 'screen' | 'spoken';

/** The record's own shape. A subset of `PR` in src/lib/streaks.ts, so a PR can
 *  be passed straight in and nothing has to be assembled at the call site. */
export interface BestSet {
  reps: number;
  /** True when the load was the member's own body. */
  bodyweight?: boolean;
  /** Kilograms hung, belted or held on top. Only meaningful with `bodyweight`. */
  addedKg?: number;
}

/**
 * "12 reps at bodyweight +20 kg", "104 kg × 12", or "— × 12".
 *
 * @param pr          the record.
 * @param loadLabel   the bar load in the reader's own unit, e.g. "104 kg" —
 *                    null when it could not be read. IGNORED for a bodyweight
 *                    set, deliberately: that figure is partly a weigh-in and
 *                    there is no honest way to print it as a load.
 * @param addedLabel  what was added on top, e.g. "20 kg" — null when nothing
 *                    was, or when the figure could not be read.
 * @param voice       'screen' or 'spoken'.
 */
export function bestSetLabel(
  pr: BestSet,
  loadLabel: string | null,
  addedLabel: string | null,
  voice: Voice = 'screen',
): string {
  // A rep count that is not a number is not a set. It cannot happen from
  // `personalRecords` — it skips a set with no reps — but this function is
  // handed rows from a log that has been through a queue, a cache and a
  // JSON round trip, and "NaN reps at bodyweight" is a worse answer than one
  // that admits it does not know.
  const reps = Number.isFinite(pr.reps) ? pr.reps : null;
  if (reps == null) return voice === 'spoken' ? 'an unrecorded set' : UNKNOWN_LOAD;

  if (pr.bodyweight) {
    // The one phrase both voices already share, and the one this whole module
    // exists to make unskippable.
    //
    // No clamp on `addedKg` and none needed: `bodyweightSetLabel` prints the
    // "+" clause only for `addedKg > 0 && addedLabel`, so a zero, a negative
    // out of a corrupted queue row, or a figure with no label all fall back to
    // the bare "N reps at bodyweight". The test pins that, because a
    // `Math.max(0, …)` here would look like the thing keeping "+-5 kg" off the
    // screen and would not be.
    return bodyweightSetLabel(reps, pr.addedKg ?? 0, addedLabel);
  }

  if (loadLabel == null) {
    // A load that could not be read. Spoken, the dash is a word that has gone
    // missing — "dash times twelve" is not something to read to somebody — so
    // the clause is dropped rather than voiced.
    return voice === 'spoken' ? `${reps} reps` : `${UNKNOWN_LOAD} × ${reps}`;
  }

  return voice === 'spoken' ? `${loadLabel} by ${reps} reps` : `${loadLabel} × ${reps}`;
}
