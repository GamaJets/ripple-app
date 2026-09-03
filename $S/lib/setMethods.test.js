"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const setMethods_1 = require("./setMethods");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
// ── The catalogue itself ──────────────────────────────────────────────────
ok(setMethods_1.SET_METHODS.length >= 12, 'the catalogue covers more than the four the other app offers');
eq(setMethods_1.SET_METHODS.filter((m) => m.id === setMethods_1.DEFAULT_METHOD).length, 1, 'exactly one default');
eq(setMethods_1.SET_METHODS[0].id, setMethods_1.DEFAULT_METHOD, 'the default is offered first');
// Ids are what get STORED in programmes on people's phones, so a duplicate or
// a renamed one is a data bug, not a cosmetic one.
eq(new Set(setMethods_1.SET_METHODS.map((m) => m.id)).size, setMethods_1.SET_METHODS.length, 'ids are unique');
eq(new Set(setMethods_1.SET_METHODS.map((m) => m.label)).size, setMethods_1.SET_METHODS.length, 'labels are unique');
ok(setMethods_1.SET_METHODS.every((m) => m.short.length > 0 && m.short.length <= 2), 'every badge is one or two characters');
ok(setMethods_1.SET_METHODS.every((m) => m.blurb.trim().length > 0), 'every method says what it means');
// Sentence case, matching what check:caps enforces on screen labels.
ok(setMethods_1.SET_METHODS.every((m) => m.label === m.label[0].toUpperCase() + m.label.slice(1)), 'labels are sentence case');
ok(setMethods_1.SET_METHODS.every((m) => m.label.slice(1) !== m.label.slice(1).toUpperCase()), 'no label shouts');
// ── Volume: the field that stops a lie on the progress chart ──────────────
ok(!(0, setMethods_1.countsToVolume)('warmup'), 'a warm-up is not training volume');
ok(!(0, setMethods_1.countsToVolume)('cooldown'), 'a cool-down is not training volume');
ok((0, setMethods_1.countsToVolume)('drop'), 'a drop set is');
ok((0, setMethods_1.countsToVolume)('failure'), 'a set to failure is');
ok((0, setMethods_1.countsToVolume)(null), 'an unset method counts, because it means an ordinary set');
// ── Rest ──────────────────────────────────────────────────────────────────
eq((0, setMethods_1.restAfter)('normal', 90), 90, 'an ordinary set rests for the exercise rest');
eq((0, setMethods_1.restAfter)('drop', 90), 0, 'a drop set does not rest — that is what makes it one');
eq((0, setMethods_1.restAfter)('restpause', 90), 15, 'rest-pause overrides with its own fifteen seconds');
eq((0, setMethods_1.restAfter)('cluster', 300), 15, 'and the override ignores a long exercise rest');
eq((0, setMethods_1.restAfter)('normal', 0), 0, 'no rest configured means no rest');
eq((0, setMethods_1.restAfter)('normal', -5), 0, 'a negative rest is floored, never handed to a countdown');
eq((0, setMethods_1.restAfter)('normal', 90.6), 91, 'a fractional rest is rounded, not truncated into a stray millisecond');
// ── An unknown id is a NEWER programme, not a broken one ──────────────────
eq((0, setMethods_1.methodFor)('myotatic-crunch-2029').method.id, setMethods_1.DEFAULT_METHOD, 'an unknown method falls back to normal');
ok(!(0, setMethods_1.methodFor)('myotatic-crunch-2029').known, 'and says it was not recognised');
ok((0, setMethods_1.methodFor)('drop').known, 'a known one says so');
ok(!(0, setMethods_1.methodFor)(undefined).known, 'undefined is not a known method');
eq((0, setMethods_1.restAfter)('myotatic-crunch-2029', 90), 90, 'an unknown method still rests, rather than silently not');
// ── Badges mark the exception, not every row ──────────────────────────────
eq((0, setMethods_1.badgeFor)('normal'), null, 'an ordinary set carries no badge');
eq((0, setMethods_1.badgeFor)(null), null, 'nor does an unset one');
eq((0, setMethods_1.badgeFor)('myotatic-crunch-2029'), null, 'nor does an unrecognised one — never a badge nobody can read');
eq((0, setMethods_1.badgeFor)('warmup'), { short: 'W', label: 'Warm-up' }, 'a warm-up is marked');
eq((0, setMethods_1.badgeFor)('drop'), { short: 'D', label: 'Drop set' }, 'so is a drop set');
/* ── The sentence under the Set type control ───────────────────────────────
 *
 * The control read `Normal` and nothing else, so nobody tapped it. These
 * assert the hint is DERIVED: it must never name the method a coach is already
 * on, and the count at the end has to add up to the catalogue, or the sentence
 * is telling a coach there is more behind the control than there is. */
ok((0, setMethods_1.otherMethodsHint)('normal').startsWith('Tap to change'), 'the hint says what tapping does');
ok(!/\bnormal\b/i.test((0, setMethods_1.otherMethodsHint)('normal')), 'and never offers the method already selected');
ok(/\bnormal\b/i.test((0, setMethods_1.otherMethodsHint)('drop')), 'but does offer it once the coach is on another');
eq((0, setMethods_1.otherMethodsHint)('normal', setMethods_1.SET_METHODS.length).includes(' more'), false, 'showing every other method leaves nothing to count');
{
    // The counted tail must equal the catalogue: named + counted + the current one.
    const hint = (0, setMethods_1.otherMethodsHint)('normal', 3);
    const m = /and (\d+) more/.exec(hint);
    ok(!!m, 'the short form counts the rest rather than listing twelve');
    eq(3 + Number(m ? m[1] : 0) + 1, setMethods_1.SET_METHODS.length, 'and that count is the catalogue, not a number somebody typed');
}
eq((0, setMethods_1.otherMethodsHint)('normal', 0), (0, setMethods_1.otherMethodsHint)('normal', 1), 'asking for none still names one, so the sentence is never empty');
if (errors.length) {
    errors.forEach((e) => console.error('FAIL', e));
    process.exit(1);
}
console.log(`setMethods ok — ${setMethods_1.SET_METHODS.length} methods, and warm-ups stay out of the volume chart`);
