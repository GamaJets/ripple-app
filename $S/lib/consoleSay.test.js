"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for consoleSay — the fact that travels with the sentence.
//
// The bug this prevents is not a crash. It is a screen reader announcing "That
// grant was refused, so nothing changed" in the polite queue, behind a table
// that has just re-rendered, to a member of staff who has already turned back
// to the person at the desk. Every assertion below is about the one bit that
// decides that: `bad`.
//
// The interesting cases are the empty ones. `refused(e?.message)` is the shape
// at nearly every call site, and `e?.message` is routinely undefined or the
// empty string — a Supabase error with no message, an exception that was a
// string. If that produced `{ text: '', bad: true }` the live region would be
// handed an empty assertive announcement, which is either silence dressed up as
// a report or, on some readers, a bare interruption saying nothing at all. It
// has to come back null so the region stays quiet and the form's own banner is
// the only thing that renders.
//
// Compile with tsc then run with node, like readAll.test.ts.
const consoleSay_1 = require("./consoleSay");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the two constructors ─────────────────────────────────────────────────── */
const saved = (0, consoleSay_1.wrote)('Saved.');
eq((0, consoleSay_1.sayText)(saved), 'Saved.', 'wrote keeps the words');
eq((0, consoleSay_1.sayTone)(saved), undefined, 'a write that happened waits its turn');
eq(saved?.bad, false, 'wrote is not a failure');
const stopped = (0, consoleSay_1.refused)('That grant was refused, so nothing changed.');
eq((0, consoleSay_1.sayText)(stopped), 'That grant was refused, so nothing changed.', 'refused keeps the words');
eq((0, consoleSay_1.sayTone)(stopped), 'crit', 'a write that did not happen interrupts');
eq(stopped?.bad, true, 'refused is a failure');
/* ── the fallback, because e?.message is not a string ─────────────────────── */
eq((0, consoleSay_1.sayText)((0, consoleSay_1.refused)(undefined, 'That was not saved, so the record is unchanged.')), 'That was not saved, so the record is unchanged.', 'an error with no message falls back to the sentence the screen wrote');
eq((0, consoleSay_1.sayText)((0, consoleSay_1.refused)(null, 'Nothing was posted.')), 'Nothing was posted.', 'a null message falls back too');
eq((0, consoleSay_1.sayText)((0, consoleSay_1.refused)('', 'Nothing was posted.')), 'Nothing was posted.', 'an empty message is not a message');
eq((0, consoleSay_1.sayText)((0, consoleSay_1.refused)('   ', 'Nothing was posted.')), 'Nothing was posted.', 'whitespace is not a message either');
eq((0, consoleSay_1.sayText)((0, consoleSay_1.refused)('permission denied', 'Nothing was posted.')), 'permission denied', 'a real message is preferred to the fallback');
eq((0, consoleSay_1.refused)('  padded  ')?.text, 'padded', 'the words are trimmed before they are announced');
/* ── nothing to say is not something to say ───────────────────────────────── */
eq((0, consoleSay_1.refused)(undefined), null, 'no message and no fallback is silence, not an empty alert');
eq((0, consoleSay_1.refused)(''), null, 'an empty message with no fallback is silence');
eq((0, consoleSay_1.refused)(undefined, ''), null, 'an empty fallback does not rescue an empty message');
eq((0, consoleSay_1.sayText)(null), null, 'a form that has said nothing has no text');
eq((0, consoleSay_1.sayTone)(null), undefined, 'a form that has said nothing does not interrupt');
/* ── the tone never comes from the words ──────────────────────────────────── */
//
// A sentence saying a write succeeded, worded as a refusal, still waits its
// turn; a sentence reading like a success, constructed as a refusal, still
// interrupts. The words are the caller's business and the bit is not derived
// from them.
eq((0, consoleSay_1.sayTone)((0, consoleSay_1.wrote)('That grant was refused, so nothing changed.')), undefined, 'tone is not sniffed out of the text');
eq((0, consoleSay_1.sayTone)((0, consoleSay_1.refused)('Saved.')), 'crit', 'tone is not sniffed out of the text the other way either');
/* ── the shape a render site relies on ────────────────────────────────────── */
//
// `{msg ? <p>{msg.text}</p> : null}` is the render at every call site, so a
// non-null Said must always carry printable words.
const all = [
    (0, consoleSay_1.wrote)('a'), (0, consoleSay_1.refused)('b'), (0, consoleSay_1.refused)(undefined, 'c'), (0, consoleSay_1.refused)('', 'd'),
    (0, consoleSay_1.refused)(undefined), (0, consoleSay_1.refused)(''), null,
];
for (const s of all) {
    ok(s === null || s.text.length > 0, 'a non-null Said always has words to render');
    ok(s === null || typeof s.bad === 'boolean', 'a non-null Said always knows which it is');
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('consoleSay.test.ts: ok');
