"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What src/lib/authNonce.ts must do. Every case below was written by breaking
// the module in a scratchpad copy first and confirming the named failure.
const authNonce_1 = require("./authNonce");
// Reach success rather than defaulting to it.
process.exitCode = 1;
const errors = [];
function ok(cond, what) { if (!cond)
    errors.push(what); }
function eq(got, want, what) {
    if (got !== want)
        errors.push(`${what} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}
/* ── it uses the platform generator when there is one ───────────────────── */
{
    let called = 0;
    const n = (0, authNonce_1.authNonce)((a) => { called++; a.forEach((_, i) => { a[i] = i + 1; }); });
    eq(called, 1, 'the platform generator is asked exactly once');
    ok(n.strong, 'and the answer is marked strong');
    eq(n.value.length, authNonce_1.NONCE_BYTES * 2, 'the value is two hex characters per byte');
    eq(n.value.slice(0, 6), '010203', 'the bytes it filled are the bytes that come out, in order');
    ok(/^[0-9a-f]+$/.test(n.value), 'lower-case hex only — it goes in a URL');
}
/* ── a generator that accepts the call and does nothing is not trusted ──── */
{
    // The realistic shape of a broken polyfill: it exists, it does not throw, and
    // it leaves the array as it found it. Trusting that would hand every install
    // on that runtime the SAME nonce, which is worse than the weak fallback
    // because it reads as strong.
    const n = (0, authNonce_1.authNonce)(() => { });
    ok(!n.strong, 'an all-zero result is not reported as strong');
    ok(!/^0+$/.test(n.value), 'and the value is not left as zeroes');
}
/* ── a generator that throws falls back rather than taking the screen down ── */
{
    const n = (0, authNonce_1.authNonce)(() => { throw new Error('no entropy source'); });
    ok(!n.strong, 'a throwing generator falls back, and says the answer is weak');
    eq(n.value.length, authNonce_1.NONCE_BYTES * 2, 'and still returns a usable nonce');
    // This is the case the caller must be able to survive: an OAuth connect that
    // refused to start on an older runtime would be a worse trade than a weaker
    // nonce, which is why the fallback exists at all rather than throwing.
}
/* ── the whole point: two nonces are not the same nonce ─────────────────── */
{
    const seen = new Set();
    for (let i = 0; i < 200; i++)
        seen.add((0, authNonce_1.authNonce)().value);
    eq(seen.size, 200, 'two hundred nonces are two hundred different values');
    // Deliberately run through the REAL path (no injection) so this also covers
    // whichever branch this runtime actually takes.
}
/* ── length is not accidentally cut by a leading zero byte ──────────────── */
{
    const n = (0, authNonce_1.authNonce)((a) => { a.fill(0); a[a.length - 1] = 1; });
    eq(n.value.length, authNonce_1.NONCE_BYTES * 2, 'a leading zero byte is padded, not dropped');
    eq(n.value.slice(0, 2), '00', 'and it survives as 00 rather than shortening the string');
    ok(n.strong, 'a single set byte is enough to show the generator ran');
}
if (errors.length) {
    for (const e of errors)
        console.error('  ✗ ' + e);
    console.error(`\nauthNonce — ${errors.length} failure${errors.length === 1 ? '' : 's'}.`);
    process.exit(1);
}
console.log('authNonce ok — platform CSPRNG where there is one, a fallback that admits it, and no two alike.');
process.exitCode = 0;
