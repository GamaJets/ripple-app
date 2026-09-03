// Asking before a member's body-composition printout leaves their account —
// and saying afterwards, truthfully, whether it did.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE DEFECT
// ═══════════════════════════════════════════════════════════════════════════
//
// app/(client)/scans.tsx let a member photograph the sheet an InBody (or a
// DEXA, or a clinic's body-composition printout) prints out, and filled the
// weight, body-fat and muscle boxes from it. To do that it did two things, in
// parallel, on every single photograph:
//
//   analyzeInBody(b64)  →  vision-analyze  →  https://api.anthropic.com/…
//   ocrInBody(b64)      →  ocr-scan        →  https://api.ocr.space/parse/image
//
// Two named companies, neither of them this app and neither of them the
// member's gym, each handed the WHOLE PAGE. The only thing standing in front of
// that was `ensureMediaPermission('camera', 'add a scan')` — a question about
// the camera, which is hardware, and not about the destination, which is the
// public internet.
//
// What is printed on that page is not the three numbers the screen keeps. An
// InBody result sheet carries the member's NAME, their date of birth or age,
// their height, an ID number, the gym or clinic's name and address across the
// header, the date and time they stood on it, and then the whole composition
// breakdown: total body water, protein, minerals, fat mass, lean mass segment
// by segment — left arm, right arm, trunk, left leg, right leg — visceral fat
// level, basal metabolic rate, and a score. A person's body, measured, with
// their name on it and the clinic's letterhead above it.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS IS THE INJURY-DOCUMENT CASE AND NOT THE MEAL-PHOTO CASE
// ═══════════════════════════════════════════════════════════════════════════
//
// Three consent shapes already existed when this was written, and the whole
// question was which one this is:
//
//   src/lib/coachShare.ts       the member's own figures, as text, to the AI
//                               coach. Asked once, remembered, per account.
//   src/lib/photoAI.ts          a photograph the member FRAMES, to Anthropic.
//                               Asked once per subject, remembered.
//   src/lib/injuryDocConsent.ts a medical document, to OCR.space. Asked PER
//                               DOCUMENT, with a row written before the send.
//
// The dividing line between the second and the third is not how sensitive the
// data is. It is WHO COMPOSED THE THING and WHETHER THE PERSON ANSWERING HAS
// SEEN WHAT IS IN IT.
//
// A meal photograph is composed by the member, in the moment, looking at the
// frame, for this purpose. There is no gap between what they agreed to and what
// they can see, because the thing does not exist until they make it — so one
// remembered answer genuinely covers the next one, and a per-photo question on
// a path used four times a day becomes a tap-through, which is not consent.
//
// A body-composition sheet is the other case, and it is the injury document's
// case almost exactly:
//
//   1. IT IS COMPOSED BY SOMEBODY ELSE. A machine in a gym or a clinic decided
//      what is printed on it. The member did not choose to put their date of
//      birth or the clinic's name on the page and cannot take them off.
//
//   2. EACH ONE IS DIFFERENT, AND THE NEXT ONE IS UNKNOWN. This is the injury
//      module's argument, and it transfers whole. A member who agreed in
//      January, standing at their gym's InBody, has not thereby agreed about
//      the DEXA report a hospital gives them in June — a different machine, a
//      different letterhead, a different set of things printed down the side.
//      Nothing about the first answer knows what the second sheet contains, and
//      neither did the person giving it.
//
//   3. IT IS RARE. Two, four, maybe twelve of these in a year — a member weighs
//      in every few weeks at most, and this screen exists because they weigh in
//      seldom enough to want the history. A question asked twelve times a year
//      is still being READ the twelfth time. That is the property that makes a
//      per-item question honest here and dishonest on the food log.
//
// So: PER SHEET, before anything leaves, with the answer written down.
//
// ═══════════════════════════════════════════════════════════════════════════
// AND WHY THE RECORD IS A DATABASE ROW
// ═══════════════════════════════════════════════════════════════════════════
//
// The same reason supabase/parts/1000-*.sql gives for injury documents: a
// consent nobody can produce afterwards is indistinguishable from no consent at
// all. An AsyncStorage flag would say "this person agreed to something once, on
// this handset, and we cannot tell you which sheet or when or to whom", and it
// would vanish with a reinstall — which is the wrong direction for a record
// whose whole job is to outlive the event.
//
// One row per reading, therefore, and THE SEND WAITS FOR IT. If the row does
// not land, nothing is posted to either vendor; the member is told exactly
// that, and the manual route — typing the three numbers off the sheet in their
// hand — is right there and always was. The cost is that a network failure
// between the answer and the send blocks the read. That is the correct trade:
// the alternative is a state where the bytes have gone and the agreement is not
// on file, which is the app being able to CLAIM a consent it cannot SHOW.
//
// A REFUSAL is recorded too, and if that write fails nothing is sent either —
// the refusal is honoured by not acting, not by the row. See decision 4 in
// src/lib/injuryDocConsent.ts, which argues all of this at length and which
// this module deliberately mirrors rather than re-deciding.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THERE IS NO OBJECT PATH ON THE ROW, AND WHAT IT IS KEYED ON INSTEAD
// ═══════════════════════════════════════════════════════════════════════════
//
// An injury document is STORED — there is a private bucket, an object path, and
// a row that can name it. A scan sheet is not. The photograph is read from and
// discarded; only the three figures the member confirms become a `scans` row,
// and `scans` has never held an image.
//
// So the row is keyed on a READ ID minted on the device for this one reading.
// It cannot say "which of my stored sheets" because there are no stored sheets;
// it says, exactly and only, "on this date this member was asked about a body
// composition sheet, named these companies, and answered this". That is a
// producible record of what left, which is what the row is for.
//
// What is deliberately NOT done is key it to the saved scan. That would need a
// column on `scans`, would be null for every reading the member abandoned, and
// would tie a consent record to a row the member can delete — and deleting your
// own weigh-in must not delete the record that a copy of the printout went to
// two companies. Deleting your copy does not un-send theirs.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE QUESTION NAMES WHO IS ACTUALLY GOING TO GET IT
// ═══════════════════════════════════════════════════════════════════════════
//
// Both readers run, in parallel, against the same image — unless the vision
// reader is switched off in this build, in which case only OCR.space is called.
// `scanSheetRecipients` takes that flag, so the sentence the member reads names
// the companies that will actually receive the page in the build they are
// holding, and the row records the same list. Naming a company that is not
// going to get it is as wrong as omitting one that is; both make the sentence
// something other than a description of what happens next.
//
// Retention: nothing in this repository asks either vendor to refrain from
// storing the upload, and whether their APIs offer such a control cannot be
// determined from here. No claim is made in either direction —
// `SCAN_CONSENT_RETENTION` says the one thing that is verifiable, and it is
// deliberately not softened. Same stance, same wording rule, as
// CONSENT_RETENTION in the injury-document module.

/* ── who it goes to ─────────────────────────────────────────────────────── */

/** One named destination. `vendor` is what the member reads; `endpoint` is
 *  recorded on the row as well, so a row written today still says where the
 *  sheet went if a function is ever re-pointed. */
export interface ScanRecipient {
  vendor: string;
  endpoint: string;
  /** What that vendor is, in four words, because "a service" is not an answer
   *  to "who are you sending my body composition to". */
  role: string;
}

/** supabase/functions/vision-analyze/index.ts POSTs here. */
export const SCAN_VISION_RECIPIENT: ScanRecipient = {
  vendor: 'Anthropic',
  endpoint: 'https://api.anthropic.com/v1/messages',
  role: 'who run the model that reads the page',
};

/** supabase/functions/ocr-scan/index.ts POSTs here. The same vendor the injury
 *  document path names, which is not a reason to reuse that consent: a
 *  different document, a different purpose, a different question. */
export const SCAN_OCR_RECIPIENT: ScanRecipient = {
  vendor: 'OCR.space',
  endpoint: 'https://api.ocr.space/parse/image',
  role: 'a text-recognition company',
};

/**
 * The companies that will actually receive this page in this build.
 *
 * OCR.space always — `ocrInBody` is called unconditionally. Anthropic only when
 * the vision reader is on, because `analyzeInBody` is not called otherwise.
 *
 * Order is fixed rather than derived, so the sentence and the recorded row list
 * them the same way every time and two rows about the same build are
 * comparable.
 */
export function scanSheetRecipients(visionOn: boolean): ScanRecipient[] {
  return visionOn
    ? [SCAN_VISION_RECIPIENT, SCAN_OCR_RECIPIENT]
    : [SCAN_OCR_RECIPIENT];
}

/** "Anthropic and OCR.space", or just the one. Oxford-free and readable; the
 *  roles are printed under it rather than crammed into the same sentence. */
export function recipientNames(rs: readonly ScanRecipient[]): string {
  const names = rs.map((r) => r.vendor);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* ── the answer ─────────────────────────────────────────────────────────── */

/**
 * What the member said about THIS sheet.
 *
 * Two members, both of them decisions. There is deliberately no 'unasked': this
 * is the required argument of `readScanSheet` in src/ui/scanSheets.ts, and a
 * value meaning "we did not ask" would be a value that compiles into the
 * original defect.
 *
 * Cancelling is not a member — cancelling means no photograph, so there is
 * nothing to hold an answer about. The screen handles it by never calling.
 */
export type ScanSheetAnswer = 'granted' | 'refused';

/** Whether the page may be posted to the vendors. One line, so the rule is a
 *  function somebody can assert rather than an `if` inside a routine that also
 *  does five other things. */
export function maySendScanSheet(answer: ScanSheetAnswer): boolean {
  return answer === 'granted';
}

/* ── what the member is asked ───────────────────────────────────────────── */

export const SCAN_CONSENT_KICKER = 'Before you photograph the sheet';
export const SCAN_CONSENT_TITLE = 'Send this printout to be read?';

/** WHO. Named, named as outside this app and this gym, and only the ones that
 *  are actually going to get it in this build. */
export function scanConsentWho(rs: readonly ScanRecipient[]): string {
  // One sentence shape for one company and for two. The negation is spelled out
  // both times — "neither is part of your gym" drops the word a member is
  // scanning for, and this is the line they are scanning.
  return `To read the numbers off your sheet the app sends a photo of it to ${recipientNames(rs)} — ${rs.map((r) => `${r.vendor}, ${r.role}`).join('; ')}. They are not part of this app and not part of your gym.`;
}

/** WHAT. The whole page, and what is printed on a page like this — which is the
 *  part people get wrong: they picture the app sending "82.4 kg". */
export const SCAN_CONSENT_WHAT =
  'What goes is the whole sheet, as a picture — not just the three figures this screen keeps. That picture carries whatever the machine printed: your name, your age or date of birth, your height, the gym or clinic at the top, the date you stood on it, and every line of the breakdown down the side.';

/** What this app cannot promise once a copy has gone. Not softened, and not a
 *  claim in either direction — see the retention note in the header. */
export function scanConsentRetention(rs: readonly ScanRecipient[]): string {
  return `Once a copy has left, what ${recipientNames(rs)} do with it is theirs, not ours, and we do not ask them to delete it.`;
}

/** What happens on no — a real route, stated before the choice rather than
 *  discovered after it. The manual route is not a downgrade here: the member is
 *  standing in front of the printout, and typing three numbers off a page in
 *  your hand is how this screen worked before any reader existed. */
export const SCAN_CONSENT_IF_YOU_DECLINE =
  'If you say no, nothing is sent anywhere. You type the weight, body fat and muscle off the sheet yourself — it is three numbers, they go in exactly the same, and the scan counts exactly the same as one we had read.';

export const SCAN_CONSENT_SEND_LABEL = 'Send It to Be Read';
export const SCAN_CONSENT_TYPE_LABEL = 'I’ll Type the Numbers';
export const SCAN_CONSENT_CANCEL_LABEL = 'Cancel';

export function scanConsentSendA11y(rs: readonly ScanRecipient[]): string {
  return `Send a photo of this sheet to ${recipientNames(rs)} to be read`;
}
export const SCAN_CONSENT_TYPE_A11Y =
  'Do not send anything — type the numbers off the sheet myself';
export const SCAN_CONSENT_CANCEL_A11Y = 'Do not photograph the sheet at all';

/* ── the outcome the member lands on ────────────────────────────────────── */

/** Shown when the member said no. Not an error, and not styled like one: this
 *  is the feature working the way they asked for it to. */
export const SCAN_REFUSED_TITLE = 'Sent nowhere';
export const SCAN_REFUSED_NOTE =
  'Nothing about your sheet left this phone, so there is nothing to fill the boxes in with. Type the weight, body fat and muscle off the printout and save it — it counts exactly the same.';

/**
 * Shown when the member said YES and the agreement could not be written down.
 *
 * Nothing was sent, because of the ordering argued in the header. The sentence
 * has to carry that without sounding like a refusal the member made: they
 * agreed, and the app declined to proceed on its own account.
 */
export const SCAN_RECORD_FAILED_TITLE = 'We did not send it';
export const SCAN_RECORD_FAILED_NOTE =
  'Nothing has been sent anywhere. We could not write down that you agreed to your sheet being read, and we will not send a page with your name and your body composition on it on an agreement we cannot show you afterwards. Try again in a moment, or type the numbers in.';

/** The one route that is always open, whatever went wrong above. */
export const SCAN_TYPE_IT_MYSELF_LABEL = 'Type the Numbers';

/* ── what the screen may say about a reading ────────────────────────────── */

/**
 * What the record says about one reading.
 *
 *   granted    a copy went to the named vendors, with a recorded agreement
 *   refused    asked, declined — nothing was sent
 *   no-record  we hold no answer. Every sheet photographed before this module
 *              existed WAS sent to both vendors, unasked, and has no row.
 *              NOT a synonym for 'refused'.
 *   unknown    the consent read itself failed. Not an answer about a reading,
 *              an answer about this session.
 */
export type SheetSendState = 'granted' | 'refused' | 'no-record' | 'unknown';

/**
 * The standing sentence on the screen, replacing the silence.
 *
 * It does not promise that a sheet is never sent, because for a member who says
 * yes that would be a lie in a longer sentence. It says the two things true of
 * every sheet unconditionally — the picture is not kept and the coach never
 * gets it — and then says plainly that reading it means sending it, and that
 * the member is asked each time.
 */
export function scanScreenPromise(rs: readonly ScanRecipient[]): string {
  return `The photo of your sheet is not kept and your coach never sees it — only the figures you save. Reading a sheet means sending a picture of it to ${recipientNames(rs)}, outside this app, and we ask you about that every time before anything leaves. Say no and you type the three numbers in yourself.`;
}

/**
 * What is true of ONE recorded reading.
 *
 * Four states, four sentences, and the two that look alike are the two that
 * must not be merged: 'refused' is a decision this app recorded and can show,
 * 'no-record' is the absence of one. Reading the second as the first is how the
 * app would end up claiming a consent it cannot produce — for sheets that were,
 * in fact, sent without anybody being asked.
 */
export function sheetSendLine(state: SheetSendState, vendors: readonly string[] = []): string {
  const who = vendors.length ? vendors.join(' and ') : 'the readers';
  switch (state) {
    case 'granted':
      return `A picture of this sheet was sent to ${who} to be read, with your permission.`;
    case 'refused':
      return `You kept this one to yourself. No part of it was sent to ${who}.`;
    case 'no-record':
      return 'We have no record either way for this one, so we cannot tell you whether it was sent.';
    default:
      return 'We could not check what happened to this one just now.';
  }
}

/**
 * The state for one reading, from the read that went looking for its row.
 *
 * `status` first and on purpose: a failed read has no answer about any reading,
 * and returning 'no-record' from it would report the absence of a row we never
 * managed to look for. Same rule the rest of the app applies to an empty list
 * under a failed read.
 */
export function sheetSendState(
  status: 'loading' | 'ready' | 'partial' | 'error',
  decision: ScanSheetAnswer | null | undefined,
): SheetSendState {
  if (decision === 'granted' || decision === 'refused') return decision;
  return status === 'ready' ? 'no-record' : 'unknown';
}
