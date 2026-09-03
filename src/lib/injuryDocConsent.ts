// Asking before a member's medical record leaves their account — and saying
// afterwards, truthfully, whether it did.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE DEFECT
// ═══════════════════════════════════════════════════════════════════════════
//
// app/(client)/injury-doc.tsx told the member, in the same viewport as the
// upload button:
//
//     "The document stays in your account and only you can open it."
//
// It did not. src/ui/injuryDocs.ts uploaded the file to a private bucket — that
// part was true — and then handed the SAME bytes, base64-encoded, to
// `supabase.functions.invoke('ocr-scan')`, which POSTs them to
// https://api.ocr.space/parse/image. A named third party, on the public
// internet, holding a physiotherapy report: a diagnosis, a clinician, a
// hospital number, a date of birth, findings about things that have nothing to
// do with training.
//
// There was no consent question anywhere on that path. Not a buried setting,
// not a first-run flag — nothing. `grep -n consent src/ui/injuryDocs.ts`
// returned no lines at all. And src/lib/coachShare.ts:NEVER_SENT prints
// "anything from a document you uploaded" under a heading reading Never sent,
// which is true of the AI coach and reads, to somebody who has just uploaded a
// document, as a statement about the document.
//
// So the app made a written promise about a person's clinical record and broke
// it silently, in the same breath, on the one screen where the person was
// deciding whether to trust it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE TWO HALVES, AND WHY NEITHER IS ENOUGH ALONE
// ═══════════════════════════════════════════════════════════════════════════
//
// Fixing only the WORDING — "we send your document to OCR.space" in the notice
// and nothing else — normalises the send. It converts a broken promise into a
// disclosure the member scrolls past on their way to the only button on the
// screen, and they still have no way to say no. That is worse in one respect
// than the bug: it is deliberate.
//
// Fixing only the ASKING leaves the false sentence on screen. A member reads
// "only you can open it", is then asked a question they have just been told the
// answer to, and taps yes because the screen has already promised them nothing
// happens. Consent obtained under a false statement is not consent.
//
// So both, and this module holds both: the question, and every sentence the
// screen is allowed to say about where a document has been.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE FIVE DECISIONS
// ═══════════════════════════════════════════════════════════════════════════
//
// 1 · PER DOCUMENT, AND BEFORE THE SEND.
//
//     Not a setting on the account screen, and not a one-time flag. Two
//     reasons, and the second is the one that decides it.
//
//     A setting is answered once, months before the document that matters
//     exists. The member who ticked "yes, read my documents" while adding a
//     sprained ankle from a walk-in clinic has not agreed to send the oncology
//     letter they upload in March. Nothing about the first answer knows what
//     the second document contains, and the person answering did not either.
//
//     And a one-time flag makes the send the DEFAULT for everything after it,
//     which is the shape of the original defect with a tick box in front of it.
//     The question is asked against a document the member is holding, at the
//     moment they can still choose the other route, every time.
//
//     Structurally: `readInjuryDocument` takes the answer as a REQUIRED
//     argument (src/ui/injuryDocs.ts). There is no default parameter and no
//     'unasked' member of `OcrAnswer`, so a call site that forgets to ask does
//     not compile. That is the only enforcement that survives a refactor.
//
// 2 · IT NAMES WHO, AND WHAT.
//
//     "A third-party service" is not a name. `OCR_VENDOR` is 'OCR.space' and it
//     is in the question the member reads, because a person deciding whether to
//     send their medical record somewhere is entitled to know where, and can
//     then go and read that company's terms if they want to.
//
//     And what goes is the WHOLE PAGE — every page of a PDF, at 1512px wide,
//     not an extract, not the words the extractor matched on. That is the
//     sentence people get wrong when they imagine OCR: they picture the app
//     sending "left knee". It sends the image, and the image carries their name
//     and their clinician's. `CONSENT_WHAT` says so in those words.
//
// 3 · DECLINING LEAVES THE FEATURE WORKING.
//
//     A member who says no still has an injury to record. So the decline is not
//     an error state and not a dead end: the document is still stored privately
//     in their own bucket — which is the thing the original sentence promised
//     and, on this path, is now simply true — and they land on
//     app/(client)/injuries.tsx, which has let people type an injury in by hand
//     since long before any of this existed. Same array, same coach view, same
//     acknowledgement gate. They lose the typing, not the feature.
//
//     There is a third answer, Cancel, which does nothing at all: no upload, no
//     send. It exists because "I opened the wrong file" is a real answer and
//     forcing it into one of the other two would store a document the member
//     never meant to add.
//
// 4 · THE ANSWER IS RECORDED, AND THE SEND WAITS FOR THE RECORD.
//
//     A claim that somebody agreed, with nothing behind it, is the defect this
//     codebase refuses everywhere else — `injury_acknowledgements` stores WHICH
//     disclosures were read rather than a bare timestamp, `program_injury_
//     acknowledgements` is immutable so neither party can revise it, and
//     src/ui/injuryAcks.tsx counts the returned row rather than trusting an
//     un-errored write. An unrecorded consent is a consent the app can assert
//     and cannot show, and the member cannot check.
//
//     So: one row per document, written BEFORE the invoke, and if the row does
//     not land the document is not sent. That ordering is the whole point. It
//     makes the record load-bearing rather than decorative — the app is never
//     in a state where the bytes have gone and the agreement is not on file.
//     The cost is that a network failure between the upload and the send blocks
//     the read; the member is told exactly that, and the manual route is right
//     there. See supabase/parts/1000-*.sql for the table and its policies.
//
//     A REFUSAL is recorded too, and for the harder reason: it is what lets the
//     screen say "nothing from this document was sent" later and mean it. If
//     that write fails, nothing is sent regardless — the refusal is honoured by
//     not acting, not by the row — and the document simply shows as having no
//     record, which is the honest answer and not a claim in either direction.
//
// 5 · NO ROW IS NOT THE SAME AS "NEVER SENT".
//
//     `DocSendState` has four members and this is why. Every document uploaded
//     before this module existed WAS sent to OCR.space, without being asked,
//     and has no row. If 'no-record' rendered as "never sent" the fix would
//     have started by telling every existing member a new lie about the exact
//     thing it was written to stop lying about. It renders as "no record either
//     way", which is what the app actually knows.
//
//     'unknown' is the fourth: the consent read itself failed. Loading, failed
//     and absent are three different sentences here as everywhere.
//
// ═══════════════════════════════════════════════════════════════════════════
// RETENTION AT OCR.SPACE — WHAT IS AND IS NOT KNOWN
// ═══════════════════════════════════════════════════════════════════════════
//
// supabase/functions/ocr-scan/index.ts posts a url-encoded form with exactly
// five fields: `apikey`, `OCREngine=2`, `scale=true`, `base64Image`, and
// `filetype=PDF` for a PDF. Nothing in that request asks OCR.space to refrain
// from storing the upload, and nothing anywhere in this repository does.
//
// Whether their API offers such a parameter at all CANNOT BE DETERMINED FROM
// THIS CODEBASE, and no claim is made here in either direction. The member is
// therefore told the one thing that is verifiable — that a copy leaves and this
// app cannot promise what happens to it afterwards — rather than a reassurance
// nobody here has checked. `CONSENT_RETENTION` is that sentence and it is
// deliberately not softened.
//
// If somebody establishes that a retention control exists, the change is one
// `form.set(...)` in the edge function plus a rewrite of that one string. Until
// then the string is the truth.

/* ── who it goes to ─────────────────────────────────────────────────────── */

/** Named, because "a third-party service" is not a name. */
export const OCR_VENDOR = 'OCR.space';

/** The exact endpoint the edge function POSTs to. Recorded on the consent row
 *  as well as shown, so a row written today still says where the document went
 *  if the endpoint ever moves. */
export const OCR_ENDPOINT = 'https://api.ocr.space/parse/image';

/* ── the answer ─────────────────────────────────────────────────────────── */

/**
 * What the member said about THIS document.
 *
 * Two members, both of them decisions. There is deliberately no 'unasked': the
 * type is the argument `readInjuryDocument` requires, and a value meaning "we
 * did not ask" would be a value that compiles into the original defect.
 *
 * Cancelling is not a member either — cancelling means no document, so there is
 * nothing to hold an answer about. The screen handles it by never calling.
 */
export type OcrAnswer = 'granted' | 'refused';

/** Whether the bytes may be posted to the vendor. One line, and it exists so
 *  the rule is a function somebody can assert rather than an `if` inside an
 *  upload routine that also does five other things. */
export function maySendToOcr(answer: OcrAnswer): boolean {
  return answer === 'granted';
}

/* ── what the member is asked ───────────────────────────────────────────── */

export const CONSENT_TITLE = 'Send this document to be read?';

/** WHO. Named, and named as being outside this app and this gym. */
export const CONSENT_WHO =
  `To read your document the app sends it to ${OCR_VENDOR}, a text-recognition company. They are not part of this app and not part of your gym.`;

/** WHAT. The whole page, and what a page of a clinical document has on it. */
export const CONSENT_WHAT =
  'What goes is the whole document — every page of it, as a picture, not just the words about your injury. That picture carries your name, your clinician and anything else printed on the page.';

/** What this app cannot promise about the copy once it has gone. See the
 *  retention note in the header: not softened, and not a claim either way. */
export const CONSENT_RETENTION =
  `Once a copy has left, what ${OCR_VENDOR} does with it is theirs, not ours, and we do not ask them to delete it.`;

/** What happens on no — a real route, stated before the choice rather than
 *  discovered after it. */
export const CONSENT_IF_YOU_DECLINE =
  'If you say no, the document is still saved privately in your account and nothing is sent anywhere. You then type the injury in yourself, and it counts exactly the same as one we had read.';

export const CONSENT_SEND_LABEL = 'Send It to Be Read';
export const CONSENT_KEEP_LABEL = 'Keep It Private';
export const CONSENT_CANCEL_LABEL = 'Cancel';

/** Spoken labels. "Keep It Private" out of context does not say private from
 *  whom, and a screen reader reads a button without the paragraph above it. */
export const CONSENT_SEND_A11Y = `Send this document to ${OCR_VENDOR} to be read`;
export const CONSENT_KEEP_A11Y = `Save this document to my account and do not send it to ${OCR_VENDOR}`;
export const CONSENT_CANCEL_A11Y = 'Do not add this document at all';

/* ── what the screen may say about a document ───────────────────────────── */

/**
 * Where one stored document has been.
 *
 *   granted    a copy went to the vendor, with a recorded agreement
 *   refused    stored, asked, declined — nothing was sent
 *   no-record  we hold no answer for it. Every document from before this
 *              module was sent unasked and lands here; so does a document
 *              whose refusal row failed to write. NOT a synonym for 'refused'.
 *   unknown    the consent read failed. Not an answer about the document at
 *              all, an answer about this session.
 */
export type DocSendState = 'granted' | 'refused' | 'no-record' | 'unknown';

/**
 * The standing sentence at the top of the screen, replacing the false one.
 *
 * The original said the document "stays in your account and only you can open
 * it", full stop, above a button that sent it. This says the two things that
 * are true of every document unconditionally — the coach never gets the file,
 * and it opens inside the app — and then says plainly that reading it means
 * sending it, and that the member is asked each time.
 *
 * It does NOT promise the document is never sent, because for a member who
 * says yes that would be the same lie in a longer sentence. The per-document
 * truth is `docSendLine` below, which is printed against each document once
 * there is an answer to print.
 */
export const SCREEN_PROMISE =
  `Your coach never sees the file — only the injury you confirm. Reading a document means sending a copy of it to ${OCR_VENDOR}, a company outside this app, and we ask you about that every time before anything leaves. Say no and it is saved to your account and sent nowhere.`;

/**
 * What is true of ONE stored document, in the list.
 *
 * Four states, four sentences, and the two that look alike are the two that
 * must not be merged: 'refused' is a decision this app recorded and can show,
 * 'no-record' is the absence of one. Reading the second as the first is how the
 * app would end up claiming a consent it cannot produce — for documents that
 * were, in fact, sent without being asked.
 */
export function docSendLine(state: DocSendState): string {
  switch (state) {
    case 'granted':
      return `A copy of this document was sent to ${OCR_VENDOR} to be read, with your permission.`;
    case 'refused':
      return `You kept this one private. No part of it was sent to ${OCR_VENDOR}.`;
    case 'no-record':
      return `We have no record either way for this document, so we cannot tell you whether it was sent to ${OCR_VENDOR}.`;
    default:
      return 'We could not check what happened to this document just now.';
  }
}

/**
 * The state for one document, from the read that went looking for its row.
 *
 * `status` first and on purpose: a failed read has no answer about any
 * document, and returning 'no-record' from it would report the absence of a row
 * we never managed to look for. Same rule the rest of the app applies to an
 * empty list under a failed read.
 *
 * 'partial' is treated as unknown FOR A DOCUMENT WHOSE ROW WAS NOT SEEN: a
 * truncated page of consents genuinely cannot tell you that a row does not
 * exist. A row that WAS seen is an answer whatever the status, because a row
 * that came back is a row that exists.
 */
export function docSendState(
  status: 'loading' | 'ready' | 'partial' | 'error',
  decision: OcrAnswer | null | undefined,
): DocSendState {
  if (decision === 'granted' || decision === 'refused') return decision;
  return status === 'ready' ? 'no-record' : 'unknown';
}

/* ── the outcome the member lands on ────────────────────────────────────── */

/** Shown when the member said no. Not an error, and not styled like one: this
 *  is the feature working the way they asked for it to. */
export const REFUSED_TITLE = 'Saved, and sent nowhere';
export const REFUSED_NOTE =
  `This document is in your account and nothing about it went to ${OCR_VENDOR}. Nobody read it, so there is nothing to suggest — add the injury in your own words and it works exactly the same.`;

/**
 * Shown when the member said YES and the agreement could not be written down.
 *
 * The document is stored and it was NOT sent, because of the ordering argued in
 * decision 4. The sentence has to carry that without sounding like a refusal
 * the member made: they agreed, and the app declined to proceed on its own
 * account.
 */
export const RECORD_FAILED_TITLE = 'We did not send it';
export const RECORD_FAILED_NOTE =
  'Your document is saved, and it has not been sent anywhere. We could not write down that you agreed to it being read, and we will not send a medical document on an agreement we cannot show you afterwards. Try again in a moment, or add the injury yourself.';

/** The one route that is always open, whatever went wrong above. */
export const ADD_IT_MYSELF_LABEL = 'Add It Myself';
