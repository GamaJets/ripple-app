"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// One record, one sentence, wherever it is printed. Compile with tsc, run with node.
//
// The bug this guards: app/(client)/records.tsx wrote the "best set" phrase out
// by hand in three places — the hero, the list row and the spoken label — and
// two of the three checked `PR.bodyweight` before deciding what to say. The
// third did not, so an 84 kg member's weighted pull-up was announced in the
// hero as "best set 104 kg × 12" and described in the row eleven lines below as
// "12 reps at bodyweight +20 kg". The hero is the figure people quote.
const bestSet_1 = require("./bestSet");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── a bar lift ────────────────────────────────────────────────────────── */
eq((0, bestSet_1.bestSetLabel)({ reps: 5 }, '140 kg', null), '140 kg × 5', 'a barbell set reads as load by reps');
eq((0, bestSet_1.bestSetLabel)({ reps: 5 }, '140 kg', null, 'spoken'), '140 kg by 5 reps', 'and is spoken as a sentence, because "times" is not what a screen reader makes of ×');
// The unit travels inside the label. This module never sees kilograms or
// pounds and must never grow an opinion about them — src/lib/units.ts owns the
// round trip, and a second opinion here is how one lift ends up printed two
// ways on two screens.
eq((0, bestSet_1.bestSetLabel)({ reps: 3 }, '315 lb', null), '315 lb × 3', 'a pounds reader gets their own unit through untouched');
/* ── the record this file exists for ───────────────────────────────────── */
// The whole defect in two assertions. `PR.weight` for this set is 104 — the
// member's 84 kg body plus the 20 kg hanging off them — and it is a real load
// that a 1RM may honestly be estimated from. It is not a thing that was on a
// bar, and the flag saying so must not be skippable.
const weightedPullUp = { reps: 12, bodyweight: true, addedKg: 20 };
eq((0, bestSet_1.bestSetLabel)(weightedPullUp, '104 kg', '20 kg'), '12 reps at bodyweight +20 kg', 'a weighted bodyweight set is never described as a bar load');
eq((0, bestSet_1.bestSetLabel)(weightedPullUp, '104 kg', '20 kg', 'spoken'), '12 reps at bodyweight +20 kg', 'and it is the same sentence spoken, so the hero, the row and VoiceOver agree');
// The load is IGNORED rather than merely deprioritised. Passing it must not be
// able to bring it back — the call site that caused this passed exactly that.
ok(!(0, bestSet_1.bestSetLabel)(weightedPullUp, '104 kg', '20 kg').includes('104'), 'the weigh-in-derived figure does not appear anywhere in a bodyweight sentence');
// An unweighted bodyweight set.
eq((0, bestSet_1.bestSetLabel)({ reps: 20, bodyweight: true, addedKg: 0 }, '84 kg', null), '20 reps at bodyweight', 'a plain bodyweight set names no load at all');
eq((0, bestSet_1.bestSetLabel)({ reps: 20, bodyweight: true }, '84 kg', null), '20 reps at bodyweight', 'an absent addedKg is the same as none');
// A negative added load is not a thing. It has arrived from a log that has been
// through a queue and a JSON round trip, and "+-5 kg" is worse than silence.
eq((0, bestSet_1.bestSetLabel)({ reps: 8, bodyweight: true, addedKg: -5 }, null, '-5 kg'), '8 reps at bodyweight', 'a negative added load is dropped rather than printed with a sign in front of it');
// Added kilograms with no label to print them: the set is still a bodyweight
// set and must still say so.
eq((0, bestSet_1.bestSetLabel)({ reps: 8, bodyweight: true, addedKg: 20 }, null, null), '8 reps at bodyweight', 'an unreadable added figure does not turn a bodyweight set back into a bar lift');
/* ── a load that could not be read ─────────────────────────────────────── */
eq((0, bestSet_1.bestSetLabel)({ reps: 8 }, null, null), `${bestSet_1.UNKNOWN_LOAD} × 8`, 'an unreadable load is a dash on screen, never a zero');
eq((0, bestSet_1.bestSetLabel)({ reps: 8 }, null, null, 'spoken'), '8 reps', 'and is dropped from the spoken sentence, because a dash read aloud is a word that has gone missing');
ok(!(0, bestSet_1.bestSetLabel)({ reps: 8 }, null, null, 'spoken').includes(bestSet_1.UNKNOWN_LOAD), 'no dash is ever spoken');
/* ── nonsense in, an admission out ─────────────────────────────────────── */
eq((0, bestSet_1.bestSetLabel)({ reps: Number.NaN }, '100 kg', null), bestSet_1.UNKNOWN_LOAD, 'a rep count that is not a number is not printed as one');
eq((0, bestSet_1.bestSetLabel)({ reps: Number.NaN, bodyweight: true }, null, null, 'spoken'), 'an unrecorded set', 'and is spoken as what it is rather than as "NaN reps at bodyweight"');
/* ── the three call sites can no longer disagree ───────────────────────── */
// The actual assertion the screen needs: whatever the record, the hero's phrase
// and the row's phrase are one string. They were two.
for (const pr of [
    { reps: 5 },
    { reps: 12, bodyweight: true, addedKg: 20 },
    { reps: 20, bodyweight: true, addedKg: 0 },
    { reps: 1 },
]) {
    const hero = (0, bestSet_1.bestSetLabel)(pr, '104 kg', '20 kg');
    const row = (0, bestSet_1.bestSetLabel)(pr, '104 kg', '20 kg');
    eq(hero, row, `the hero and the row say the same thing about ${JSON.stringify(pr)}`);
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('bestSet: ok — one record, one sentence');
