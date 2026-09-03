"use strict";
// ── Which way is forward ─────────────────────────────────────────────────────
//
// Almost nothing in a React Native layout needs to know whether the reader
// reads left-to-right or right-to-left, and the whole point of this module is
// to keep it that way.
//
// Yoga already mirrors everything it can: a `flexDirection: 'row'` lays out
// right-to-left under RTL, `alignItems: 'flex-start'` moves to the right edge,
// and the logical style properties — `marginStart`, `paddingEnd`, `start`,
// `end`, `borderStartWidth` — resolve to whichever physical side is the
// leading one. So the correct fix for a `marginLeft` is not a branch on
// direction at the call site, it is `marginStart`, and the sweep that added
// this module converted them rather than importing it. That is why this file
// is short: it holds ONLY the decisions the style system genuinely cannot
// make, and there are five of them.
//
// ── the five ──────────────────────────────────────────────────────────────
//
//  1. WHICH GLYPH POINTS FORWARD. `Icon` has two chevrons, `chevron` (points
//     right) and `back` (points left), and react-native-svg does not mirror a
//     path. So a "drill into this row" affordance must pick the other one in
//     Arabic, and a back arrow must pick the other one too.
//
//  2. THE SAME, AS A CHARACTER. Some rows draw the chevron as the text '›'
//     rather than as an Icon. A character is not mirrored either.
//
//  3. WHICH WAY A DISCLOSURE CHEVRON TURNS. A collapsed row draws the forward
//     chevron and rotates it 90° to point down when it opens. Rotation is
//     clockwise, so 90° turns a right-pointing chevron down and an RTL,
//     left-pointing one UP. The sign has to flip with the direction.
//
//  4. TRAILING TEXT ALIGNMENT. This is the one real gap in the platform.
//     `textAlign` takes 'auto' | 'left' | 'right' | 'center' | 'justify' and
//     there is no 'start' or 'end'. 'auto' IS start — it follows the writing
//     direction — so a leading-aligned Text needs nothing from this module and
//     should say 'auto' or say nothing at all. A value column pinned to the
//     trailing edge has no such spelling and has to be told.
//
//  5. WHAT MUST NOT MIRROR. Below.
//
// ── what must not mirror, and why it is a list rather than a rule ─────────
//
// A mirrored timeline is worse than an unmirrored layout: a layout that leans
// the wrong way is awkward, a chart whose time runs backwards is false. The
// line this codebase draws is:
//
//   IF THE DRAWING CANNOT MIRROR, ITS LABELS MUST NOT EITHER.
//
// The Trend chart in src/ui/kit.tsx is the case that forced the rule. The line
// itself is an <Svg> in user-space coordinates and react-native-svg mirrors
// nothing, so the polyline runs oldest-on-the-left in every locale. Its tick
// strip is a row of absolutely-placed labels underneath. Convert those to
// `start`/`end` and the labels mirror while the line does not: every date now
// sits under the wrong point, and the chart lies rather than merely looking
// foreign. So the strip stays on physical `left`/`right`, marked in place.
//
// Media transport is the second case and it is not about drawing. Skip-back
// and skip-forward on a player mean "earlier in this track" and "later in this
// track"; they are not navigation and they do not follow reading order. Apple
// and Android both leave them alone in RTL and so do we.
//
// Everything else in this app mirrors, INCLUDING several things that look like
// they might not:
//
//   · The training heatmap on the Consistency screen. Its columns are weeks
//     and its axis is time, but it is built out of Views in a row with month
//     labels above them — a labelled grid, not a plotted axis — so Yoga
//     mirrors it whole and it stays readable. The rule above is about a
//     drawing that CANNOT follow; this one can.
//   · The month calendar. Arabic calendars mirror; Sunday moves to the right.
//   · The retention cohort table. Labelled columns are read, not plotted.
//   · Progress and magnitude bars. A determinate bar fills from the start
//     edge, which is what a width-percentage child of a plain View already
//     does under RTL without anyone doing anything.
//
// Numbers, times and durations are absent from both lists on purpose: they are
// not laid out by us at all. A numeral run inside an Arabic paragraph is
// ordered by the platform's own bidi algorithm, which gets it right, and any
// help from us would be interference.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNMIRRORED = exports.START_ALIGN = void 0;
exports.forwardIcon = forwardIcon;
exports.backIcon = backIcon;
exports.forwardChar = forwardChar;
exports.backChar = backChar;
exports.forwardArrow = forwardArrow;
exports.backArrow = backArrow;
exports.mirrorTurn = mirrorTurn;
exports.endAlign = endAlign;
exports.mirrors = mirrors;
/**
 * The chevron for an affordance that goes FORWARD — drilling into a row,
 * advancing a step, the trailing '›' on a settings line.
 */
function forwardIcon(rtl) {
    return rtl ? 'back' : 'chevron';
}
/** The chevron for an affordance that goes BACK. The other one, always. */
function backIcon(rtl) {
    return rtl ? 'chevron' : 'back';
}
/** Forward, as the character a Text draws instead of an Icon. */
function forwardChar(rtl) {
    return rtl ? '‹' : '›';
}
/** Back, as a character. */
function backChar(rtl) {
    return rtl ? '›' : '‹';
}
/**
 * Forward, as a full ARROW rather than a chevron.
 *
 * A separate pair because the two say different things and the app uses both:
 * '›' is "there is more of this over here", '→' is "this becomes that" — the
 * Next Exercise button, and the chip that copies Monday's meals to Tuesday.
 * Collapsing them would have quietly restyled six buttons.
 */
function forwardArrow(rtl) {
    return rtl ? '←' : '→';
}
/** Back, as an arrow. */
function backArrow(rtl) {
    return rtl ? '→' : '←';
}
/**
 * A rotation applied to a chevron, mirrored.
 *
 * Rotation is clockwise in both directions — RN does not mirror a transform —
 * so the same +90° that turns a right-pointing chevron DOWN turns a
 * left-pointing one UP. Every call site that rotates a disclosure chevron
 * passes its LTR angle through here and gets the angle that produces the same
 * apparent movement.
 */
function mirrorTurn(rtl, degrees) {
    // -0 stringifies as "0" here rather than "-0", which matters only because a
    // style string is compared in the test and "-0deg" would be a surprise.
    const d = rtl ? -degrees : degrees;
    return `${d === 0 ? 0 : d}deg`;
}
/**
 * `textAlign` for text pinned to the TRAILING edge — the value in a
 * label-and-value row, a figure in a right-hand column, a numeric input.
 *
 * There is no 'end' in React Native's textAlign, which is the whole reason
 * this function exists. See the header.
 */
function endAlign(rtl) {
    return rtl ? 'left' : 'right';
}
/**
 * `textAlign` for text pinned to the LEADING edge.
 *
 * Always 'auto', in every locale, because 'auto' means "follow the writing
 * direction" and that is the entire request. It is a constant rather than a
 * function so that nothing has to pass a direction in to be told a fact that
 * does not depend on one — and it is exported at all so that a screen which
 * needs to SAY it is leading-aligned has a name for it instead of writing
 * `textAlign: 'left'`, which is the bug.
 */
exports.START_ALIGN = 'auto';
const MIRRORS = {
    // Follows reading order.
    'nav-chevron': true,
    'back-arrow': true,
    'disclosure': true,
    'row-order': true,
    'inset': true,
    'table-column': true,
    'calendar-grid': true,
    'heatmap-grid': true,
    'progress-bar': true,
    // Does not.
    'chart-time-axis': false,
    'svg-drawing': false,
    'media-transport': false,
    'clock-face': false,
    'digits': false,
    'duration': false,
};
/** Does this kind of thing mirror in a right-to-left locale? */
function mirrors(kind) {
    return MIRRORS[kind];
}
/**
 * The kinds that do NOT mirror, in the order they are argued in the header.
 *
 * Exported so the test can assert the list is exactly this and no longer: a
 * new `false` in the table above without a paragraph explaining it fails the
 * build, which is the only way a list like this stays honest.
 */
exports.UNMIRRORED = [
    'chart-time-axis',
    'svg-drawing',
    'media-transport',
    'clock-face',
    'digits',
    'duration',
];
