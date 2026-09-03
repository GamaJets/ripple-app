"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The compare that guards the three edge functions with no signed-in caller.
//
// The case that matters most is the last one: an unset secret must not admit a
// caller who offers nothing. `'' === ''` is true, and that is the shape a bare
// comparison would have shipped.
const sharedSecret_1 = require("./sharedSecret");
process.exitCode = 1;
const errors = [];
const ok = (cond, what) => { if (!cond)
    errors.push(what); };
const eq = (a, b, what) => {
    if (a !== b)
        errors.push(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
/* ── configured ─────────────────────────────────────────────────────────── */
eq((0, sharedSecret_1.secretConfigured)('s3cret'), true, 'a set secret is configured');
eq((0, sharedSecret_1.secretConfigured)(''), false, 'an empty string is not a configured secret');
eq((0, sharedSecret_1.secretConfigured)(undefined), false, 'an unset env var is not a configured secret');
eq((0, sharedSecret_1.secretConfigured)(null), false, 'a null secret is not configured');
/* ── the match ──────────────────────────────────────────────────────────── */
eq((0, sharedSecret_1.secretMatches)('s3cret', 's3cret'), true, 'the right secret matches');
eq((0, sharedSecret_1.secretMatches)('s3crer', 's3cret'), false, 'one byte wrong does not match');
eq((0, sharedSecret_1.secretMatches)('s3cre', 's3cret'), false, 'a short secret does not match');
eq((0, sharedSecret_1.secretMatches)('s3crett', 's3cret'), false, 'a long secret does not match');
eq((0, sharedSecret_1.secretMatches)('', 's3cret'), false, 'an empty offer does not match a real secret');
// Case and whitespace are NOT normalised. A secret is bytes; trimming one would
// mean two different strings opened the same door.
eq((0, sharedSecret_1.secretMatches)('S3CRET', 's3cret'), false, 'the compare is case sensitive');
eq((0, sharedSecret_1.secretMatches)(' s3cret', 's3cret'), false, 'a leading space is a different secret');
eq((0, sharedSecret_1.secretMatches)('s3cret ', 's3cret'), false, 'a trailing space is a different secret');
/* ── fail closed ────────────────────────────────────────────────────────── */
//
// The whole reason this is a function. A deploy that lost HOOK_SECRET, or one
// where the secret was never set, must refuse everybody — including, and
// especially, a caller who offers the empty string, which is what
// `notify-message` computes from a body with no `secret` key at all.
eq((0, sharedSecret_1.secretMatches)('', ''), false, 'an empty secret does not admit an empty offer');
eq((0, sharedSecret_1.secretMatches)('', undefined), false, 'an unset secret does not admit an empty offer');
eq((0, sharedSecret_1.secretMatches)('anything', ''), false, 'an unset secret admits nobody');
eq((0, sharedSecret_1.secretMatches)('anything', undefined), false, 'an unset secret admits nobody, undefined');
eq((0, sharedSecret_1.secretMatches)('anything', null), false, 'an unset secret admits nobody, null');
/* ── a body is not a string ─────────────────────────────────────────────── */
//
// `notify-message` reads its secret out of parsed JSON, so `b.secret` can be
// anything a caller can encode. None of it is the secret.
eq((0, sharedSecret_1.secretMatches)(undefined, 's3cret'), false, 'a missing key does not match');
eq((0, sharedSecret_1.secretMatches)(null, 's3cret'), false, 'a null does not match');
eq((0, sharedSecret_1.secretMatches)(0, 's3cret'), false, 'a number does not match');
eq((0, sharedSecret_1.secretMatches)(true, 's3cret'), false, 'a boolean does not match');
eq((0, sharedSecret_1.secretMatches)(['s3cret'], 's3cret'), false, 'an array does not match, even holding the secret');
eq((0, sharedSecret_1.secretMatches)({ toString: () => 's3cret' }, 's3cret'), false, 'an object that stringifies to the secret does not match');
/* ── the compare does not stop early ────────────────────────────────────── */
//
// Not a timing measurement — a clock in a test suite is a flake. What is
// asserted is the property that makes the timing claim true: every position is
// read. A secret differing only in its LAST byte must be refused just as one
// differing in its first, which a loop returning on the first difference would
// also do — so the honest check is that both are refused and that a same-length
// wrong secret is never accepted at any position.
const REAL = 'abcdefghijklmnop';
for (let i = 0; i < REAL.length; i++) {
    const bent = REAL.slice(0, i) + (REAL[i] === 'z' ? 'y' : 'z') + REAL.slice(i + 1);
    eq((0, sharedSecret_1.secretMatches)(bent, REAL), false, `a secret wrong at position ${i} is refused`);
}
eq((0, sharedSecret_1.secretMatches)(REAL, REAL), true, 'the unbent secret still matches');
/* ── non-ASCII ──────────────────────────────────────────────────────────── */
//
// charCodeAt works on UTF-16 code units, so a secret with an emoji in it
// compares by code unit. That is fine — it is the same on both sides — but it
// is asserted rather than assumed, because a length check over code units and a
// compare over code points would disagree.
eq((0, sharedSecret_1.secretMatches)('sécret🔑', 'sécret🔑'), true, 'a non-ASCII secret matches itself');
eq((0, sharedSecret_1.secretMatches)('sécret🔒', 'sécret🔑'), false, 'a non-ASCII secret differing in one code point is refused');
ok(errors.length === 0, 'no errors');
if (errors.length) {
    console.error(`sharedSecret: ${errors.length} failure(s)`);
    for (const e of errors)
        console.error('  ' + e);
    process.exit(1);
}
console.log('sharedSecret — ok');
process.exitCode = 0;
