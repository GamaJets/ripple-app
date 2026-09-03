"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A night is filed, or it is refused with a sentence. Never neither.
// Compile with tsc, run with node.
const sleepEntry_1 = require("./sleepEntry");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the range ──────────────────────────────────────────────────────────── */
ok((0, sleepEntry_1.isFilableNight)(7.5, 4), 'seven and a half hours at quality four is an ordinary night');
ok((0, sleepEntry_1.isFilableNight)(0.5, 1), 'so is half an hour with a bad mark on it');
ok((0, sleepEntry_1.isFilableNight)(sleepEntry_1.MAX_SLEEP_HOURS, sleepEntry_1.MAX_QUALITY), 'and the bounds themselves are inside the range');
ok(!(0, sleepEntry_1.isFilableNight)(0, 3), 'no hours is not a night');
ok(!(0, sleepEntry_1.isFilableNight)(-2, 3), 'nor is a negative one');
ok(!(0, sleepEntry_1.isFilableNight)(75, 3), 'and 75 hours is the typo this whole module exists for');
ok(!(0, sleepEntry_1.isFilableNight)(7.5, 0), 'a night with no quality mark is not filable');
ok(!(0, sleepEntry_1.isFilableNight)(7.5, 6), 'nor one marked past the scale');
ok(!(0, sleepEntry_1.isFilableNight)(7.5, 2.5), 'nor one marked half way between two marks');
ok(!(0, sleepEntry_1.isFilableNight)(Number.NaN, 3), 'and NaN is not a duration');
/* ── every refusal has a sentence, and it is not the same sentence ──────── */
eq((0, sleepEntry_1.sleepRefusal)(7.5, 4), null, 'a good night is not refused, so there is nothing to say');
for (const [h, q] of [[0, 3], [75, 3], [7.5, 0]]) {
    const why = (0, sleepEntry_1.sleepRefusal)(h, q);
    ok(typeof why === 'string' && why.length > 10, `a refused night says why: ${h}h at ${q}`);
}
const reasons = new Set([(0, sleepEntry_1.sleepRefusal)(0, 3), (0, sleepEntry_1.sleepRefusal)(75, 3), (0, sleepEntry_1.sleepRefusal)(7.5, 0)]);
eq(reasons.size, 3, 'and the three refusals are three different sentences');
// The one that matters: the member typed 75 meaning 7.5, and is told so rather
// than being shown two cleared boxes and no night.
const tooLong = (0, sleepEntry_1.sleepRefusal)(75, 3);
ok(/7\.5/.test(tooLong), `the sentence offers the reading it almost certainly was, got: ${tooLong}`);
ok(/nothing has been logged/i.test(tooLong), 'and says plainly that nothing was filed');
ok(/24/.test(tooLong), 'and names the bound');
// The quality one names the scale rather than a rule.
ok(/1 to 5/.test((0, sleepEntry_1.sleepRefusal)(7.5, 0)), 'the quality sentence names the scale');
// Nothing that is filable is ever given a refusal, and nothing that is refused
// is ever given none. The two functions cannot disagree.
for (const h of [0, 0.1, 1, 7.5, 24, 24.1, 75, -1]) {
    for (const q of [0, 1, 3, 5, 6]) {
        eq((0, sleepEntry_1.sleepRefusal)(h, q) === null, (0, sleepEntry_1.isFilableNight)(h, q), `refusal and rule agree for ${h}h at ${q}`);
    }
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('sleepEntry: ok');
