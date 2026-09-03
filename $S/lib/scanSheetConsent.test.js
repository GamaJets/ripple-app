"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A page with somebody's name, their gym's letterhead and their whole body
// composition on it does not go to two companies on the strength of a camera
// permission. Compile with tsc, run with node.
const scanSheetConsent_1 = require("./scanSheetConsent");
const photoAI_1 = require("./photoAI");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the gate ───────────────────────────────────────────────────────────── */
ok((0, scanSheetConsent_1.maySendScanSheet)('granted'), 'a recorded yes is the only thing that sends');
ok(!(0, scanSheetConsent_1.maySendScanSheet)('refused'), 'and no is no');
// The type is the enforcement: there is no 'unasked' to pass, so a screen that
// has not asked cannot call `readScanSheet` at all. This asserts the shape of
// the union rather than a behaviour, because the shape IS the mechanism.
const everyAnswer = ['granted', 'refused'];
eq(everyAnswer.length, 2, 'two answers, both of them decisions — no third meaning "we did not ask"');
/* ── who is named, and only who will actually get it ────────────────────── */
const both = (0, scanSheetConsent_1.scanSheetRecipients)(true);
const ocrOnly = (0, scanSheetConsent_1.scanSheetRecipients)(false);
eq(both.length, 2, 'with the vision reader on, both companies receive the page');
eq(ocrOnly.length, 1, 'with it off, only the text reader does');
eq(ocrOnly[0].vendor, scanSheetConsent_1.SCAN_OCR_RECIPIENT.vendor, 'and OCR.space is the one that always runs');
ok(both.some((r) => r.vendor === scanSheetConsent_1.SCAN_VISION_RECIPIENT.vendor), 'Anthropic is named when Anthropic is called');
ok(!ocrOnly.some((r) => r.vendor === scanSheetConsent_1.SCAN_VISION_RECIPIENT.vendor), 'and never named when it is not — a company that is not going to get it must not be in the question');
for (const r of both) {
    ok(/^https:\/\//.test(r.endpoint), `${r.vendor}'s endpoint is recorded in full, not as a name`);
    ok(r.role.trim().length > 0, `${r.vendor} is described, because "a service" is not an answer`);
}
eq((0, scanSheetConsent_1.recipientNames)(both), 'Anthropic and OCR.space', 'two companies read as a list a person can say out loud');
eq((0, scanSheetConsent_1.recipientNames)(ocrOnly), 'OCR.space', 'and one reads as one');
eq((0, scanSheetConsent_1.recipientNames)([]), '', 'nobody is the empty string, never the word "nobody"');
/* ── the sentences name the companies, and name what actually goes ─────── */
for (const rs of [both, ocrOnly]) {
    const who = (0, scanSheetConsent_1.scanConsentWho)(rs);
    for (const r of rs)
        ok(who.includes(r.vendor), `the question names ${r.vendor}`);
    ok(/not part of your gym/i.test(who), 'and says they are not the gym, which is who the member thinks they are dealing with');
    ok((0, scanSheetConsent_1.scanConsentRetention)(rs).includes((0, scanSheetConsent_1.recipientNames)(rs)), 'the retention line names them too');
    ok(/do not ask them to delete/i.test((0, scanSheetConsent_1.scanConsentRetention)(rs)), 'and is not softened into a promise nobody here has checked');
    ok((0, scanSheetConsent_1.scanScreenPromise)(rs).includes((0, scanSheetConsent_1.recipientNames)(rs)), 'the standing sentence names them');
    ok((0, scanSheetConsent_1.scanConsentSendA11y)(rs).includes((0, scanSheetConsent_1.recipientNames)(rs)), 'and so does the spoken label on the send button');
}
// The thing people get wrong about OCR: they picture the app sending "82.4 kg".
ok(/whole sheet/i.test(scanSheetConsent_1.SCAN_CONSENT_WHAT), 'what goes is the whole sheet, said in those words');
for (const printed of ['name', 'height', 'clinic']) {
    ok(scanSheetConsent_1.SCAN_CONSENT_WHAT.toLowerCase().includes(printed), `and the sentence says the ${printed} on the page goes with it`);
}
/* ── a refusal leaves the feature working, and says so before the choice ── */
ok(/type/i.test(scanSheetConsent_1.SCAN_CONSENT_IF_YOU_DECLINE), 'declining leads somewhere, and the route is stated in the question');
ok(/nothing is sent/i.test(scanSheetConsent_1.SCAN_CONSENT_IF_YOU_DECLINE), 'and says plainly that nothing goes');
ok(/counts exactly the same/i.test(scanSheetConsent_1.SCAN_CONSENT_IF_YOU_DECLINE), 'a scan typed in is not a lesser scan, and the member is told that before answering');
ok(!/sorry|unfortunately|error|failed|problem/i.test(scanSheetConsent_1.SCAN_REFUSED_NOTE), 'the refusal outcome is not worded as a failure — it is the feature doing what was asked');
ok(/counts exactly the same/i.test(scanSheetConsent_1.SCAN_REFUSED_NOTE), 'and it says so again afterwards');
/* ── the ordering: agreed, unrecorded, therefore not sent ───────────────── */
ok(/has been sent/i.test(scanSheetConsent_1.SCAN_RECORD_FAILED_NOTE) || /Nothing has been sent/i.test(scanSheetConsent_1.SCAN_RECORD_FAILED_NOTE), 'when the agreement will not write, the member is told nothing was sent');
ok(/we could not|we will not/i.test(scanSheetConsent_1.SCAN_RECORD_FAILED_NOTE), 'and that this is the app declining, not them');
ok(!/you (said|chose|declined)/i.test(scanSheetConsent_1.SCAN_RECORD_FAILED_NOTE), 'it must never read as a refusal the member made — they agreed');
/* ── four states, and the two that must never merge ─────────────────────── */
eq((0, scanSheetConsent_1.sheetSendState)('ready', 'granted'), 'granted', 'a row that says granted is granted');
eq((0, scanSheetConsent_1.sheetSendState)('ready', 'refused'), 'refused', 'a row that says refused is refused');
eq((0, scanSheetConsent_1.sheetSendState)('ready', null), 'no-record', 'a completed read with no row is no record — not "never sent"');
eq((0, scanSheetConsent_1.sheetSendState)('error', null), 'unknown', 'a failed read knows nothing about any reading');
eq((0, scanSheetConsent_1.sheetSendState)('loading', null), 'unknown', 'and neither does one still in flight');
eq((0, scanSheetConsent_1.sheetSendState)('partial', null), 'unknown', 'a truncated page cannot prove a row does not exist');
// A row that came back is an answer whatever the status: a row that exists,
// exists. Same rule as docSendState.
eq((0, scanSheetConsent_1.sheetSendState)('error', 'granted'), 'granted', 'but a row we DID see is an answer whatever the status');
eq((0, scanSheetConsent_1.sheetSendState)('partial', 'refused'), 'refused', 'both ways');
const lines = new Set(['granted', 'refused', 'no-record', 'unknown']
    .map((s) => (0, scanSheetConsent_1.sheetSendLine)(s, ['Anthropic', 'OCR.space'])));
eq(lines.size, 4, 'four states, four different sentences');
ok(/no record either way/i.test((0, scanSheetConsent_1.sheetSendLine)('no-record')), 'no row says "no record either way" and never "never sent" — every sheet read before this existed was sent unasked');
ok(!/never sent|not sent/i.test((0, scanSheetConsent_1.sheetSendLine)('no-record')), 'and it does not claim in either direction');
ok(/no part of it was sent/i.test((0, scanSheetConsent_1.sheetSendLine)('refused', ['OCR.space'])), 'a recorded refusal is the one state that may say nothing went');
/* ── this consent is not any other consent ──────────────────────────────── */
// The meal-photo answer lives in AsyncStorage and is remembered; this one is a
// row per sheet. Nothing may read one as the other, and the sharpest way to
// assert that is that this module holds no storage key at all.
const asStrings = JSON.stringify({
    who: (0, scanSheetConsent_1.scanConsentWho)(both), what: scanSheetConsent_1.SCAN_CONSENT_WHAT,
    decline: scanSheetConsent_1.SCAN_CONSENT_IF_YOU_DECLINE, refused: scanSheetConsent_1.SCAN_REFUSED_NOTE,
});
for (const key of Object.values(photoAI_1.PHOTO_AI_KEYS)) {
    ok(!asStrings.includes(key), `the sheet consent never mentions the ${key} answer — a remembered yes about a photograph is not a decision about this page`);
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('scanSheetConsent: ok');
