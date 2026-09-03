"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for restTimer — the rest between sets, and when the app is allowed to
// make a noise about it.
//
// Four things can be wrong here and none of them look wrong on screen:
//
//   · an absent rest read as 0. `startRest(0)` is how the runner CLEARS the
//     timer, so a per-exercise rest that falls back to 0 gives the member a
//     rest period that ends the instant it opens, silently, for every exercise
//     a coach did not fill in — which is most of them.
//   · a coach's "0" or "2" or "3000" taken literally. The builder field is
//     seconds and the number beside it in a coach's head is often minutes.
//   · a countdown tick fired twice for the same second. The interval runs at
//     500 ms against a wall clock, so it reads every second twice; a rule that
//     asks "is there 3 seconds left" ticks six times, not three.
//   · a countdown tick fired LATE, after a backgrounded phone comes back. iOS
//     suspends the interval, so the reading after 0:30 can be 0:00 — and three
//     ticks and a chime arriving together is worse than the chime alone.
//
// Compile with tsc then run with node, like pushConsent.test.ts.
const restTimer_1 = require("./restTimer");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** The seconds a read yielded, or the literal string 'refused'. Written once
 *  rather than narrowed at each call site, so a test that starts refusing where
 *  it used to succeed fails on the value instead of failing to compile. */
const secondsOf = (r) => (r.ok ? r.seconds : 'refused');
/** The sentence a refusal gives, or '' when it did not refuse. */
const reasonOf = (r) => (r.ok ? '' : r.reason);
// ── the fallback is a NUMBER, not just a name ─────────────────────────────
//
// Asserted as the literal 90 rather than only against the constant. Every other
// line here compares to DEFAULT_REST_SEC, so all of them stay green if the
// constant is changed to 0 — and a fallback of 0 means `startRest(0)`, which
// closes the timer instantly for every exercise nobody set a rest on. That is
// the whole defect this module was written to make impossible, and it would
// have slipped through a suite that only ever compared the constant to itself.
eq(restTimer_1.DEFAULT_REST_SEC, 90, 'the fallback is ninety seconds — what the runner has always passed to startRest');
eq((0, restTimer_1.restSecondsFor)({}), 90, 'and an exercise with no rest really does get ninety, not zero');
// ── the rest for an exercise ──────────────────────────────────────────────
eq((0, restTimer_1.restSecondsFor)({ restSec: 120 }), 120, "a coach's rest is used as it stands");
eq((0, restTimer_1.restSecondsFor)({ restSec: 1 }), 1, 'ANY POSITIVE NUMBER IS A REST HERE — this function is the reader, not the validator; readRestSeconds is what refuses a one-second rest at the keyboard');
eq((0, restTimer_1.restSecondsFor)({ restSec: 45 }), 45, 'a short rest is used too — the floor belongs to the input, not the reader');
eq((0, restTimer_1.restSecondsFor)({}), restTimer_1.DEFAULT_REST_SEC, 'AN EXERCISE WITH NO REST SET IS THE ORDINARY CASE and must fall back, not become 0');
eq((0, restTimer_1.restSecondsFor)({ restSec: null }), restTimer_1.DEFAULT_REST_SEC, 'an explicit null is the same absence as a missing key');
eq((0, restTimer_1.restSecondsFor)(undefined), restTimer_1.DEFAULT_REST_SEC, 'no exercise at all still yields a usable rest');
eq((0, restTimer_1.restSecondsFor)(null), restTimer_1.DEFAULT_REST_SEC, 'nor does null throw');
eq((0, restTimer_1.restSecondsFor)({ restSec: 0 }), restTimer_1.DEFAULT_REST_SEC, 'A STORED 0 IS NOT A REST — startRest(0) clears the timer, so honouring it would end the rest the instant it began');
eq((0, restTimer_1.restSecondsFor)({ restSec: -30 }), restTimer_1.DEFAULT_REST_SEC, 'a negative rest is damage, not a choice');
eq((0, restTimer_1.restSecondsFor)({ restSec: Number.NaN }), restTimer_1.DEFAULT_REST_SEC, 'NaN out of a parse that failed must not reach the timer, where it would render as "NaN:NaN"');
eq((0, restTimer_1.restSecondsFor)({ restSec: Number.POSITIVE_INFINITY }), restTimer_1.DEFAULT_REST_SEC, 'nor Infinity, which would open a rest that never ends');
eq((0, restTimer_1.restSecondsFor)({ restSec: 90.4 }), 90, 'a fractional rest is rounded, because the display counts whole seconds');
eq((0, restTimer_1.restSecondsFor)({ restSec: 9000 }), restTimer_1.MAX_REST_SEC, 'a rest from an older row that predates the cap is still clamped on the way out');
eq((0, restTimer_1.restSecondsFor)({}, 60), 60, 'the fallback is the caller’s to choose');
eq((0, restTimer_1.restSecondsFor)({ restSec: 120 }, 60), 120, 'and a real value beats it');
// ── what a coach types ────────────────────────────────────────────────────
eq((0, restTimer_1.readRestSeconds)('90').ok, true, '90 is a rest');
eq(secondsOf((0, restTimer_1.readRestSeconds)('90')), 90, '90 reads back as 90');
ok((0, restTimer_1.readRestSeconds)('  120  ').ok, 'surrounding whitespace is not an error');
ok((0, restTimer_1.readRestSeconds)('').ok, 'AN EMPTY FIELD IS NOT A REFUSAL — blank means no rest set, which is the common case');
eq(secondsOf((0, restTimer_1.readRestSeconds)('')), null, 'and blank reads back as null, not as 0 and not as the default');
eq(secondsOf((0, restTimer_1.readRestSeconds)(null)), null, 'an absent field is the same blank');
eq(secondsOf((0, restTimer_1.readRestSeconds)(undefined)), null, 'so is undefined');
eq((0, restTimer_1.readRestSeconds)('0').ok, false, 'ZERO IS REFUSED, not stored — "no rest" and "not decided" would otherwise be the same programme');
eq((0, restTimer_1.readRestSeconds)('2').ok, false, `under ${restTimer_1.MIN_REST_SEC} seconds is not a rest anybody can time`);
eq((0, restTimer_1.readRestSeconds)(String(restTimer_1.MIN_REST_SEC)).ok, true, 'the floor itself is allowed');
eq((0, restTimer_1.readRestSeconds)(String(restTimer_1.MAX_REST_SEC)).ok, true, 'and so is the ceiling');
eq((0, restTimer_1.readRestSeconds)(String(restTimer_1.MAX_REST_SEC + 1)).ok, false, 'one second over the ceiling is refused');
eq((0, restTimer_1.readRestSeconds)('3000').ok, false, 'A MISTYPED 300 IS THE FAILURE THIS EXISTS FOR — fifty minutes of a client watching a timer that looks broken');
eq((0, restTimer_1.readRestSeconds)('1.5').ok, false, 'a decimal is either a slip or minutes typed into a seconds box; guessing which is not this function’s job');
eq((0, restTimer_1.readRestSeconds)('90s').ok, false, 'a unit typed into the box is not a number');
eq((0, restTimer_1.readRestSeconds)('-90').ok, false, 'nor is a negative');
eq((0, restTimer_1.readRestSeconds)('abc').ok, false, 'nor is text');
ok(/seconds/.test(reasonOf((0, restTimer_1.readRestSeconds)('3000'))), 'the refusal says the box is in seconds, because that is the mistake being made');
ok(/setting it to 0/.test(reasonOf((0, restTimer_1.readRestSeconds)('0'))), 'and 0 gets its OWN refusal, not the generic too-short one — the difference between "no rest" and "not decided" is the thing being explained');
// ── the clock ─────────────────────────────────────────────────────────────
eq((0, restTimer_1.restClock)(90), '1:30', 'ninety seconds is one thirty');
eq((0, restTimer_1.restClock)(0), '0:00', 'zero pads');
eq((0, restTimer_1.restClock)(5), '0:05', 'single seconds pad too — "0:5" is not a clock');
eq((0, restTimer_1.restClock)(600), '10:00', 'ten minutes');
eq((0, restTimer_1.restClock)(-4), '0:00', 'a negative never renders as "-1:56"');
eq((0, restTimer_1.restClock)(59.6), '1:00', 'rounding crosses the minute properly rather than printing "0:60"');
// ── the countdown tick ────────────────────────────────────────────────────
eq((0, restTimer_1.shouldTick)(3, null), false, 'THE FIRST READING NEVER TICKS — a 3 second rest would otherwise tick the instant the set was logged');
eq((0, restTimer_1.shouldTick)(3, 4), true, 'crossing into 3 is a tick');
eq((0, restTimer_1.shouldTick)(2, 3), true, 'so is 2');
eq((0, restTimer_1.shouldTick)(1, 2), true, 'so is 1');
eq((0, restTimer_1.shouldTick)(0, 1), false, 'ZERO IS THE CHIME, NOT A TICK — a tick there would double the moment it counts towards');
eq((0, restTimer_1.shouldTick)(3, 3), false, 'THE SAME SECOND READ TWICE TICKS ONCE — the interval runs at 500 ms, so every second is seen twice');
eq((0, restTimer_1.shouldTick)(4, 5), false, 'four is not in the countdown');
eq((0, restTimer_1.shouldTick)(1, 30), false, 'A PHONE THAT WAS IN A POCKET DOES NOT CATCH UP — a jump from 30 straight to 1 plays nothing rather than three ticks at once');
eq((0, restTimer_1.shouldTick)(0, 30), false, 'and a jump straight to zero leaves the chime to say it alone');
eq((0, restTimer_1.shouldTick)(5, 3), false, 'time going backwards, which a clock change can do, is not a tick');
eq(restTimer_1.COUNTDOWN_AT.includes(0), false, 'nothing may quietly add 0 to the tick list');
eq(restTimer_1.COUNTDOWN_AT.length, 3, 'three, two, one — the cue the owner asked for');
// ── the gate on the sound ─────────────────────────────────────────────────
//
// The reason this is tested at all: this codebase shipped two notification
// switches that were read by nothing. A member could turn push off, watch the
// switch move, relaunch and find it still off, and go on receiving every
// notification the app sends. A sound is louder than a notification and the
// place it plays is a gym, so the gate has to be provable rather than trusted.
eq((0, restTimer_1.soundFromStored)('{"restSound":false}'), 'no', 'A STORED false IS THE WHOLE POINT — this is the member who turned the sound off');
eq((0, restTimer_1.soundFromStored)('{"restSound":true}'), 'yes', 'a stored true is an answer too');
eq((0, restTimer_1.soundFromStored)('{"restSound":false,"notifPush":true,"weightUnit":"lb"}'), 'no', 'the answer survives the rest of the settings blob around it, and is not confused with notifPush');
eq((0, restTimer_1.soundFromStored)('{"notifPush":false}'), 'yes', 'TURNING PUSH OFF IS NOT TURNING THE REST TIMER OFF — two different answers in one blob');
eq((0, restTimer_1.soundFromStored)(null), 'yes', 'a fresh install gets the product default, which is on');
eq((0, restTimer_1.soundFromStored)(undefined), 'yes', 'undefined is the same absence as null');
eq((0, restTimer_1.soundFromStored)('{}'), 'yes', 'a blob that predates the key carries no refusal');
eq((0, restTimer_1.soundFromStored)('{"weightUnit":"kg"}'), 'yes', 'nor does one written by an older build');
eq((0, restTimer_1.soundFromStored)('not json'), 'yes', 'an unparseable blob must not throw and must not invent a refusal');
eq((0, restTimer_1.soundFromStored)('null'), 'yes', 'valid JSON that is null has no restSound to read');
eq((0, restTimer_1.soundFromStored)('[]'), 'yes', 'an array has none either, and reading one off it must not crash');
eq((0, restTimer_1.soundFromStored)('"off"'), 'yes', 'a bare string is corruption, not a preference');
eq((0, restTimer_1.soundFromStored)('{"restSound":"false"}'), 'yes', 'the STRING "false" is damage, not a choice — settings.tsx accepts only booleans, and accepting more here would let the switch and the speaker disagree');
eq((0, restTimer_1.soundFromStored)('{"restSound":0}'), 'yes', 'nor is 0 an answer');
eq((0, restTimer_1.restSoundConsent)(), 'unknown', 'AT MODULE LOAD NOBODY HAS READ ANYTHING — and unknown must be a refusal at the speaker, not a guess');
(0, restTimer_1.recordRestSoundConsent)('no');
eq((0, restTimer_1.restSoundConsent)(), 'no', 'a recorded answer is what the latch reports');
(0, restTimer_1.recordRestSoundConsent)('yes');
eq((0, restTimer_1.restSoundConsent)(), 'yes', 'and it can be changed by the member tapping the switch back on');
// ── what the switch says about itself ─────────────────────────────────────
//
// The note has to be true on the handset holding it. It named the MUTE SWITCH
// on every platform, and no Android phone has one — so the single sentence the
// app offers to explain a silent chime sent Android members looking for a
// control that is not on their device, and the bug they would file is "the
// toggle is on and nothing happens". The behaviour itself is the same on both:
// expo-audio maps `playsInSilentMode: false` to the iOS mute switch and to the
// Android RINGER, so silent and vibrate both suppress it there.
ok(/mute switch/.test((0, restTimer_1.restSoundNote)(true, 'ios')), 'on iOS the note names the mute switch, because a member whose phone is on silent will otherwise report the chime as broken');
ok(!/mute switch/.test((0, restTimer_1.restSoundNote)(true, 'android')), 'AN ANDROID PHONE HAS NO MUTE SWITCH — naming one points the member at hardware their handset does not have');
ok(!/mute switch/.test((0, restTimer_1.restSoundNote)(true, 'other')), 'and neither has anything that is not a handset');
ok(/silent or vibrate/.test((0, restTimer_1.restSoundNote)(true, 'android')), 'so Android names what actually silences it: expo-audio gates play() on the ringer, and VIBRATE suppresses the chime exactly as silent does');
for (const p of ['ios', 'android', 'other']) {
    ok(/notification/.test((0, restTimer_1.restSoundNote)(true, p)), `${p} names what actually happens when the phone is in a pocket, rather than implying the chime plays from there`);
    ok(/build/.test((0, restTimer_1.restSoundNote)(false, p)), `${p}: A BUILD WITH NO AUDIO SAYS SO — a switch offering a sound the binary cannot make is the expo-video defect again`);
    ok(!/mute switch/.test((0, restTimer_1.restSoundNote)(false, p)), `${p}: and it does not go on describing behaviour this install does not have`);
    ok((0, restTimer_1.restSoundNote)(true, p) !== (0, restTimer_1.restSoundNote)(false, p), `${p}: the two cases are genuinely different sentences, not one string with a flag nobody reads`);
}
ok((0, restTimer_1.restSoundNote)(true, 'ios') !== (0, restTimer_1.restSoundNote)(true, 'android'), 'the two platforms do not share one sentence — that sharing is the whole defect');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('restTimer tests passed');
