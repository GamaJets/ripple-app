"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A photograph of somebody's dinner table does not go to a language model on
// the strength of a camera permission — and a yes given about a gym machine is
// not that answer. Compile with tsc, run with node.
//
// The machine subject's own rules are asserted in photoAI.test.ts. This file is
// about the SECOND subject and about the boundary between them.
const photoAI_1 = require("./photoAI");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const SUBJECTS = ['machine', 'meal'];
/* ── two subjects, two keys, and never one ──────────────────────────────── */
const keys = SUBJECTS.map(photoAI_1.photoAIKey);
eq(new Set(keys).size, SUBJECTS.length, 'every subject has its OWN key — sharing one would take a yes about a leg press as a yes about somebody’s kitchen table');
eq((0, photoAI_1.photoAIKey)('machine'), photoAI_1.PHOTO_AI_KEY, 'the machine keeps the key its existing answers are already stored under');
eq(photoAI_1.PHOTO_AI_KEYS.machine, 'repple.photoAI', 'and that key is unchanged, so nobody is asked again for nothing');
ok(photoAI_1.PHOTO_AI_KEYS.meal !== photoAI_1.PHOTO_AI_KEYS.machine, 'the meal answer is a different answer');
for (const k of keys)
    ok(k.startsWith('repple.'), `${k} is namespaced like every other stored key`);
/* ── the gate is the same gate, whichever subject ───────────────────────── */
// mayAnalyzePhoto takes no subject deliberately: the RULE is identical, only
// the stored answer differs. Re-asserted here so a later "meals are different"
// shortcut has something to fail against.
for (const c of ['yes', 'no', 'unasked', 'unknown']) {
    ok(!(0, photoAI_1.mayAnalyzePhoto)(c, false).allowed, `no reader means no send, whatever ${c} says`);
}
ok((0, photoAI_1.mayAnalyzePhoto)('yes', true).allowed, 'a recorded yes on a build with a reader sends');
eq((0, photoAI_1.mayAnalyzePhoto)('unasked', true).block, 'unasked', 'never having been asked is not consent');
eq((0, photoAI_1.mayAnalyzePhoto)('unknown', true).block, 'unknown', 'a read still in flight is not consent');
eq((0, photoAI_1.mayAnalyzePhoto)('no', true).block, 'refused', 'and no is no');
/* ── every subject has every sentence it needs ──────────────────────────── */
for (const s of SUBJECTS) {
    ok(photoAI_1.PHOTO_SENT_BY_SUBJECT[s].length > 0, `${s}: what is sent is listed`);
    ok(photoAI_1.PHOTO_NOT_SENT_BY_SUBJECT[s].length > 0, `${s}: and so is what is not`);
    for (const line of [...photoAI_1.PHOTO_SENT_BY_SUBJECT[s], ...photoAI_1.PHOTO_NOT_SENT_BY_SUBJECT[s]]) {
        ok(line.trim().length > 0 && line === line.trimEnd(), `${s}: "${line}" is a sentence, not a gap`);
        ok(line[0] === line[0].toLowerCase(), `${s}: "${line}" is prose in a bulleted list, not a label`);
    }
    for (const [name, v] of Object.entries({
        destination: photoAI_1.PHOTO_DESTINATION_BY_SUBJECT[s], kicker: photoAI_1.PHOTO_ASK_KICKER[s],
        title: photoAI_1.PHOTO_ASK_TITLE[s], decline: photoAI_1.PHOTO_IF_YOU_DECLINE[s],
        send: photoAI_1.PHOTO_SEND_LABEL[s], no: photoAI_1.PHOTO_DECLINE_LABEL[s],
        sendA11y: photoAI_1.PHOTO_SEND_A11Y[s], noA11y: photoAI_1.PHOTO_DECLINE_A11Y[s],
        refusedTitle: photoAI_1.PHOTO_REFUSED_TITLE[s], refused: photoAI_1.PHOTO_REFUSED_NOTE[s],
        unread: photoAI_1.PHOTO_UNREAD_NOTE[s], off: photoAI_1.PHOTO_OFF_NOTE[s],
    })) {
        ok(typeof v === 'string' && v.trim().length > 0, `${s}: the ${name} sentence exists — a missing one renders an empty paragraph over a Send button`);
    }
    // Both spoken labels have to work read alone, with no paragraph above them.
    ok(/Anthropic/.test(photoAI_1.PHOTO_SEND_A11Y[s]), `${s}: the spoken send label names the company`);
    ok(/Anthropic/.test(photoAI_1.PHOTO_DECLINE_A11Y[s]), `${s}: and so does the spoken refusal`);
}
/* ── the meal sentences describe a table, not a gym floor ───────────────── */
ok(photoAI_1.MEAL_PHOTO_SENT.some((l) => /table/i.test(l)), 'a meal is photographed at a table and the people round it go with the food');
ok(photoAI_1.MEAL_PHOTO_SENT.some((l) => /whole frame|in full/i.test(l)), 'what goes is the whole frame, not a crop of the plate');
ok(photoAI_1.MEAL_PHOTO_NOT_SENT.some((l) => /food log/i.test(l)), 'and the reader gets one picture — not the diary, which is what people assume');
ok(/Anthropic/.test(photoAI_1.PHOTO_DESTINATION_BY_SUBJECT.meal), 'the destination is a company with a name');
ok(/gym|coach/i.test(photoAI_1.PHOTO_DESTINATION_BY_SUBJECT.meal), 'and the two recipients people worry about are addressed head on');
/* ── a refusal leaves the feature working ───────────────────────────────── */
ok(/type/i.test(photoAI_1.PHOTO_IF_YOU_DECLINE.meal), 'declining a meal photo still logs the meal, and the route is stated before the choice');
ok(/nothing is sent/i.test(photoAI_1.PHOTO_IF_YOU_DECLINE.meal), 'and says plainly that nothing goes');
ok(/exactly the same/i.test(photoAI_1.PHOTO_IF_YOU_DECLINE.meal), 'a typed meal is not a lesser meal, and the member is told so before answering');
ok(!/sorry|unfortunately|error|failed|problem|could not/i.test(photoAI_1.PHOTO_REFUSED_NOTE.meal), 'the refusal outcome is not worded as a failure — it is the feature doing what was asked');
/* ── refused, unread and off are three different facts ──────────────────── */
for (const s of SUBJECTS) {
    const three = new Set([photoAI_1.PHOTO_REFUSED_NOTE[s], photoAI_1.PHOTO_UNREAD_NOTE[s], photoAI_1.PHOTO_OFF_NOTE[s]]);
    eq(three.size, 3, `${s}: "you said no", "the reader gave nothing back" and "this build has no reader" are three sentences — the member's next move differs for each`);
}
ok(/could not be read|nothing could be read/i.test(photoAI_1.PHOTO_UNREAD_NOTE.meal), 'the reader failing says the reader failed');
ok(/cannot read|no reader|turns on/i.test(photoAI_1.PHOTO_OFF_NOTE.meal), 'the reader being absent says the reader is absent, and does not blame the photo');
ok(/has not left this phone|went nowhere|not left/i.test(photoAI_1.PHOTO_REFUSED_NOTE.meal), 'and the refusal says the photo went nowhere, which is the fact the member chose');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('mealPhotoConsent: ok');
