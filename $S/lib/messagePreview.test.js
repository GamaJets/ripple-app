"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A message with no words in it is still a message, and the notifier has to
// say so. Compile with tsc, run with node.
//
// The assertion this file exists for is the last one: there is no input on
// which `messagePreview` returns an empty string, because an empty string is
// what supabase/functions/notify-message read as "there is nothing here to
// tell anybody about" — and an attachment-only message (body '', per
// supabase/parts/124) is exactly that shape.
const messagePreview_1 = require("./messagePreview");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the sender's own words win ──────────────────────────────────────────── */
eq((0, messagePreview_1.messagePreview)('See you Tuesday.', null), 'See you Tuesday.', 'a plain message is its own preview');
eq((0, messagePreview_1.messagePreview)('Is this the right grip?', 'image'), 'Is this the right grip?', 'a caption on a photograph beats a description of the envelope');
eq((0, messagePreview_1.messagePreview)('  trimmed  ', null), 'trimmed', 'the words are trimmed, so whitespace is not a body');
/* ── the message that lost photographs ───────────────────────────────────── */
eq((0, messagePreview_1.messagePreview)('', 'image'), messagePreview_1.PREVIEW_FOR_KIND.image, 'a photo with no caption still says what it is');
eq((0, messagePreview_1.messagePreview)('', 'video'), messagePreview_1.PREVIEW_FOR_KIND.video, 'and so does a clip');
eq((0, messagePreview_1.messagePreview)('   ', 'video'), messagePreview_1.PREVIEW_FOR_KIND.video, 'whitespace is not a caption');
eq(messagePreview_1.PREVIEW_FOR_KIND.image, 'Sent you a photo', 'the photo wording, stated here because notify-message repeats it');
eq(messagePreview_1.PREVIEW_FOR_KIND.video, 'Sent you a video', 'the video wording, likewise');
/* ── what we say when we do not know ─────────────────────────────────────── */
//
// Reached by a row written before the trigger carried `attachment_kind`, and by
// a kind this build does not recognise. Both claim a message exists and nothing
// about its contents — which is the most that can honestly be said.
eq((0, messagePreview_1.messagePreview)('', null), messagePreview_1.PREVIEW_UNKNOWN, 'no words and no kind still names a message');
eq((0, messagePreview_1.messagePreview)(null, undefined), messagePreview_1.PREVIEW_UNKNOWN, 'and so do two absent values');
eq((0, messagePreview_1.messagePreview)('', 'document'), messagePreview_1.PREVIEW_UNKNOWN, 'an unrecognised kind is not described as one we know');
eq((0, messagePreview_1.messagePreview)('', 'IMAGE'), messagePreview_1.PREVIEW_UNKNOWN, 'and the match is exact, not case-folded');
/* ── the contract ────────────────────────────────────────────────────────── */
//
// The whole of the fix. No caller ever gets '' back, so no caller can decide
// again that an empty body means there is nothing to notify anybody about.
for (const body of ['', '   ', null, undefined]) {
    for (const kind of ['image', 'video', null, undefined, '', 'other']) {
        const out = (0, messagePreview_1.messagePreview)(body, kind);
        ok(typeof out === 'string' && out.trim().length > 0, `messagePreview(${JSON.stringify(body)}, ${JSON.stringify(kind)}) must never be empty — got ${JSON.stringify(out)}`);
    }
}
/* ── what the notifier is allowed to skip ────────────────────────────────── */
ok((0, messagePreview_1.worthNotifying)('a-thread-key'), 'a thread key is all it takes: the trigger fired, so the row exists');
ok(!(0, messagePreview_1.worthNotifying)(''), 'without one there is nobody to address');
ok(!(0, messagePreview_1.worthNotifying)('   '), 'and whitespace is not a key');
ok(!(0, messagePreview_1.worthNotifying)(null), 'nor is nothing');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('messagePreview.test.ts — all assertions passed: an empty body is never an empty notification');
