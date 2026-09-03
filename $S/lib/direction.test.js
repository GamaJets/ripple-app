"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The direction decisions, pinned. Compile with tsc, run with node.
//
// Two of these assertions are worth more than the rest and both are about
// something that LOOKS symmetric and is not.
//
// The first is `mirrorTurn`. A disclosure chevron is drawn pointing forward and
// rotated 90° to point down when the row opens. Rotation is clockwise in every
// locale — React Native does not mirror a transform — so the RTL chevron,
// which points LEFT, goes UP under the same +90° and the row that was supposed
// to open pointed at the ceiling. The sign has to flip and the test says so in
// both directions.
//
// The second is `UNMIRRORED`. The list of things that must not mirror is the
// part of this work that cannot be recovered by looking at a screen: a
// mirrored time axis renders perfectly and is false. The test pins the list to
// exactly the entries the module header argues for, so adding a seventh
// without writing down why fails the build.
const direction_1 = require("./direction");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the chevrons ──────────────────────────────────────────────────────── */
eq((0, direction_1.forwardIcon)(false), 'chevron', 'forward points right in English');
eq((0, direction_1.forwardIcon)(true), 'back', 'forward points left in Arabic');
eq((0, direction_1.backIcon)(false), 'back', 'back points left in English');
eq((0, direction_1.backIcon)(true), 'chevron', 'back points right in Arabic');
// The two are always opposites. This is the property, and it is what would
// break if somebody "fixed" one of them alone.
for (const rtl of [false, true]) {
    ok((0, direction_1.forwardIcon)(rtl) !== (0, direction_1.backIcon)(rtl), `forward and back are different glyphs (rtl=${rtl})`);
}
// And each direction uses both glyphs — a version that returned 'chevron' for
// everything would still pass the line above if backIcon were also wrong.
eq([(0, direction_1.forwardIcon)(false), (0, direction_1.backIcon)(false)].sort().join(','), 'back,chevron', 'English uses both glyphs');
eq([(0, direction_1.forwardIcon)(true), (0, direction_1.backIcon)(true)].sort().join(','), 'back,chevron', 'Arabic uses both glyphs');
eq((0, direction_1.forwardChar)(false), '›', 'the character form of forward, English');
eq((0, direction_1.forwardChar)(true), '‹', 'the character form of forward, Arabic');
eq((0, direction_1.backChar)(false), '‹', 'the character form of back, English');
eq((0, direction_1.backChar)(true), '›', 'the character form of back, Arabic');
for (const rtl of [false, true]) {
    ok((0, direction_1.forwardChar)(rtl) !== (0, direction_1.backChar)(rtl), `the two characters differ (rtl=${rtl})`);
    // The character and the icon have to agree about which way is forward, or a
    // settings list drawn half one way and half the other disagrees with itself
    // on the same screen. '›' points right; so does the 'chevron' icon.
    eq((0, direction_1.forwardChar)(rtl) === '›', (0, direction_1.forwardIcon)(rtl) === 'chevron', `the glyph and the icon agree about forward (rtl=${rtl})`);
}
eq((0, direction_1.forwardArrow)(false), '→', 'the arrow form of forward, English');
eq((0, direction_1.forwardArrow)(true), '←', 'the arrow form of forward, Arabic');
eq((0, direction_1.backArrow)(false), '←', 'the arrow form of back, English');
eq((0, direction_1.backArrow)(true), '→', 'the arrow form of back, Arabic');
for (const rtl of [false, true]) {
    ok((0, direction_1.forwardArrow)(rtl) !== (0, direction_1.backArrow)(rtl), `the two arrows differ (rtl=${rtl})`);
    // The arrow and the chevron are a different WEIGHT of the same claim — '→'
    // is "this becomes that", '›' is "more of this over here" — so they must
    // never disagree about which way forward is.
    eq((0, direction_1.forwardArrow)(rtl) === '→', (0, direction_1.forwardChar)(rtl) === '›', `the arrow and the chevron agree about forward (rtl=${rtl})`);
    // And they are not interchangeable, which is why there are four functions
    // and not two. A refactor that collapsed them would restyle six buttons.
    ok((0, direction_1.forwardArrow)(rtl) !== (0, direction_1.forwardChar)(rtl), `an arrow is not a chevron (rtl=${rtl})`);
}
/* ── the turn ──────────────────────────────────────────────────────────── */
eq((0, direction_1.mirrorTurn)(false, 90), '90deg', 'an English disclosure chevron turns down clockwise');
eq((0, direction_1.mirrorTurn)(true, 90), '-90deg', 'an Arabic one turns down anticlockwise, from the other side');
eq((0, direction_1.mirrorTurn)(false, -90), '-90deg', 'the other idiom — pointing up when open — mirrors too');
eq((0, direction_1.mirrorTurn)(true, -90), '90deg', 'and mirrors the other way');
// Closed is closed in both directions. `-0deg` is a valid CSS angle and would
// almost certainly render, but it is the kind of value that turns up in a
// snapshot diff a year later and costs somebody an afternoon.
eq((0, direction_1.mirrorTurn)(false, 0), '0deg', 'no turn is no turn');
eq((0, direction_1.mirrorTurn)(true, 0), '0deg', 'and is not "-0deg"');
/* ── trailing text ─────────────────────────────────────────────────────── */
eq((0, direction_1.endAlign)(false), 'right', 'a value column hugs the right in English');
eq((0, direction_1.endAlign)(true), 'left', 'and the left in Arabic');
eq(direction_1.START_ALIGN, 'auto', "leading text is 'auto' — the platform's own word for the start edge");
// The pair is what makes this honest: if endAlign ever returned 'auto' the
// value column would silently become leading-aligned in BOTH directions and
// look fine in English. tsc proves this today — the two return types have no
// overlap, and comparing them directly is a compile error rather than an
// assertion — so the comparison is widened to string to keep it as a RUNTIME
// statement about what the functions return, which is what survives someone
// broadening either signature.
for (const rtl of [false, true]) {
    ok((0, direction_1.endAlign)(rtl) !== direction_1.START_ALIGN, `trailing is not leading (rtl=${rtl})`);
}
/* ── what must not mirror ──────────────────────────────────────────────── */
// Every kind the type admits has an answer. A missing entry is `undefined`,
// which is falsy, which would silently pin a new kind to "does not mirror" —
// the worse of the two defaults.
const ALL = [
    'nav-chevron', 'back-arrow', 'disclosure', 'row-order', 'inset',
    'table-column', 'calendar-grid', 'heatmap-grid', 'progress-bar',
    'chart-time-axis', 'svg-drawing', 'media-transport', 'clock-face',
    'digits', 'duration',
];
for (const k of ALL) {
    ok(typeof (0, direction_1.mirrors)(k) === 'boolean', `${k} has a decision, not an undefined`);
}
ok((0, direction_1.mirrors)('nav-chevron'), 'a row you drill into mirrors');
ok((0, direction_1.mirrors)('back-arrow'), 'a back arrow mirrors');
ok((0, direction_1.mirrors)('disclosure'), 'a disclosure chevron mirrors');
ok((0, direction_1.mirrors)('inset'), 'an inset mirrors — that is what marginStart is for');
ok((0, direction_1.mirrors)('table-column'), 'labelled columns are read, so they mirror');
ok((0, direction_1.mirrors)('calendar-grid'), 'Arabic calendars mirror; Sunday moves to the right');
ok((0, direction_1.mirrors)('heatmap-grid'), 'the training heatmap is a labelled grid of Views and can follow');
ok((0, direction_1.mirrors)('progress-bar'), 'a determinate bar fills from the start edge');
ok(!(0, direction_1.mirrors)('chart-time-axis'), 'a plotted time axis does not mirror');
ok(!(0, direction_1.mirrors)('svg-drawing'), 'react-native-svg mirrors nothing, so neither may its labels');
ok(!(0, direction_1.mirrors)('media-transport'), 'skip-back means earlier in the track, not "back" ');
ok(!(0, direction_1.mirrors)('clock-face'), 'a clock face does not mirror');
ok(!(0, direction_1.mirrors)('digits'), 'the platform orders a numeral run; we do not');
ok(!(0, direction_1.mirrors)('duration'), 'nor a duration');
// The list and the table cannot disagree. Both directions are checked, because
// an entry deleted from UNMIRRORED and left `false` in the table is exactly as
// wrong as one added without a reason.
const fromTable = ALL.filter((k) => !(0, direction_1.mirrors)(k)).sort().join(',');
eq(fromTable, [...direction_1.UNMIRRORED].sort().join(','), 'UNMIRRORED is exactly the false rows of the table');
eq(direction_1.UNMIRRORED.length, 6, 'there are six things that do not mirror, and the header argues each');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`direction: ok (${ALL.length} kinds decided, ${direction_1.UNMIRRORED.length} of them unmirrored)`);
