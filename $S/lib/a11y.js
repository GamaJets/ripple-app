"use strict";
// ── Accessibility, as arithmetic ─────────────────────────────────────────────
// Two things in this app were decided by eye and are decidable by measurement:
// whether a colour is legible on the ground it sits on, and whether a control
// is big enough to hit. Both are pure functions of numbers, so both live here
// and both are tested — which means the palette can no longer drift below the
// line without `npm test` saying so.
//
// Nothing in this file imports react-native. `theme/tokens.ts` is plain data
// and can therefore be walked by the test; `theme/scale.ts` cannot, and does
// not need to be.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_TARGET = exports.INK_ON_DARK = exports.INK_ON_LIGHT = exports.AA_MARK = exports.AA_LARGE = exports.AA_TEXT = void 0;
exports.rgb = rgb;
exports.luminance = luminance;
exports.contrastRatio = contrastRatio;
exports.isLargeText = isLargeText;
exports.meetsText = meetsText;
exports.meetsMark = meetsMark;
exports.readableInkOn = readableInkOn;
exports.hitSlopFor = hitSlopFor;
exports.meetsTarget = meetsTarget;
exports.switchLabel = switchLabel;
/* ── contrast ─────────────────────────────────────────────────────────────── */
/** '#1b3229' or '1b3229' → [27, 50, 41]. Null for anything that is not one. */
function rgb(hex) {
    const h = hex.trim().replace('#', '');
    // Only a full six-digit hex. rgba() strings reach these tokens too (ring is
    // one), and a half-parsed 'rgba(255,255,255,0.09)' would return a confident
    // wrong number rather than an admission that it cannot be measured.
    if (!/^[0-9a-fA-F]{6}$/.test(h))
        return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
function luminance(hex) {
    const c = rgb(hex);
    if (!c)
        return null;
    const lin = c.map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
/**
 * The WCAG contrast ratio between two opaque colours, 1 (identical) to 21
 * (black on white). Null when either colour cannot be measured — a caller
 * must decide what to do about that rather than be handed a 1 or a 21.
 */
function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    if (la == null || lb == null)
        return null;
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}
/** WCAG AA for body text. */
exports.AA_TEXT = 4.5;
/** WCAG AA for large text — 18pt, or 14pt at 700+. */
exports.AA_LARGE = 3;
/** WCAG AA 1.4.11 for a mark, an icon or any other non-text thing you must see. */
exports.AA_MARK = 3;
/**
 * Large text, by WCAG's definition rather than by feel: 18pt, or 14pt bold.
 * `scale.ts` caps weight at 600, and WCAG's "bold" is 700 — so on this app's
 * type scale only `hero` and `title` are ever large, and every other step has
 * to clear the full 4.5:1.
 */
function isLargeText(fontSize, fontWeight) {
    const w = typeof fontWeight === 'string' ? parseInt(fontWeight, 10) : fontWeight ?? 400;
    return fontSize >= 18 || (fontSize >= 14 && Number.isFinite(w) && w >= 700);
}
/** Does this ink clear AA on this ground, for text at this size? */
function meetsText(fg, bg, fontSize = 15, fontWeight) {
    const r = contrastRatio(fg, bg);
    return r != null && r >= (isLargeText(fontSize, fontWeight) ? exports.AA_LARGE : exports.AA_TEXT);
}
/** Does this colour clear AA as a MARK — a dot, a ring, a chart line? */
function meetsMark(fg, bg) {
    const r = contrastRatio(fg, bg);
    return r != null && r >= exports.AA_MARK;
}
/**
 * Black or white for text on `bg`, whichever actually reads better.
 *
 * The version this replaces picked by perceived brightness — `r*.299 + g*.587 +
 * b*.114 > 140` — which is not contrast and disagrees with contrast on about a
 * fifth of colours. On a bright green brand (#00ee00, an entirely ordinary
 * choice for a gym) it chose white at 1.59:1 while black was sitting there at
 * 11.77:1. That matters here because the brand colour is white-label: the owner
 * types a hex, and this function decides what the primary button on every
 * screen says it in.
 *
 * Measuring does not make every brand colour safe — roughly 4% of colours are
 * too mid-toned for either black or white to clear 4.5:1 — but it stops us
 * choosing the worse of the two.
 */
exports.INK_ON_LIGHT = '#111310';
exports.INK_ON_DARK = '#ffffff';
function readableInkOn(bg) {
    const onDark = contrastRatio(exports.INK_ON_DARK, bg);
    const onLight = contrastRatio(exports.INK_ON_LIGHT, bg);
    if (onDark == null || onLight == null)
        return exports.INK_ON_DARK;
    return onDark >= onLight ? exports.INK_ON_DARK : exports.INK_ON_LIGHT;
}
/* ── touch targets ────────────────────────────────────────────────────────── */
/**
 * 44pt — Apple's Human Interface minimum and, near enough, Android's 48dp.
 * The number matters more than usual here: this app is used one-handed, mid-set,
 * with a wet screen, by people who are sometimes holding onto something.
 */
exports.MIN_TARGET = 44;
/**
 * The hitSlop that brings a control of `size` up to 44pt on that axis.
 *
 * hitSlop is the cheap fix and the right one: a 38pt round icon button is a
 * deliberate visual size, and growing it to 44 would push every header apart.
 * Slop leaves the drawing alone and moves only the boundary the finger has to
 * find. Zero when the control is already big enough, so it can be applied
 * blindly.
 */
function hitSlopFor(size) {
    if (!Number.isFinite(size) || size >= exports.MIN_TARGET)
        return 0;
    return Math.ceil((exports.MIN_TARGET - size) / 2);
}
/** Is a control of these dimensions reachable without slop? */
function meetsTarget(width, height) {
    return width >= exports.MIN_TARGET && height >= exports.MIN_TARGET;
}
/* ── announcing state ─────────────────────────────────────────────────────── */
/**
 * What a control that is ON or OFF should be called out loud.
 *
 * A switch drawn as a coloured pill announces nothing about its position: the
 * colour IS the state, and colour is exactly what a screen reader does not
 * have. `accessibilityState` carries it properly; this is here so the two
 * hand-rolled toggles in the app and any future one agree on the wording.
 */
function switchLabel(label, on) {
    return `${label}, ${on ? 'on' : 'off'}`;
}
