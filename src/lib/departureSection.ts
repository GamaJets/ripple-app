// One section about churn, not two.
//
// ── What was on the screen ────────────────────────────────────────────────
//
// The coach dashboard drew these one directly after the other:
//
//   WHY THEY LEFT · 1
//   "One person has left your book in the last three months with nothing
//    recorded about why. It is the cheapest thing you will ever learn about
//    your own business, and you will not remember it in March."
//
//   WHY PEOPLE HAVE LEFT · Last 90 days
//   "1 person has left your book in the last 90 days, and nothing is recorded
//    about why any of them did. Every one of those answers is still gettable,
//    and none of them will be in March."
//
// Both true, both well written, and the same fact in two voices — which is what
// many hands on one screen produces. They were even fed by two separate reads
// of the SAME table for the same coach over the same ninety days, one filtered
// to the unexplained endings and one not, so a coach's book was fetched twice
// in order to be described twice.
//
// The one that survived is the one with `Record Why` on it: a section a coach
// can act on beats a section they can only read, and everything the other said
// was carried into it. That is what this module is — the sentence that says
// both things once.
//
// ── The three statements that had to survive ──────────────────────────────
//
//  1. HOW MANY, AND OVER WHAT PERIOD. "Last three months" and "the last 90
//     days" were the same window said two ways; the number of days is now
//     stated once, by the caller, because the figure is meaningless without it.
//  2. WHAT IT IS WORTH. "The cheapest thing you will ever learn about your own
//     business" is the reason a coach bothers, and it lived only on the card
//     being merged INTO — so it survives whichever branch the sentence takes.
//  3. WHY NOW. "You will not remember it in March" / "none of them will be in
//     March" is the deadline, and it is the only part of this that expires.
//
// And one distinction that must not be lost either way: an ending with NOTHING
// recorded is not an ending recorded as "they did not say". Nobody having asked
// and somebody declining to answer are opposite facts about the coach's own
// record-keeping, and only one of them is still fixable. `departureLine` already
// says so when there are reasons to compare against; this keeps that and adds
// the deadline to it.
//
// Pure, and no figure is computed here — `departureTally` does the counting and
// this only writes it down. That is deliberate: the caller must be free to
// withhold the whole sentence when the read came back truncated, because a
// tally over a prefix is not a smaller tally, it is a different one.
import { departureLine, type DepartureTally } from './endCoaching';

/**
 * The single sentence over the merged section, or null when there is nothing
 * to say.
 *
 * Null on a null tally (an unread book is not a coach nobody has left) and null
 * on an empty one, exactly as `departureLine` decides — "0 people have left
 * you" reads as a compliment on a book that has never had anybody on it.
 */
export function departureSectionNote(tally: DepartureTally | null, windowDays: number): string | null {
  const base = departureLine(tally, windowDays);
  if (base == null || tally == null) return null;

  // Every ending explained. There is nothing left to ask about, so no deadline
  // applies and none is invented — the list under this sentence is empty and
  // the section is a record rather than a prompt.
  if (tally.unrecorded === 0) return base;

  // Nothing explained at all. `departureLine` already ends "Every one of those
  // answers is still gettable, and none of them will be in March", which is
  // statement 3; what it has never carried is statement 2.
  if (tally.counts.length === 0) {
    return `${base} It is the cheapest thing you will ever learn about your own business.`;
  }

  // Some explained, some not. Here `departureLine` ends on the distinction
  // between nothing recorded and "they did not say" and stops — so both the
  // deadline and the reason to care have to be added.
  return `${base} Those answers are still gettable today in a way they will not be in March, and they are the cheapest thing you will ever learn about your own business.`;
}
