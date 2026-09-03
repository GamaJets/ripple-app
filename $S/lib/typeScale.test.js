"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Dynamic Type, as arithmetic. Compile with tsc, run with node.
//
// The defect these pin is subtle enough to be worth restating. React Native
// scales fontSize with the phone's text setting on its own — it always has —
// and does NOT scale `lineHeight`. src/theme/scale.ts pinned a line height
// beside every one of its seven sizes, so a member on Larger Text at 200% was
// handed 30pt glyphs to lay out inside a 21pt line: clipped descenders,
// overlapping rows, and the harder they made the text to miss the worse it got.
//
// So the assertions below are all one shape — a pinned point measurement grows
// by exactly the factor the platform is growing the font by — plus the two
// guards that stop a bad reading from the platform collapsing every line in the
// app to nothing.
const typeScale_1 = require("./typeScale");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── a reading we are willing to multiply by ─────────────────────────────── */
eq((0, typeScale_1.clampFontScale)(1), 1, 'the standard setting is 1');
eq((0, typeScale_1.clampFontScale)(2), 2, 'a doubled text size is 2');
eq((0, typeScale_1.clampFontScale)(0.82), 0.82, "iOS's smallest step is believed");
eq((0, typeScale_1.clampFontScale)(3.12), 3.12, "and so is iOS's largest");
// The clamp is not a ceiling on the reader — the platform still draws the
// glyphs at whatever size it likes. It is a guard on OUR arithmetic.
eq((0, typeScale_1.clampFontScale)(99), typeScale_1.MAX_FONT_SCALE, 'an absurd reading is clamped rather than trusted');
eq((0, typeScale_1.clampFontScale)(0.1), typeScale_1.MIN_FONT_SCALE, 'and so is an absurdly small one');
// Every one of these would otherwise multiply every line height in the app by
// nothing, which is not "text as drawn", it is text with no line box at all.
eq((0, typeScale_1.clampFontScale)(0), 1, 'a zero reading is the app as drawn, not a collapsed layout');
eq((0, typeScale_1.clampFontScale)(-2), 1, 'a negative reading is refused');
eq((0, typeScale_1.clampFontScale)(NaN), 1, 'NaN is refused');
eq((0, typeScale_1.clampFontScale)(null), 1, 'a missing reading is refused');
eq((0, typeScale_1.clampFontScale)(undefined), 1, 'so is an absent one');
eq((0, typeScale_1.clampFontScale)('2'), 1, 'and a string that looks like a number');
/* ── the growth itself ───────────────────────────────────────────────────── */
// The seven line heights in src/theme/scale.ts, at the reader's own size.
eq((0, typeScale_1.atScale)(21, 1), 21, 'body keeps its 21pt line at the standard size');
eq((0, typeScale_1.atScale)(21, 2), 42, 'and gets 42 when the glyphs are doubled');
eq((0, typeScale_1.atScale)(46, 1.5), 69, 'the hero line grows by the same factor');
eq((0, typeScale_1.atScale)(14, 3), 42, 'so does the smallest one');
// Whole points. A fractional line height is legal and lands text on half
// pixels, which is exactly the blur this is meant to take off the screen of
// somebody who turned their text up.
ok(Number.isInteger((0, typeScale_1.atScale)(21, 1.35)), 'a grown line height is a whole number of points');
eq((0, typeScale_1.atScale)(16, 1.35), 22, 'and it is rounded, not truncated');
eq((0, typeScale_1.atScale)(0, 2), 0, 'nothing grows to nothing');
eq((0, typeScale_1.atScale)(NaN, 2), 0, 'an unreadable measurement is not multiplied into a bigger one');
// The rule the whole file exists to hold: this is never applied to a fontSize.
// Nothing in a test can enforce that, and it is stated here so the next reader
// of these assertions knows it was a decision — see the header of typeScale.ts.
/* ── layouts that pack onto one line ─────────────────────────────────────── */
ok(!(0, typeScale_1.isLargeTypeScale)(1), 'the standard size is not large text');
ok(!(0, typeScale_1.isLargeTypeScale)(1.2), 'nor is one step up');
ok((0, typeScale_1.isLargeTypeScale)(typeScale_1.LARGE_TYPE_SCALE), 'the named threshold is large text');
ok((0, typeScale_1.isLargeTypeScale)(3), 'and so is anything past it');
eq((0, typeScale_1.linesAtScale)(1), 1, 'a one-line label stays one line at the standard size');
eq((0, typeScale_1.linesAtScale)(2), 2, 'and is allowed a second when the text is large');
eq((0, typeScale_1.linesAtScale)(1, 2), 2, 'a two-line note keeps its two lines');
eq((0, typeScale_1.linesAtScale)(2, 2), 3, 'and is allowed a third');
/* ── the chart axis: fewer labels, not smaller ones ──────────────────────── */
// `maxTicksForWidth` already decides how many dates fit from a MEASURED width.
// Handing it a width divided by the text scale reuses that decision instead of
// teaching it a second rule about type.
eq((0, typeScale_1.effectiveWidth)(320, 1), 320, 'at the standard size the axis has all its width');
eq((0, typeScale_1.effectiveWidth)(320, 2), 160, 'at double text it has half of it, so half the labels fit');
ok((0, typeScale_1.effectiveWidth)(320, 3) < (0, typeScale_1.effectiveWidth)(320, 2), 'and it keeps shrinking as the text grows');
eq((0, typeScale_1.effectiveWidth)(0, 2), 0, 'an unmeasured width stays unmeasured rather than becoming a guess');
eq((0, typeScale_1.effectiveWidth)(NaN, 2), 0, 'and so does an unreadable one');
ok((0, typeScale_1.effectiveWidth)(10, 4) >= 1, 'a tiny width never divides down to zero');
/* ── what the reader is told ─────────────────────────────────────────────── */
// Nothing is said at the standard size. A screen that announces "your text is
// normal" is noise on the one screen somebody visits because reading is hard.
eq((0, typeScale_1.fontScaleNote)(1), null, 'nothing is said at the standard size');
ok(((0, typeScale_1.fontScaleNote)(2) || '').includes('200%'), 'a doubled setting is named as a percentage');
ok(((0, typeScale_1.fontScaleNote)(2) || '').includes('phone'), 'and named as the phone’s, because it is');
ok(((0, typeScale_1.fontScaleNote)(0.82) || '').includes('smaller'), 'a smaller-than-standard setting says so');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('typeScale: ok');
