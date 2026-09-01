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
import {
  LARGE_TYPE_SCALE, MAX_FONT_SCALE, MIN_FONT_SCALE,
  atScale, clampFontScale, effectiveWidth, fontScaleNote, isLargeTypeScale, linesAtScale,
} from './typeScale';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── a reading we are willing to multiply by ─────────────────────────────── */

eq(clampFontScale(1), 1, 'the standard setting is 1');
eq(clampFontScale(2), 2, 'a doubled text size is 2');
eq(clampFontScale(0.82), 0.82, "iOS's smallest step is believed");
eq(clampFontScale(3.12), 3.12, "and so is iOS's largest");

// The clamp is not a ceiling on the reader — the platform still draws the
// glyphs at whatever size it likes. It is a guard on OUR arithmetic.
eq(clampFontScale(99), MAX_FONT_SCALE, 'an absurd reading is clamped rather than trusted');
eq(clampFontScale(0.1), MIN_FONT_SCALE, 'and so is an absurdly small one');

// Every one of these would otherwise multiply every line height in the app by
// nothing, which is not "text as drawn", it is text with no line box at all.
eq(clampFontScale(0), 1, 'a zero reading is the app as drawn, not a collapsed layout');
eq(clampFontScale(-2), 1, 'a negative reading is refused');
eq(clampFontScale(NaN), 1, 'NaN is refused');
eq(clampFontScale(null), 1, 'a missing reading is refused');
eq(clampFontScale(undefined), 1, 'so is an absent one');
eq(clampFontScale('2' as unknown as number), 1, 'and a string that looks like a number');

/* ── the growth itself ───────────────────────────────────────────────────── */

// The seven line heights in src/theme/scale.ts, at the reader's own size.
eq(atScale(21, 1), 21, 'body keeps its 21pt line at the standard size');
eq(atScale(21, 2), 42, 'and gets 42 when the glyphs are doubled');
eq(atScale(46, 1.5), 69, 'the hero line grows by the same factor');
eq(atScale(14, 3), 42, 'so does the smallest one');

// Whole points. A fractional line height is legal and lands text on half
// pixels, which is exactly the blur this is meant to take off the screen of
// somebody who turned their text up.
ok(Number.isInteger(atScale(21, 1.35)), 'a grown line height is a whole number of points');
eq(atScale(16, 1.35), 22, 'and it is rounded, not truncated');

eq(atScale(0, 2), 0, 'nothing grows to nothing');
eq(atScale(NaN, 2), 0, 'an unreadable measurement is not multiplied into a bigger one');

// The rule the whole file exists to hold: this is never applied to a fontSize.
// Nothing in a test can enforce that, and it is stated here so the next reader
// of these assertions knows it was a decision — see the header of typeScale.ts.

/* ── layouts that pack onto one line ─────────────────────────────────────── */

ok(!isLargeTypeScale(1), 'the standard size is not large text');
ok(!isLargeTypeScale(1.2), 'nor is one step up');
ok(isLargeTypeScale(LARGE_TYPE_SCALE), 'the named threshold is large text');
ok(isLargeTypeScale(3), 'and so is anything past it');

eq(linesAtScale(1), 1, 'a one-line label stays one line at the standard size');
eq(linesAtScale(2), 2, 'and is allowed a second when the text is large');
eq(linesAtScale(1, 2), 2, 'a two-line note keeps its two lines');
eq(linesAtScale(2, 2), 3, 'and is allowed a third');

/* ── the chart axis: fewer labels, not smaller ones ──────────────────────── */

// `maxTicksForWidth` already decides how many dates fit from a MEASURED width.
// Handing it a width divided by the text scale reuses that decision instead of
// teaching it a second rule about type.
eq(effectiveWidth(320, 1), 320, 'at the standard size the axis has all its width');
eq(effectiveWidth(320, 2), 160, 'at double text it has half of it, so half the labels fit');
ok(effectiveWidth(320, 3) < effectiveWidth(320, 2), 'and it keeps shrinking as the text grows');
eq(effectiveWidth(0, 2), 0, 'an unmeasured width stays unmeasured rather than becoming a guess');
eq(effectiveWidth(NaN, 2), 0, 'and so does an unreadable one');
ok(effectiveWidth(10, 4) >= 1, 'a tiny width never divides down to zero');

/* ── what the reader is told ─────────────────────────────────────────────── */

// Nothing is said at the standard size. A screen that announces "your text is
// normal" is noise on the one screen somebody visits because reading is hard.
eq(fontScaleNote(1), null, 'nothing is said at the standard size');
ok((fontScaleNote(2) || '').includes('200%'), 'a doubled setting is named as a percentage');
ok((fontScaleNote(2) || '').includes('phone'), 'and named as the phone’s, because it is');
ok((fontScaleNote(0.82) || '').includes('smaller'), 'a smaller-than-standard setting says so');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('typeScale: ok');
