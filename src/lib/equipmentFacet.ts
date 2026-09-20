// Narrowing the catalogue to the kit a floor actually has.
//
// A coach writing Thursday for a client who trains in a hotel gym with two
// dumbbells and a bench is choosing from six hundred movements, a third of
// which assume a cable stack, a Smith machine or a GHD. The only way to find
// the ones that fit was to read the names and know which was which. So the
// screen that lists everything you can program has to be able to say "show
// me what this floor supports", and `exercises.equipment` is the column that
// answers it.
//
// ── Why this is a module and not a second copy of the owner's filter ───────
//
// app/(owner)/library.tsx already filters on this column, with its own local
// `distinct()` and `matches()`. That rule is right and this file is it, lifted
// out and tested, so the coach screen is not a second opinion about what
// "barbell" matches. Two hand-written copies of a case-insensitive compare is
// exactly the shape that produced four capitalisation helpers in this tree,
// three of which stayed on the old behaviour after the fourth was fixed — see
// src/ui/useExerciseMedia.ts's header. The owner screen is another lane's file
// and is left alone; it should be pointed at these functions when somebody is
// next in it, and until then the comparison is at least written down once.
//
// ── The null column is a GAP, and it is a big one ─────────────────────────
//
// Counted against the live table on 13 Sep 2026: 615 rows, 425 of which name
// their equipment and 190 of which hold NULL. No row holds an empty string, so
// null is the only shape the gap takes. By source: 425 of the 608 `repdb` rows
// carry it, and all 7 rows added by a coach or by Repple carry none.
//
// Nearly a third. That number is what shapes everything below:
//
//   · A null is NOT "bodyweight". Filing 190 movements under bodyweight would
//     be inventing a fact about each one, and the reading it invites — a cable
//     fly dropped into a program for somebody with no cable — is the exact
//     harm the filter exists to prevent. So a null matches no kit chip.
//
//   · Which means a lit kit chip drops 190 rows that were never tested, and a
//     filter that hides rows it could not judge is the house's own rule about
//     a count that omits what it cannot place. Two things answer it: the
//     `Not recorded` chip, so those rows stay reachable rather than falling
//     off the screen entirely, and `equipmentGapNote`, so a coach narrowing to
//     Dumbbell is told how many movements nobody labelled.
//
// The long tail matters too: 56 distinct values, of which the top four
// (dumbbell 79, barbell 68, kettlebell 61, cable 29) are more than half of the
// labelled rows and 31 appear exactly once. Ordered alphabetically rather than
// by frequency, because this row is read as a lookup — a coach knows which kit
// they are missing and is looking for its name — where the client library's
// facets are ordered by tally because a member is browsing.
import { catalogueValue as cap, num } from './format';

/** The chip meaning "do not filter on equipment". */
export const ALL_KIT = 'All';

/**
 * The chip standing for rows whose equipment the catalogue does not record.
 *
 * Deliberately not "Bodyweight" and not "Other". It names the state of our
 * data, which is the only thing we know about those 190 rows.
 */
export const UNRECORDED_KIT = 'Not recorded';

/**
 * The chips to draw, derived from the rows we hold rather than hardcoded.
 *
 * A hardcoded list is a second copy of the catalogue's vocabulary, and the day
 * a row arrives carrying a kit nobody wrote down here, that row becomes
 * unreachable through the one control on the screen whose job is finding it.
 *
 * `equipment` is free text on the row, so 'Barbell' and 'barbell' are one kit
 * and must not become two chips; the first spelling seen wins for display and
 * every comparison is case-insensitive. `UNRECORDED_KIT` is appended only when
 * some row actually lacks the column — on a set where every row is labelled it
 * would be a chip that selects nothing.
 */
export function equipmentChips(values: (string | null)[]): string[] {
  const seen = new Map<string, string>();
  let anyMissing = false;
  for (const raw of values) {
    const v = (raw || '').trim();
    if (!v) { anyMissing = true; continue; }
    if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), cap(v));
  }
  const named = [...seen.values()].sort((a, b) => a.localeCompare(b));
  return [ALL_KIT, ...named, ...(anyMissing ? [UNRECORDED_KIT] : [])];
}

/**
 * Whether a row's equipment column satisfies the lit chip.
 *
 * The one rule, in one place. A null or blank column matches `UNRECORDED_KIT`
 * and nothing else — never a named kit, and never every kit, which are the two
 * ways a missing value quietly becomes a claim.
 */
export function matchesEquipment(field: string | null, chip: string): boolean {
  if (chip === ALL_KIT) return true;
  const v = (field || '').trim();
  if (chip === UNRECORDED_KIT) return v === '';
  return v.toLowerCase() === chip.toLowerCase();
}

/**
 * How many of the rows on offer the lit chip could not place.
 *
 * Counted over the set the kit filter is APPLIED TO — the rows the search and
 * the muscle group already selected — and not over the whole catalogue, or the
 * sentence would report 190 to a coach who has narrowed to Chest and is
 * looking at eleven rows.
 *
 * Zero under `ALL_KIT`, which excludes nothing, and zero under
 * `UNRECORDED_KIT`, which is the chip that shows these rows rather than one
 * that hides them.
 */
export function unplacedByEquipment(values: (string | null)[], chip: string): number {
  if (chip === ALL_KIT || chip === UNRECORDED_KIT) return 0;
  return values.filter((v) => (v || '').trim() === '').length;
}

/**
 * The sentence under the chips, or null when there is nothing to admit.
 *
 * `whole` is the caller's `isWhole(status)`. Under 'partial' the rows held are
 * a prefix of the catalogue, so the count of unlabelled ones is a subtotal and
 * printing it would be the same lie one layer down — but staying silent would
 * be the worse one, because rows ARE being hidden. So the omission is stated
 * without a figure. Under 'loading' and 'error' the same applies: the caller
 * has nothing whole to count.
 *
 * Null when the chip hides nothing, so a screen can render this straight into
 * JSX and get no empty row when there is nothing to say.
 */
export function equipmentGapNote(unplaced: number, chip: string, whole: boolean): string | null {
  if (chip === ALL_KIT || chip === UNRECORDED_KIT) return null;
  if (!whole) {
    return 'Movements whose equipment the catalogue does not record are not in this list, '
      + 'and only part of the catalogue was read, so how many were left out is not known.';
  }
  if (unplaced <= 0) return null;
  // "left out" rather than "do not match": they were never tested. Saying they
  // failed the filter would be a claim about kit nobody recorded.
  return unplaced === 1
    ? `1 more movement is left out because the catalogue does not record what it is performed on. Tap ${UNRECORDED_KIT} to see it.`
    : `${num(unplaced)} more movements are left out because the catalogue does not record what they are performed on. Tap ${UNRECORDED_KIT} to see them.`;
}

/* ── "No equipment" is a different question from "which kit" ───────────────
 *
 * Everything above answers "does this row's kit match the chip", and a null
 * column is a GAP there — the catalogue did not say. That is the right answer
 * for a coach narrowing to Dumbbell and the wrong one for a client in a hotel
 * room with nothing, because "we did not record it" is not "you need nothing".
 *
 * The catalogue answers the second question with a SECOND column,
 * `exercises.is_bodyweight`, and the two columns only mean "needs nothing"
 * TOGETHER. Counted against the live table: 615 rows, 183 with
 * `equipment is null AND is_bodyweight = true` — the true no-kit pool — and 7
 * more with a null column that are not flagged. Those 7 are unknown, not
 * empty-handed, and they stay out.
 *
 * So this takes the ROW and not the `equipment` string, which is why it is not
 * another chip inside `matchesEquipment`: that function is handed one field and
 * physically cannot see the flag it would need. A caller that tried anyway
 * would be back to reading a null as a claim, one layer down.
 *
 * Bands are equipment. A loop band (15 rows) and a resistance band (13) name
 * their kit in the column, so they fail the first clause and are out of a
 * no-kit program without anything here having to list them — which is the
 * point of asking the column rather than keeping a vocabulary of our own.
 */

/** A catalogue row, as far as its kit is concerned. */
export interface KitRow {
  /** `exercises.equipment`. Null or blank = the catalogue did not record it. */
  equipment: string | null;
  /** `exercises.is_bodyweight`. Absent or null = the catalogue did not say,
   *  which is not the same as false and is treated here as "do not assume". */
  isBodyweight?: boolean | null;
}

/** The chip, and the label the builder's control uses. Sentence case after the
 *  first word, like every other option in this app. */
export const NO_KIT = 'No equipment';

/**
 * Whether this movement can be done with nothing at all.
 *
 * Both clauses, always. `isBodyweight === true` on its own would let through a
 * row whose column names a pull-up bar, and an empty column on its own would
 * let through the 7 rows nobody has classified.
 */
export function needsNoKit(row: KitRow): boolean {
  return (row.equipment || '').trim() === '' && row.isBodyweight === true;
}
