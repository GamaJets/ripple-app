// Most- and least-trained muscles over a window.
//
// ── Why "least trained" is the dangerous half ──────────────────────────────
//
// "Your most trained muscle is your gluteus maximus" is a statement about rows
// that exist. If the read was short, it is a statement about fewer rows than
// there are, and it is still a statement about rows that exist.
//
// "Your least trained muscle is your soleus" is not that. It is a claim built
// on the ABSENCE of rows, and absence is the one thing a partial read produces
// for free. src/lib/muscleVolume.ts already draws this line for the eleven
// coarse groups — `untrained` is null unless the catalogue read landed whole —
// and everything below is that argument at the finer grain, where it bites
// harder, because thirty muscles over a fortnight leave far more holes than
// eleven groups do and every hole is a sentence somebody could be shown.
//
// So there are two lists here and they are not two ends of one list:
//
//   `least`      muscles with work in the window, ordered up from the least of
//                it. Every row is evidence. Safe whenever the log read is whole.
//   `untrained`  muscles the catalogue knows and the window does not contain.
//                Null unless BOTH reads are whole, because the claim needs the
//                vocabulary to be complete AND the log to be.
//
// Folding them into one ranking — a zero row sorted to the bottom — was the
// first shape of this file and it was wrong twice over. It puts an assertion of
// absence and a measurement of presence in the same column with the same
// styling, and it makes "0 sets" look like a reading rather than a silence.
//
// ── And the ordering itself is a display choice ────────────────────────────
//
// It runs on `primaryEquivalentSets`, which counts an assisting set as half —
// see `SECONDARY_SHARE` in src/lib/muscleWork.ts for why that number is what it
// is and why nothing in the data could justify a finer one. `RANKING_BASIS` is
// the sentence that goes beside the list, and `rankingNotes()` below returns it
// along with everything else the list is not saying.
import { isWhole } from '../ui/loadStatus';
import {
  RANKING_BASIS, gapNote, undrawnNote, windowNote,
  type MuscleEffort, type MuscleWorkBoard,
} from './muscleWork';

/** How many rows each end of the board shows unless a caller says otherwise.
 *  Five is what fits above the fold on a phone beside a body diagram; it is a
 *  layout figure and not a finding, which is why it is a default and not a
 *  constant baked into the sort. */
export const RANK_ROWS = 5;

export interface MuscleRankings {
  /** Hardest worked first. Empty when nothing was counted. */
  most: MuscleEffort[];
  /**
   * Least worked first, over muscles that HAVE work. Never includes a muscle
   * with nothing against it — those are `untrained`, and the distinction is the
   * whole point of the file.
   */
  least: MuscleEffort[];
  /**
   * Muscles in the catalogue's vocabulary with no counted set in the window, or
   * null when that cannot be stated.
   *
   * Null under a partial or failed read of EITHER side. Not an empty array:
   * empty would mean "every muscle was trained", which is a finding, and a
   * screen cannot tell the two apart if both arrive as `[]`.
   */
  untrained: string[] | null;
  /** True when `most` and `least` are the same short board seen from both ends
   *  — fewer muscles than 2 × `rows`. A screen showing both would print the
   *  same muscle in "most trained" and "least trained", which reads as a bug.
   *  Show one list. */
  overlapping: boolean;
  /** Muscles counted here that the artwork cannot draw. Carried from the board
   *  so a ranking rendered without a diagram still knows. */
  undrawn: string[];
}

/**
 * The two ends of the board.
 *
 * `rows` is per end. The gap analysis is not in the return type on purpose —
 * `rankingNotes()` assembles it, so a caller cannot render the table and forget
 * the sentences, which is the failure mode `unmatchedNote` in
 * src/lib/muscleVolume.ts was written against.
 */
export function muscleRankings(
  board: MuscleWorkBoard,
  opts: { rows?: number } = {},
): MuscleRankings {
  const rows = Math.max(1, Math.floor(opts.rows ?? RANK_ROWS));
  // `board.muscles` is already sorted hardest-first and every row in it has at
  // least one counted set, so both ends come off the same array. A muscle with
  // a zero cannot appear here — the board omits it rather than listing it.
  const ranked = board.muscles;
  const most = ranked.slice(0, rows);
  const least = ranked.slice(Math.max(0, ranked.length - rows)).slice().reverse();
  const untrained = board.vocabulary && isWhole(board.status)
    ? board.vocabulary.filter((m) => !ranked.some((r) => r.muscle === m))
    : null;
  return {
    most,
    least,
    untrained,
    overlapping: ranked.length > 0 && ranked.length <= rows * 2,
    undrawn: board.undrawn,
  };
}

/**
 * Everything a ranking is not saying, as sentences, in the order they belong on
 * screen. Empty when the board is whole and complete, which is the only case
 * where a bare table is honest.
 *
 * Returned as a list rather than one joined string so a screen can put the
 * window caption at the top and the caveats at the bottom without splitting a
 * paragraph, and so a caller that renders none of them fails review visibly.
 */
export function rankingNotes(board: MuscleWorkBoard, r: MuscleRankings): string[] {
  const out: string[] = [];
  const w = windowNote(board);
  if (w) out.push(w);
  if (board.muscles.length) out.push(RANKING_BASIS);
  // Why there is no "not trained" section, when there is none. Without this
  // its absence reads as "you have trained everything", which is the strongest
  // claim the screen could make and the one nothing here supports. The two
  // reasons get two sentences because they are two different failures: one is
  // a catalogue we could not read whole, the other is a log we could not.
  //
  // whole-ok: 'partial' is admitted here on purpose and is in fact the main
  // case this branch is for. Every other use of the status in this feature
  // gates a CLAIM — `muscleRankings` uses `isWhole` before it will publish
  // `untrained` at all, and that is where the rule bites. This branch makes no
  // claim: it fires precisely when `untrained` has been WITHHELD, and it exists
  // to say so out loud. Requiring 'ready' would silence the explanation in
  // exactly the two states that produce the thing needing explaining, and leave
  // the reader to supply "so I must have trained everything" themselves.
  // 'loading' and 'error' are excluded because nothing has been shown yet under
  // the first and `windowNote` has already said the screen is not about them
  // under the second.
  const said = board.status === 'ready' || board.status === 'partial';
  if (r.untrained == null && said) {
    out.push(board.vocabulary == null
      ? 'We could not read the whole exercise catalogue, so we cannot list the muscles you '
        + 'have not trained.'
      : 'Your log was read in part, so we cannot list the muscles you have not trained.');
  }
  const g = gapNote(board);
  if (g) out.push(g);
  const u = undrawnNote(board);
  if (u) out.push(u);
  return out;
}

/**
 * The line for one ranked row.
 *
 * Prints REAL SETS and never `primaryEquivalentSets`, which is dimensionless
 * and would read as a count of sets the member did not do. The score orders the
 * list; the sentence reports the log. Where a muscle only ever assisted, the
 * line says so rather than showing a bare number that overstates the work.
 */
export function rankingLine(e: MuscleEffort): string {
  const sets = (n: number) => `${n} set${n === 1 ? '' : 's'}`;
  if (e.primarySets > 0 && e.secondarySets > 0) {
    return `${sets(e.primarySets)} as the main muscle, ${sets(e.secondarySets)} assisting.`;
  }
  if (e.primarySets > 0) return `${sets(e.primarySets)} as the main muscle.`;
  return `${sets(e.secondarySets)} assisting — nothing that trained it directly.`;
}
