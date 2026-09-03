// A medical document is not sent without being asked, and the screen does not
// say it was not sent when it was. Compile with tsc, run with node.
//
// The defect these assertions stand against: app/(client)/injury-doc.tsx
// promised "the document stays in your account and only you can open it" in the
// same viewport as an upload button that POSTed the whole page to
// https://api.ocr.space/parse/image, with no consent question anywhere on the
// path. Two halves, and both are held here — the question that has to be
// answered first, and the four different sentences the app is allowed to say
// afterwards about where one document has actually been.
import {
  OCR_VENDOR, OCR_ENDPOINT, maySendToOcr,
  CONSENT_TITLE, CONSENT_WHO, CONSENT_WHAT, CONSENT_RETENTION, CONSENT_IF_YOU_DECLINE,
  CONSENT_SEND_LABEL, CONSENT_KEEP_LABEL, CONSENT_CANCEL_LABEL,
  CONSENT_SEND_A11Y, CONSENT_KEEP_A11Y, CONSENT_CANCEL_A11Y,
  SCREEN_PROMISE, docSendLine, docSendState,
  REFUSED_TITLE, REFUSED_NOTE, RECORD_FAILED_TITLE, RECORD_FAILED_NOTE, ADD_IT_MYSELF_LABEL,
  type OcrAnswer, type DocSendState,
} from './injuryDocConsent';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the gate ───────────────────────────────────────────────────────────── */

eq(maySendToOcr('granted'), true, 'yes means the document may be sent');
eq(maySendToOcr('refused'), false, 'and no means it may not');

// Over the whole type rather than the two cases above, so a third answer added
// later cannot quietly default to sending. There are only two answers and both
// are decisions; if a future 'unasked' appears, this fails until somebody
// decides what it means.
const ANSWERS: OcrAnswer[] = ['granted', 'refused'];
eq(ANSWERS.filter(maySendToOcr).length, 1, 'exactly one answer permits the send');

/* ── the question names who, and what ───────────────────────────────────── */

eq(OCR_VENDOR, 'OCR.space', 'the vendor is named, because "a third-party service" is not a name');
ok(OCR_ENDPOINT.startsWith('https://api.ocr.space/'), 'and the recorded endpoint is the one the edge function POSTs to');

ok(CONSENT_WHO.includes(OCR_VENDOR), 'the question names the company by name');
ok(/not part of this app/i.test(CONSENT_WHO), 'and says it is outside this app, which is the part somebody would otherwise assume');
ok(/not part of your gym/i.test(CONSENT_WHO), 'and outside their gym, which is the other thing they would assume');

// The sentence people get wrong when they imagine OCR: they picture "left knee"
// leaving, not a photograph of a page with their clinician's name on it.
ok(/whole document/i.test(CONSENT_WHAT), 'what goes is the whole document, said in those words');
ok(/every page/i.test(CONSENT_WHAT), 'every page of it, not the first');
ok(/not just the words about your injury/i.test(CONSENT_WHAT), 'and explicitly not an extract, because that is what people assume OCR sends');
ok(/your name/i.test(CONSENT_WHAT) && /clinician/i.test(CONSENT_WHAT),
  'and it says what is printed on such a page, which is the reason any of this matters');

// Retention. The repository cannot show that OCR.space offers a do-not-store
// control, and the edge function asks for nothing of the kind, so the copy says
// the verifiable thing and makes no promise in either direction.
ok(/do not ask them to delete it/i.test(CONSENT_RETENTION),
  'the retention sentence says plainly that nothing asks the vendor to delete the copy');
ok(!/deleted immediately|not stored|never stored|erased/i.test(CONSENT_RETENTION),
  'and claims no retention guarantee, because nothing in this repository establishes one');

/* ── declining is a route, and it is described BEFORE the choice ────────── */

ok(/saved privately in your account/i.test(CONSENT_IF_YOU_DECLINE),
  'saying no still keeps the document — which is exactly what the old sentence claimed of every document');
ok(/nothing is sent anywhere/i.test(CONSENT_IF_YOU_DECLINE), 'and sends nothing');
ok(/type the injury in yourself/i.test(CONSENT_IF_YOU_DECLINE),
  'and names the route that still works, which is the manual screen this app has always had');
ok(/exactly the same/i.test(CONSENT_IF_YOU_DECLINE),
  'and says the result is not a lesser disclosure, because a decline that costs you your injury record is not a real choice');

/* ── three answers, three labels, and none of them ambiguous ───────────── */

const LABELS = [CONSENT_SEND_LABEL, CONSENT_KEEP_LABEL, CONSENT_CANCEL_LABEL];
eq(new Set(LABELS).size, 3, 'three distinct buttons for three distinct outcomes');
for (const l of LABELS) ok(l.trim().length > 0, `a button label is not empty: ${JSON.stringify(l)}`);

// House rule: a button is Title Case. Small words stay lowercase unless they
// open the string — "Send It to Be Read".
for (const l of LABELS) {
  ok(l[0] === l[0].toUpperCase(), `button label opens in caps: ${l}`);
}
eq(ADD_IT_MYSELF_LABEL, 'Add It Myself', 'and the always-open route keeps the label the screen already used');

// Spoken out of context. A screen reader reads a button without the paragraph
// above it, and "Keep It Private" alone does not say private from whom.
ok(CONSENT_SEND_A11Y.includes(OCR_VENDOR), 'the spoken Send label names where the document goes');
ok(CONSENT_KEEP_A11Y.includes(OCR_VENDOR), 'and the spoken Keep label names what it is being kept from');
ok(/not add this document/i.test(CONSENT_CANCEL_A11Y), 'and Cancel says it adds nothing rather than "cancel"');
ok(CONSENT_TITLE.trim().endsWith('?'), 'the sheet asks a question rather than announcing a decision');

/* ── the standing promise is no longer false ───────────────────────────── */

// The exact sentence that was on the screen. If any of it comes back, this
// fails: it is a promise the app cannot keep for a member who says yes.
ok(!/only you can open it/i.test(SCREEN_PROMISE),
  'the false sentence is gone — a document that is sent to OCR.space is not one only its owner can open');
ok(!/stays in your account and only you/i.test(SCREEN_PROMISE), 'in that phrasing or any of it');

ok(SCREEN_PROMISE.includes(OCR_VENDOR), 'the standing notice names the vendor rather than leaving it to the sheet');
ok(/never sees the file/i.test(SCREEN_PROMISE), 'it keeps the thing that IS unconditionally true: the coach does not get the file');
ok(/we ask you about that every time/i.test(SCREEN_PROMISE),
  'and says the asking is per document, so nobody reads the first question as a setting they have now answered');
ok(/say no/i.test(SCREEN_PROMISE) && /sent nowhere/i.test(SCREEN_PROMISE),
  'and that the other answer exists and leaves the document in the account');

/* ── four states, four sentences, and the two that must never merge ────── */

const ALL: DocSendState[] = ['granted', 'refused', 'no-record', 'unknown'];
const lines = ALL.map(docSendLine);
eq(new Set(lines).size, 4, 'every state has its own sentence — loading, failed, absent and answered are not one message');
for (const l of lines) ok(l.trim().length > 0, 'no state renders as an empty line');

ok(/was sent to/i.test(docSendLine('granted')) && docSendLine('granted').includes(OCR_VENDOR),
  'a sent document says it was sent, and to whom');
ok(/with your permission/i.test(docSendLine('granted')),
  'and that it was asked about, which is the fact the record exists to support');

ok(/No part of it was sent/i.test(docSendLine('refused')), 'a refused document says nothing of it went');
ok(docSendLine('refused').includes(OCR_VENDOR), 'and names what it did not go to');

// THE assertion this whole module turns on. Every document uploaded before the
// consent question existed was sent unasked and has no row. If 'no-record' ever
// reads as "never sent", the fix begins by telling those members a new lie
// about the exact thing it was written to stop lying about.
ok(/no record either way/i.test(docSendLine('no-record')),
  'no row means no record, said in those words');
ok(!/not sent|never sent|nothing was sent|kept this one/i.test(docSendLine('no-record')),
  'and never claims the document was not sent — every document from before this question WAS sent, unasked');
ok(/cannot tell you whether it was sent/i.test(docSendLine('no-record')),
  'nor claims it was — it says outright that the app cannot tell them which, which is the true answer');
ok(docSendLine('no-record') !== docSendLine('refused'),
  'an absent record and a recorded refusal are different facts and say different things');

ok(/could not check/i.test(docSendLine('unknown')),
  'a failed read says the read failed, rather than answering about the document');
ok(!/not sent|was sent/i.test(docSendLine('unknown')), 'and makes no claim in either direction');

/* ── which state a document is in ──────────────────────────────────────── */

eq(docSendState('ready', 'granted'), 'granted', 'a granted row is a granted document');
eq(docSendState('ready', 'refused'), 'refused', 'and a refused row a refused one');
eq(docSendState('ready', null), 'no-record', 'a completed read that found no row is a document with no record');
eq(docSendState('ready', undefined), 'no-record', 'however the absence arrives');

// A read that has not finished, or failed, knows nothing about any document.
// Returning 'no-record' from either would report the absence of a row nobody
// managed to look for — the same mistake as an empty list under a failed read.
eq(docSendState('loading', null), 'unknown', 'a read still in flight is not an answer about the document');
eq(docSendState('error', null), 'unknown', 'and a failed read is not "no record", it is "we could not look"');
eq(docSendState('partial', null), 'unknown', 'a truncated page cannot prove a row is absent — only that it was not on that page');

// A row that came back is a row that exists, whatever the status of the read
// that carried it. Truncation can hide rows; it cannot invent them.
eq(docSendState('partial', 'granted'), 'granted', 'a row seen under a truncated read is still a row');
eq(docSendState('partial', 'refused'), 'refused', 'in either decision');

/* ── the two outcome panels ────────────────────────────────────────────── */

ok(/sent nowhere/i.test(REFUSED_TITLE), 'the decline outcome leads with the fact the member cares about');
ok(/saved/i.test(REFUSED_TITLE), 'and with the document still being theirs');
ok(REFUSED_NOTE.includes(OCR_VENDOR), 'the decline note names what nothing went to');
ok(/add the injury in your own words/i.test(REFUSED_NOTE), 'and points at the route that still works');
ok(!/could not|failed|sorry|error/i.test(REFUSED_NOTE),
  'and is not written as a failure — the member chose this and the feature did what they asked');

// The member said yes, the agreement did not land, and the document was NOT
// sent. That sentence has to carry both halves without reading as a refusal
// they made or as a read that was attempted and failed.
ok(/has not been sent anywhere/i.test(RECORD_FAILED_NOTE), 'the unrecorded-consent note says the document did not go');
ok(/could not write down that you agreed/i.test(RECORD_FAILED_NOTE), 'and says why, which is about us and not about them');
ok(/we cannot show you afterwards/i.test(RECORD_FAILED_NOTE),
  'and gives the reason plainly: a consent the app cannot produce is one it will not act on');
ok(/add the injury yourself/i.test(RECORD_FAILED_NOTE), 'and still leaves the route open');
ok(/did not send/i.test(RECORD_FAILED_TITLE), 'and the title says what happened rather than "something went wrong"');
// Cast because both are `const` string literals and tsc otherwise refuses the
// comparison as provably false. The assertion is about the copy, not the types:
// somebody editing one of these must not paste it over the other.
ok(String(RECORD_FAILED_NOTE) !== String(REFUSED_NOTE),
  'a failure on our side and a decision on theirs are not the same sentence');

/* ── sentence case, because these are prose and not labels ─────────────── */

for (const [name, s] of Object.entries({
  CONSENT_WHO, CONSENT_WHAT, CONSENT_RETENTION, CONSENT_IF_YOU_DECLINE,
  SCREEN_PROMISE, REFUSED_NOTE, RECORD_FAILED_NOTE,
})) {
  ok(s[0] === s[0].toUpperCase(), `${name} opens with a capital`);
  ok(/[.!?]$/.test(s.trim()), `${name} is a finished sentence`);
  ok(/ [a-z]/.test(s), `${name} is sentence case rather than Title Case prose`);
}

if (errors.length) {
  console.error(`injuryDocConsent: ${errors.length} failed`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('injuryDocConsent: ok');
