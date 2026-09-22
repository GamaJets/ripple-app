// How many people have accepted a coach's document, said on the document.
//
// ── The defect this closes ────────────────────────────────────────────────
//
// app/(trainer)/documents.tsx could already answer "who has accepted this" —
// `coach_document_standing` (supabase/parts/137-a-coachs-own-paperwork.sql — the
// comments on this feature all say "part 135", which is a different file about
// standing appointments) returns every current client
// of the coach with the date they accepted, or null, and `standingLine` in
// src/lib/coachDocs.ts turns that into "4 of 9 of your clients have accepted
// this". All of it is behind a Who's Accepted control, one document at a time.
//
// So a coach with a waiver, a par-form and a photography consent had to open
// three panels, one after another, and wait for three reads, to learn the one
// thing the screen is for: whether the paperwork is signed. The list itself —
// the thing they are looking at — said nothing. The count existed and was never
// where the question was asked.
//
// ── Where the number comes from, and the line it does not cross ───────────
//
// `coach_document_acceptances`, read directly and filtered to the COACH'S OWN
// document ids. That is not a widening: `coach_doc_accept_own_r` in part 137
// already admits a coach to the acceptance rows of their own documents — the
// policy's second arm is an `exists` on `coach_documents.coach_id = auth.uid()`
// — and `authenticated` holds `select` on the table. This module counts rows
// that the coach could already fetch and already sees by name one tap away.
//
// It has nothing to do with part 84. Repple's own liability release is the
// client's legal record, the coach cannot read it, and a status-only mirror of
// it exists under an owner decision with its own argued header. Nothing here
// reaches `liability_waivers`, nothing here is a pattern to copy onto it, and
// the only ids this module will ever count against are ids the calling screen
// read out of `coach_documents` where `coach_id` was the caller.
//
// ── A count over a prefix is not a smaller count ──────────────────────────
//
// The rule from src/ui/loadStatus.ts, and src/lib/coachDocs.ts already states
// the coach-document version of it at length in `STANDING_TRUNCATED_NOTE`: "All
// 12 of your clients have accepted this" produced out of twelve rows of
// nineteen is how a coach trains the other seven believing they are covered.
// The same is true of a bare "4 have accepted". So `whole` is an argument, and
// under anything but a whole read this module returns no number at all — the
// screen says why instead, in ACCEPTANCE_COUNTS_UNCOUNTABLE_NOTE.

/** The one column the count needs. Everything else about the row — who, and
 *  when — is the Who's Accepted panel's business and is not read here. */
export interface RawAcceptanceRow { document_id?: unknown }

/**
 * Acceptances per document id.
 *
 * Null in means null out: a read that failed produced no rows, and zero rows is
 * the same shape as "nobody has accepted anything". Those are opposite facts
 * about somebody's signed paperwork.
 *
 * A row whose `document_id` is not a non-empty string is dropped rather than
 * counted under a key of "undefined" — it is a row we cannot attribute, and
 * attributing it to the wrong document would overstate a signature.
 */
export function tallyAcceptances(rows: readonly RawAcceptanceRow[] | null | undefined): Record<string, number> | null {
  if (rows == null) return null;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const id = typeof r?.document_id === 'string' ? r.document_id.trim() : '';
    if (!id) continue;
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/**
 * The count for one document, or null when no number may be stated.
 *
 * Null for a missing tally (the read failed) and null when the read was not
 * whole. Zero is a real answer and is only ever reached through a tally that
 * completed: a document present in `coach_documents` with no key in the tally
 * has genuinely had no acceptances, which is what the caller's `?? 0` means.
 */
export function acceptedCount(
  tally: Record<string, number> | null,
  documentId: string,
  whole: boolean,
): number | null {
  if (tally === null || !whole) return null;
  return tally[documentId] ?? 0;
}

/**
 * The line under a document's title.
 *
 * Null draws nothing: the screen says once, above the list, why no counts are
 * there, rather than repeating it against every row.
 *
 * `required` changes only the zero case, and it changes what is TRUE about it.
 * A document nobody is being asked to accept has no acceptances because nobody
 * was asked, and "Nobody has accepted this yet" against it reads as a roster
 * ignoring their coach.
 */
export function acceptedLine(count: number | null, required: boolean): string | null {
  if (count === null || !Number.isFinite(count) || count < 0) return null;
  if (count > 0) return `${count} ${count === 1 ? 'person has' : 'people have'} accepted this`;
  return required
    ? 'Nobody has accepted this yet'
    : 'Nobody has accepted this. You are not asking them to';
}

/** True when the line needs a mark beside it: a required document nobody has
 *  signed is the thing a coach came here to find. Not warn-coloured ink —
 *  `t.warn` as text is below AA on the light palettes (check-contrast.mjs). */
export function acceptedNeedsMark(count: number | null, required: boolean): boolean {
  return required && count === 0;
}

/**
 * How many documents one `in (…)` read will ask about.
 *
 * Not a row cap — it is a cap on the LENGTH OF THE REQUEST. PostgREST takes the
 * filter in the query string, so a hundred uuids is already a ~4 kB URL and the
 * document list's own ceiling is `capLimit()`, three orders of magnitude above
 * anything a coach has. Past this the read is not attempted at all and no count
 * is shown, which is the same refusal a truncated read gets and for the same
 * reason: a number produced from a request that was quietly cut is worse than
 * no number.
 */
export const COUNTABLE_DOCUMENTS_CAP = 100;

export const ACCEPTANCE_COUNTS_UNCOUNTABLE_NOTE =
  'How many people have accepted each document could not be worked out just now. Nobody’s acceptance has '
  + 'changed. Open Who’s Accepted on a document to see where it stands.';
