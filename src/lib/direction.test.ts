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
import {
  START_ALIGN, UNMIRRORED, backArrow, backChar, backIcon, endAlign, forwardArrow,
  forwardChar, forwardIcon, mirrorTurn, mirrors, type Kind,
} from './direction';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the chevrons ──────────────────────────────────────────────────────── */

eq(forwardIcon(false), 'chevron', 'forward points right in English');
eq(forwardIcon(true), 'back', 'forward points left in Arabic');
eq(backIcon(false), 'back', 'back points left in English');
eq(backIcon(true), 'chevron', 'back points right in Arabic');

// The two are always opposites. This is the property, and it is what would
// break if somebody "fixed" one of them alone.
for (const rtl of [false, true]) {
  ok(forwardIcon(rtl) !== backIcon(rtl), `forward and back are different glyphs (rtl=${rtl})`);
}
// And each direction uses both glyphs — a version that returned 'chevron' for
// everything would still pass the line above if backIcon were also wrong.
eq([forwardIcon(false), backIcon(false)].sort().join(','), 'back,chevron', 'English uses both glyphs');
eq([forwardIcon(true), backIcon(true)].sort().join(','), 'back,chevron', 'Arabic uses both glyphs');

eq(forwardChar(false), '›', 'the character form of forward, English');
eq(forwardChar(true), '‹', 'the character form of forward, Arabic');
eq(backChar(false), '‹', 'the character form of back, English');
eq(backChar(true), '›', 'the character form of back, Arabic');
for (const rtl of [false, true]) {
  ok(forwardChar(rtl) !== backChar(rtl), `the two characters differ (rtl=${rtl})`);
  // The character and the icon have to agree about which way is forward, or a
  // settings list drawn half one way and half the other disagrees with itself
  // on the same screen. '›' points right; so does the 'chevron' icon.
  eq(forwardChar(rtl) === '›', forwardIcon(rtl) === 'chevron',
    `the glyph and the icon agree about forward (rtl=${rtl})`);
}

eq(forwardArrow(false), '→', 'the arrow form of forward, English');
eq(forwardArrow(true), '←', 'the arrow form of forward, Arabic');
eq(backArrow(false), '←', 'the arrow form of back, English');
eq(backArrow(true), '→', 'the arrow form of back, Arabic');
for (const rtl of [false, true]) {
  ok(forwardArrow(rtl) !== backArrow(rtl), `the two arrows differ (rtl=${rtl})`);
  // The arrow and the chevron are a different WEIGHT of the same claim — '→'
  // is "this becomes that", '›' is "more of this over here" — so they must
  // never disagree about which way forward is.
  eq(forwardArrow(rtl) === '→', forwardChar(rtl) === '›',
    `the arrow and the chevron agree about forward (rtl=${rtl})`);
  // And they are not interchangeable, which is why there are four functions
  // and not two. A refactor that collapsed them would restyle six buttons.
  ok(forwardArrow(rtl) !== forwardChar(rtl), `an arrow is not a chevron (rtl=${rtl})`);
}

/* ── the turn ──────────────────────────────────────────────────────────── */

eq(mirrorTurn(false, 90), '90deg', 'an English disclosure chevron turns down clockwise');
eq(mirrorTurn(true, 90), '-90deg', 'an Arabic one turns down anticlockwise, from the other side');
eq(mirrorTurn(false, -90), '-90deg', 'the other idiom — pointing up when open — mirrors too');
eq(mirrorTurn(true, -90), '90deg', 'and mirrors the other way');
// Closed is closed in both directions. `-0deg` is a valid CSS angle and would
// almost certainly render, but it is the kind of value that turns up in a
// snapshot diff a year later and costs somebody an afternoon.
eq(mirrorTurn(false, 0), '0deg', 'no turn is no turn');
eq(mirrorTurn(true, 0), '0deg', 'and is not "-0deg"');

/* ── trailing text ─────────────────────────────────────────────────────── */

eq(endAlign(false), 'right', 'a value column hugs the right in English');
eq(endAlign(true), 'left', 'and the left in Arabic');
eq(START_ALIGN, 'auto', "leading text is 'auto' — the platform's own word for the start edge");
// The pair is what makes this honest: if endAlign ever returned 'auto' the
// value column would silently become leading-aligned in BOTH directions and
// look fine in English. tsc proves this today — the two return types have no
// overlap, and comparing them directly is a compile error rather than an
// assertion — so the comparison is widened to string to keep it as a RUNTIME
// statement about what the functions return, which is what survives someone
// broadening either signature.
for (const rtl of [false, true]) {
  ok((endAlign(rtl) as string) !== (START_ALIGN as string), `trailing is not leading (rtl=${rtl})`);
}

/* ── what must not mirror ──────────────────────────────────────────────── */

// Every kind the type admits has an answer. A missing entry is `undefined`,
// which is falsy, which would silently pin a new kind to "does not mirror" —
// the worse of the two defaults.
const ALL: Kind[] = [
  'nav-chevron', 'back-arrow', 'disclosure', 'row-order', 'inset',
  'table-column', 'calendar-grid', 'heatmap-grid', 'progress-bar',
  'chart-time-axis', 'svg-drawing', 'media-transport', 'clock-face',
  'digits', 'duration',
];
for (const k of ALL) {
  ok(typeof mirrors(k) === 'boolean', `${k} has a decision, not an undefined`);
}

ok(mirrors('nav-chevron'), 'a row you drill into mirrors');
ok(mirrors('back-arrow'), 'a back arrow mirrors');
ok(mirrors('disclosure'), 'a disclosure chevron mirrors');
ok(mirrors('inset'), 'an inset mirrors — that is what marginStart is for');
ok(mirrors('table-column'), 'labelled columns are read, so they mirror');
ok(mirrors('calendar-grid'), 'Arabic calendars mirror; Sunday moves to the right');
ok(mirrors('heatmap-grid'), 'the training heatmap is a labelled grid of Views and can follow');
ok(mirrors('progress-bar'), 'a determinate bar fills from the start edge');

ok(!mirrors('chart-time-axis'), 'a plotted time axis does not mirror');
ok(!mirrors('svg-drawing'), 'react-native-svg mirrors nothing, so neither may its labels');
ok(!mirrors('media-transport'), 'skip-back means earlier in the track, not "back" ');
ok(!mirrors('clock-face'), 'a clock face does not mirror');
ok(!mirrors('digits'), 'the platform orders a numeral run; we do not');
ok(!mirrors('duration'), 'nor a duration');

// The list and the table cannot disagree. Both directions are checked, because
// an entry deleted from UNMIRRORED and left `false` in the table is exactly as
// wrong as one added without a reason.
const fromTable = ALL.filter((k) => !mirrors(k)).sort().join(',');
eq(fromTable, [...UNMIRRORED].sort().join(','),
  'UNMIRRORED is exactly the false rows of the table');
eq(UNMIRRORED.length, 6, 'there are six things that do not mirror, and the header argues each');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`direction: ok (${ALL.length} kinds decided, ${UNMIRRORED.length} of them unmirrored)`);
