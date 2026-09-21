// How a body-composition reading got onto the record — and why a coach may not
// be shown the figure without it.
//
// ── the gap this closes ────────────────────────────────────────────────────
//
// `scans.source` has existed since supabase/parts/01-schema.sql line 71 and it
// is written on every insert this app makes. Three different things write it:
//
//   'InBody (OCR)'    the table default, and what a read of a photographed
//                     printout stores (src/lib/inbodyVision.ts → clientData
//                     .addScan). A machine measured it and nobody retyped it.
//   'InBody (manual'  src/lib/recordQueue.ts line 313 — the fallback when a
//    + ')'            queued scan arrives without one. A machine measured it
//                     and a person typed the figure in.
//   'Entered by me'   app/(trainer)/my-progress.tsx — somebody read a number
//                     off whatever they had and typed it. No machine is named
//                     at all and none may be assumed.
//
// The column is read (app/(trainer)/client-body.tsx:177 puts it in SCAN_COLS),
// carried (src/lib/clientBody.ts:207-218 hangs it on every Reading), and
// `clientBody.sourceLabel` exists to print it. Nothing anywhere in app/ calls
// that function, so no screen in this tree has ever shown it. Every body figure
// a coach or a member has ever read has been presented as though all three of
// those were the same kind of fact.
//
// They are not the same kind of fact, and the difference is the size of the
// changes anybody is training for. A bathroom scale and an InBody disagree by
// more than a month of good work — which is the reasoning already written down
// at app/(trainer)/client-body.tsx:44-53 about the typed `manual_weight_kg`
// figures, and which applies just as hard to two rows of `scans` that happen to
// disagree about the equipment. A coach rewriting somebody's program because
// their body fat "went up 1.8 points" needs to know whether that 1.8 is a
// measurement or the difference between a machine and a guess.
//
// ── what this file will not do ─────────────────────────────────────────────
//
// It will not decide that a reading is WRONG. Nothing here ranks a figure as
// unreliable, discounts it, hides it, or excludes it from a series. A typed
// figure is the client's own account of their own body and is frequently the
// only one there is. The whole output is a label and a sentence: this is how
// the record says the number arrived. What to do about it is the coach's.
//
// It will not guess. `source` is free text on the table — it has no check
// constraint and nothing stops a future writer putting anything in it — so a
// string this file does not recognise is reported as unrecognised and printed
// verbatim, never quietly filed under the nearest match. A wrong claim about
// the evidence is worse than no claim, because the whole point of the feature
// is that the coach can trust the label.
//
// Pure, no clock, no React: the caller passes the string.

/**
 * What the record says about how the figure was produced.
 *
 * Two axes are folded into one enum because they are the two a coach actually
 * acts on: did a MACHINE produce the number, and did a PERSON retype it on the
 * way in. An OCR'd printout is a machine reading with no transcription step; a
 * manually entered InBody figure is a machine reading that a human hand could
 * have fat-fingered; a typed figure with no machine named is neither.
 *
 * 'unrecognised' and 'unrecorded' are deliberately separate. One is a record
 * that says something this file cannot interpret; the other is a record that
 * says nothing. A screen may want to print the first verbatim and cannot print
 * the second at all.
 */
export type ScanEvidence =
  | 'machine-ocr'
  | 'machine-typed'
  | 'typed'
  | 'unrecognised'
  | 'unrecorded';

/** One `scans.source` value, read. `recorded` is the string exactly as stored,
 *  trimmed, or null when the column was null or blank — never a substitute. */
export interface ScanSource {
  readonly kind: ScanEvidence;
  readonly recorded: string | null;
}

/**
 * The machines this app has ever been told about by name.
 *
 * Short on purpose. Every word here is a claim that a device measured the
 * body, so the list holds only things that are body-composition equipment and
 * nothing that merely sounds like it. 'scale' is absent: a gym scale gives a
 * weight and the word is also in 'scaled', 'rescale' and half the CSS in this
 * tree, and a false positive here promotes a guess to a measurement.
 */
const MACHINE_WORDS = ['inbody', 'tanita', 'dexa', 'dxa', 'bodpod', 'bod pod', 'seca', 'styku', 'fit3d'];

/** Words that say a human typed the figure rather than a reader lifting it off
 *  a sheet. 'manual' is the one `recordQueue.ts` actually writes; the rest are
 *  here because this column is free text and a gym owner editing rows by hand
 *  will write English rather than an enum. */
const TYPED_WORDS = ['manual', 'typed', 'entered', 'by hand', 'hand-entered', 'self'];

/** Words that say the figure came off a photograph of a printout. */
const OCR_WORDS = ['ocr', 'photo', 'printout', 'sheet'];

const has = (hay: string, needles: string[]): boolean => needles.some((n) => hay.includes(n));

/**
 * Read one `scans.source` value.
 *
 * Case-insensitive and substring-based because the values in the wild are
 * 'InBody (OCR)' and 'InBody (manual)' — parenthesised, capitalised
 * inconsistently, and certain to gain a fourth spelling the first time anybody
 * imports a history from another app.
 */
export function readSource(source: string | null | undefined): ScanSource {
  const recorded = typeof source === 'string' ? source.trim() : '';
  if (!recorded) return { kind: 'unrecorded', recorded: null };
  const s = recorded.toLowerCase();
  const machine = has(s, MACHINE_WORDS);
  if (machine) {
    // A machine is named. Which of the two machine kinds depends on whether the
    // string also says a person typed it — and OCR is checked FIRST because
    // 'InBody (OCR)' contains no typed word and 'InBody (manual)' contains no
    // OCR word, so the order only matters for a string that somehow says both,
    // where the transcription step is the more cautious reading.
    if (has(s, TYPED_WORDS)) return { kind: 'machine-typed', recorded };
    if (has(s, OCR_WORDS)) return { kind: 'machine-ocr', recorded };
    // A machine named and NOTHING about how the figure travelled off it. This
    // deliberately falls through to 'unrecognised' rather than picking one of
    // the two machine kinds: both of them are claims about a transcription step
    // that this string does not make, and the header's rule is that a wrong
    // claim about the evidence is worse than no claim. The string is still
    // printed verbatim, so the coach reads the word 'InBody' either way — what
    // they do not get is this file asserting a route it was never told.
    return { kind: 'unrecognised', recorded };
  }
  if (has(s, TYPED_WORDS)) return { kind: 'typed', recorded };
  // Something is written here and this file does not know what it means. Said
  // out loud rather than bucketed — see the header.
  return { kind: 'unrecognised', recorded };
}

/**
 * The short label that goes beside the figure.
 *
 * The recorded string VERBATIM wherever there is one, because it is what the
 * record actually says and a coach comparing this screen against an InBody
 * sheet needs the same words on both. Only an empty column is replaced, and
 * then with a sentence that says the column was empty rather than with a
 * plausible-looking default.
 */
export function sourceChip(s: ScanSource): string {
  return s.recorded ?? 'Source not recorded';
}

/**
 * One sentence saying what kind of evidence this reading is.
 *
 * Written about the reading and never about the person: "typed in by hand" is
 * a fact about a row, and "they guessed" is an accusation. The distinction
 * matters because this string is shown to a coach about a client who cannot
 * see the screen.
 */
export function evidenceNote(s: ScanSource): string {
  switch (s.kind) {
    case 'machine-ocr':
      return 'Read off a photograph of the printout, so the figure is the machine’s own and nobody retyped it.';
    case 'machine-typed':
      return 'A machine reading, typed onto the record by hand, so the measurement is a machine’s and the transcription is a person’s.';
    case 'typed':
      return 'Typed in. No machine is named on the record, so this is somebody’s figure for themselves rather than a measurement this app can vouch for.';
    case 'unrecognised':
      return 'The record names a source this app does not recognise, so it is shown as written rather than interpreted.';
    case 'unrecorded':
      return 'Nothing on the record says how this figure was taken. That is a gap in the record, not a machine reading and not a typed one.';
  }
}

/**
 * Whether two readings are the same kind of evidence.
 *
 * 'unrecognised' and 'unrecorded' never match ANYTHING, including themselves:
 * two rows that both fail to say where they came from have not been shown to
 * agree, and treating "both unknown" as "both the same" is how a change across
 * two different machines gets published without a caveat.
 */
export function sameEvidence(a: ScanSource, b: ScanSource): boolean {
  if (a.kind === 'unrecognised' || a.kind === 'unrecorded') return false;
  if (b.kind === 'unrecognised' || b.kind === 'unrecorded') return false;
  return a.kind === b.kind;
}

/**
 * The caveat that must travel with a CHANGE taken between two readings of
 * different kinds — or null when the two agree and there is nothing to say.
 *
 * This is the whole point of the item. A difference between a machine reading
 * and a typed figure is partly a difference in equipment, and a coach reading
 * "−1.8%" with no caption cannot tell how much of it is the body. The sentence
 * does not say the change is wrong; it says what else is in it.
 */
export function changeAcrossSources(earlier: ScanSource, later: ScanSource): string | null {
  if (sameEvidence(earlier, later)) return null;
  return `These two readings did not arrive the same way (${sourceChip(earlier).toLowerCase()} then `
    + `${sourceChip(later).toLowerCase()}), so part of the difference between them may be the equipment `
    + 'rather than the body. It is shown because it is what the record holds, not because the two are comparable.';
}

/**
 * The note for a whole series — or null when every reading in it arrived the
 * same way and the caveat would be noise.
 *
 * Null on an EMPTY list too. A series with nothing in it has not been shown to
 * be consistent; it has been shown to be empty, and a reassuring sentence over
 * no data is the failure this repo's house rules are mostly about. The caller
 * has the count and says the honest thing about it.
 */
export function mixedSourcesNote(sources: readonly ScanSource[]): string | null {
  if (sources.length < 2) return null;
  const kinds = new Set(sources.map((s) => s.kind));
  if (kinds.size < 2) return null;
  const machine = sources.filter((s) => s.kind === 'machine-ocr' || s.kind === 'machine-typed').length;
  const typed = sources.filter((s) => s.kind === 'typed').length;
  const blank = sources.filter((s) => s.kind === 'unrecorded').length;
  // The fourth bucket is rows whose source is written down and is not one this
  // app can read. Counting them with the blank ones would say "no source
  // recorded" about a row that records one, which is a different defect in the
  // record and would send a coach looking for a gap that is not there.
  const unread = sources.length - machine - typed - blank;
  const parts: string[] = [];
  if (machine) parts.push(`${machine} off a machine`);
  if (typed) parts.push(`${typed} typed in`);
  if (blank) parts.push(`${blank} with no source recorded`);
  if (unread) parts.push(`${unread} recording a source this app cannot classify`);
  return `These readings did not all arrive the same way: ${parts.join(', ')}. `
    + 'A trend drawn through a mixture is partly a trend in the equipment, so the source is on every row.';
}
