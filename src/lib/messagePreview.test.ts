// A message with no words in it is still a message, and the notifier has to
// say so. Compile with tsc, run with node.
//
// The assertion this file exists for is the last one: there is no input on
// which `messagePreview` returns an empty string, because an empty string is
// what supabase/functions/notify-message read as "there is nothing here to
// tell anybody about" — and an attachment-only message (body '', per
// supabase/parts/124) is exactly that shape.
import { messagePreview, worthNotifying, PREVIEW_FOR_KIND, PREVIEW_UNKNOWN } from './messagePreview';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the sender's own words win ──────────────────────────────────────────── */

eq(messagePreview('See you Tuesday.', null), 'See you Tuesday.', 'a plain message is its own preview');
eq(messagePreview('Is this the right grip?', 'image'), 'Is this the right grip?',
  'a caption on a photograph beats a description of the envelope');
eq(messagePreview('  trimmed  ', null), 'trimmed', 'the words are trimmed, so whitespace is not a body');

/* ── the message that lost photographs ───────────────────────────────────── */

eq(messagePreview('', 'image'), PREVIEW_FOR_KIND.image, 'a photo with no caption still says what it is');
eq(messagePreview('', 'video'), PREVIEW_FOR_KIND.video, 'and so does a clip');
eq(messagePreview('   ', 'video'), PREVIEW_FOR_KIND.video, 'whitespace is not a caption');
eq(PREVIEW_FOR_KIND.image, 'Sent you a photo', 'the photo wording, stated here because notify-message repeats it');
eq(PREVIEW_FOR_KIND.video, 'Sent you a video', 'the video wording, likewise');

/* ── what we say when we do not know ─────────────────────────────────────── */
//
// Reached by a row written before the trigger carried `attachment_kind`, and by
// a kind this build does not recognise. Both claim a message exists and nothing
// about its contents — which is the most that can honestly be said.

eq(messagePreview('', null), PREVIEW_UNKNOWN, 'no words and no kind still names a message');
eq(messagePreview(null, undefined), PREVIEW_UNKNOWN, 'and so do two absent values');
eq(messagePreview('', 'document'), PREVIEW_UNKNOWN, 'an unrecognised kind is not described as one we know');
eq(messagePreview('', 'IMAGE'), PREVIEW_UNKNOWN, 'and the match is exact, not case-folded');

/* ── the contract ────────────────────────────────────────────────────────── */
//
// The whole of the fix. No caller ever gets '' back, so no caller can decide
// again that an empty body means there is nothing to notify anybody about.

for (const body of ['', '   ', null, undefined] as const) {
  for (const kind of ['image', 'video', null, undefined, '', 'other'] as const) {
    const out = messagePreview(body, kind);
    ok(typeof out === 'string' && out.trim().length > 0,
      `messagePreview(${JSON.stringify(body)}, ${JSON.stringify(kind)}) must never be empty — got ${JSON.stringify(out)}`);
  }
}

/* ── what the notifier is allowed to skip ────────────────────────────────── */

ok(worthNotifying('a-thread-key'), 'a thread key is all it takes: the trigger fired, so the row exists');
ok(!worthNotifying(''), 'without one there is nobody to address');
ok(!worthNotifying('   '), 'and whitespace is not a key');
ok(!worthNotifying(null), 'nor is nothing');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('messagePreview.test.ts — all assertions passed: an empty body is never an empty notification');
