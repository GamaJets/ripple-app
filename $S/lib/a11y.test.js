"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Accessibility arithmetic, and the ten palettes measured against it. Compile
// with tsc, run with node.
//
// The bug this guards is the one nobody can see in review: a colour that looks
// fine on the designer's screen and is 2.68:1 on a phone in the sun. Before
// this file existed, ink3 — the caption colour under practically every value in
// the app — failed AA on NINE of the ten palettes, crit failed even the 3:1 it
// needs as a MARK on four of them (while a comment in kit.tsx said it "clears
// everywhere"), and the white-label brand-ink function picked white over black
// on a bright green at 1.59:1 when 11.77:1 was available.
//
// None of that was a judgement call. All of it is arithmetic, and arithmetic is
// what a test is for.
const a11y_1 = require("./a11y");
const tokens_1 = require("../theme/tokens");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const atLeast = (a, min, msg) => ok(a != null && a >= min, `${msg} — got ${a == null ? 'unmeasurable' : a.toFixed(2)}, wanted at least ${min}`);
/* ── the arithmetic itself ─────────────────────────────────────────────── */
eq((0, a11y_1.contrastRatio)('#000000', '#ffffff'), 21, 'black on white is the maximum, 21:1');
eq((0, a11y_1.contrastRatio)('#ffffff', '#000000'), 21, 'contrast has no direction');
eq((0, a11y_1.contrastRatio)('#808080', '#808080'), 1, 'a colour on itself is 1:1');
eq((0, a11y_1.luminance)('#000000'), 0, 'black has no luminance');
eq((0, a11y_1.luminance)('#ffffff'), 1, 'white has all of it');
// The channel weights are not equal, and a checker that treats them as equal
// passes colours that are unreadable. Green carries most of the luminance.
ok((0, a11y_1.contrastRatio)('#00ff00', '#000000') > (0, a11y_1.contrastRatio)('#0000ff', '#000000'), 'green is far brighter than blue at the same value');
// Parsing refuses rather than guesses. `ring` is an rgba() string and sits in
// every palette; half-parsing it would hand back a confident wrong number.
eq((0, a11y_1.rgb)('rgba(255,255,255,0.09)'), null, 'an rgba string is not a hex');
eq((0, a11y_1.rgb)('#fff'), null, 'three-digit shorthand is not accepted');
eq((0, a11y_1.rgb)('#12345g'), null, 'a non-hex digit is not accepted');
eq((0, a11y_1.contrastRatio)('rgba(0,0,0,0.5)', '#ffffff'), null, 'an unmeasurable colour measures to nothing, not to a number');
eq((0, a11y_1.contrastRatio)('#ffffff', 'transparent'), null, 'a keyword colour measures to nothing');
// With and without the hash, and in either case.
eq((0, a11y_1.contrastRatio)('000000', '#FFFFFF'), 21, 'the hash is optional and hex is case-insensitive');
/* ── WCAG's definition of large text, not ours ─────────────────────────── */
ok((0, a11y_1.isLargeText)(18), '18pt is large');
ok((0, a11y_1.isLargeText)(44, '600'), 'the hero figure is large');
ok(!(0, a11y_1.isLargeText)(17), '17pt is not large, however heavy');
ok(!(0, a11y_1.isLargeText)(15, '600'), 'body at 600 is not large — WCAG bold is 700');
ok((0, a11y_1.isLargeText)(14, 700), '14pt at 700 is large');
ok(!(0, a11y_1.isLargeText)(13, '600'), 'the Cta label is not large text and needs the full 4.5:1');
// scale.ts caps weight at 600 by house rule, so on this type scale the only
// steps that can ever take the 3:1 allowance are hero (44) and title (26).
ok(!(0, a11y_1.isLargeText)(17, '600') && !(0, a11y_1.isLargeText)(15, '400') && !(0, a11y_1.isLargeText)(13, '400')
    && !(0, a11y_1.isLargeText)(12, '400') && !(0, a11y_1.isLargeText)(11, '500'), 'head, body, label, caption and micro all need 4.5:1 on this scale');
eq(a11y_1.AA_TEXT, 4.5, 'AA body text is 4.5:1');
eq(a11y_1.AA_LARGE, 3, 'AA large text is 3:1');
eq(a11y_1.AA_MARK, 3, 'AA non-text (1.4.11) is 3:1');
ok((0, a11y_1.meetsText)('#000000', '#ffffff'), 'black on white is readable');
ok(!(0, a11y_1.meetsText)('#777777', '#888888'), 'two greys a step apart are not');
ok((0, a11y_1.meetsMark)('#767676', '#ffffff'), '3:1 is enough for a mark');
/* ── the ten palettes ──────────────────────────────────────────────────── */
const GROUNDS = ['bg', 'surface', 'surface2', 'surface3'];
// The three inks are what this file measures as TEXT. The brand accent is NOT
// in the list, deliberately — see the note further down about why it is not
// held to 4.5:1 here.
//
// This used to read "the three inks and the brand accent are all used as TEXT:
// scale.ts reserves the accent for …", which was wrong three ways: the quoted
// sentence is in src/ui/kit.tsx ("Accent colour marks the live metric and the
// primary action, and nothing else"), src/theme/scale.ts does not contain the
// word "accent" at all, and the accent is excluded from INKS on the very next
// line. A reader would go to scale.ts for a rule that is not there.
const INKS = ['ink', 'ink2', 'ink3'];
// Status colours are MARKS by house rule — a dot beside ink-coloured text, a
// ring, a card's hairline — so 3:1 is the bar they must clear. See Flag() in
// kit.tsx. This file measures the palettes and says nothing about the screens;
// the screens are held by scripts/check-contrast.mjs, which fails the build on
// any `color:` naming a status token. The audit note that used to sit at the
// bottom of this file — a hand-written list of the screens that still drew a
// status colour as text — is gone because that list is now empty and the check
// is what keeps it so. A pointer to a note nobody can find reads as a record
// somebody kept, which is worse than no pointer at all.
const STATUS = ['good', 'warn', 'serious', 'crit'];
// Chart series. A line you must follow to read the chart is a graphical object
// under WCAG 1.4.11 and needs 3:1 against what it is drawn on.
const SERIES = ['s1', 's2', 's3', 's5', 's6'];
ok(tokens_1.PALETTES.length === 10, `there are ten palettes — found ${tokens_1.PALETTES.length}`);
for (const p of tokens_1.PALETTES) {
    const t = p.theme;
    for (const ink of INKS) {
        for (const g of GROUNDS) {
            atLeast((0, a11y_1.contrastRatio)(t[ink], t[g]), a11y_1.AA_TEXT, `${p.key}: ${ink} on ${g} is body text`);
        }
    }
    // The three inks have to stay three steps apart, or "quiet" and "loud" stop
    // meaning anything and the fix above would have flattened the design.
    const li = (0, a11y_1.luminance)(t.ink), l2 = (0, a11y_1.luminance)(t.ink2), l3 = (0, a11y_1.luminance)(t.ink3);
    ok(p.light ? li < l2 && l2 < l3 : li > l2 && l2 > l3, `${p.key}: ink, ink2 and ink3 are still three ordered steps`);
    for (const s of STATUS) {
        for (const g of GROUNDS) {
            atLeast((0, a11y_1.contrastRatio)(t[s], t[g]), a11y_1.AA_MARK, `${p.key}: ${s} on ${g} is a mark`);
        }
    }
    for (const s of SERIES) {
        for (const g of GROUNDS) {
            atLeast((0, a11y_1.contrastRatio)(t[s], t[g]), a11y_1.AA_MARK, `${p.key}: series ${s} on ${g} is a chart line`);
        }
    }
    // The primary button. Cta draws `ty.label` — 13px at 600 — in brandInk on
    // brand, which is not large text under any reading, so it needs 4.5:1.
    atLeast((0, a11y_1.contrastRatio)(t.brandInk, t.brand), a11y_1.AA_TEXT, `${p.key}: the Cta label on the brand colour`);
    // Every palette must be measurable in the first place. A typo'd hex reads as
    // null here rather than silently scoring 21:1 against everything.
    for (const k of [...INKS, ...STATUS, ...SERIES, 'brand', 'brandInk', 'grid', ...GROUNDS]) {
        ok((0, a11y_1.rgb)(t[k]) != null, `${p.key}: ${k} is a six-digit hex (${t[k]})`);
    }
}
/* ── the accent, and the one palette that cannot meet the bar ──────────── */
// The accent is a different case from the inks and is deliberately NOT asserted
// at 4.5 above: on a light palette the brand colour cannot be both the vivid
// identity the tenant chose and legible as 12px text. What IS asserted is that
// it works as a MARK — the progress ring, the meter fill, the WeekDots and the
// dot beside a Hero note are all drawn in it, and a ring you cannot see is not
// a ring.
//
// Cream & Coral fails that, at 2.21:1 against surface3. Fixing it by the method
// used everywhere else in tokens.ts walks the coral to #ff2e16, which is not
// coral any more — the palette is named after this colour. So it is recorded
// here rather than enforced: a real gap, owned, with the number attached.
//
// The list is asserted to be EXACTLY this one palette. A second palette
// drifting below 3:1 fails the build, and fixing Cream & Coral fails the build
// until the exception is deleted — which is the only way an exception list ever
// gets shorter.
const ACCENT_MARK_EXEMPT = new Set(['cream']);
const accentBelowMark = [];
for (const p of tokens_1.PALETTES) {
    let worst = Infinity;
    for (const g of GROUNDS) {
        const r = (0, a11y_1.contrastRatio)(p.theme.brand, p.theme[g]);
        if (r != null && r < worst)
            worst = r;
        if (!ACCENT_MARK_EXEMPT.has(p.key))
            atLeast(r, a11y_1.AA_MARK, `${p.key}: the accent on ${g} is a mark`);
    }
    if (worst < a11y_1.AA_MARK)
        accentBelowMark.push(p.key);
}
eq(accentBelowMark.join(','), [...ACCENT_MARK_EXEMPT].join(','), 'exactly one palette has an accent too pale to be a mark, and it is Cream & Coral');
/* ── white-label brand ink ─────────────────────────────────────────────── */
// The failure this replaced: perceived brightness said white, contrast said
// black, and the button label came out at 1.59:1.
eq((0, a11y_1.readableInkOn)('#00ee00'), a11y_1.INK_ON_LIGHT, 'bright green takes dark ink');
eq((0, a11y_1.readableInkOn)('#ffffff'), a11y_1.INK_ON_LIGHT, 'white takes dark ink');
eq((0, a11y_1.readableInkOn)('#000000'), a11y_1.INK_ON_DARK, 'black takes white ink');
eq((0, tokens_1.brandInkFor)('#00ee00'), a11y_1.INK_ON_LIGHT, 'brandInkFor agrees — it is the same function now');
// Whatever hex an owner types, the ink chosen is never the worse of the two.
// This is the whole contract, and it is checkable exhaustively over a grid.
let picked = 0, best = 0;
for (let r = 0; r < 256; r += 15)
    for (let g = 0; g < 256; g += 15)
        for (let b = 0; b < 256; b += 15) {
            const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
            const chosen = (0, a11y_1.contrastRatio)((0, tokens_1.brandInkFor)(hex), hex);
            const better = Math.max((0, a11y_1.contrastRatio)(a11y_1.INK_ON_DARK, hex), (0, a11y_1.contrastRatio)(a11y_1.INK_ON_LIGHT, hex));
            picked++;
            if (chosen >= better - 1e-9)
                best++;
        }
eq(best, picked, `brandInkFor picks the better of black and white for every brand colour (${best}/${picked})`);
// Unparseable input has to answer something, and white is what the old version
// answered. A tenant mid-edit with "#12" in the field must not crash a screen.
eq((0, tokens_1.brandInkFor)('#12'), a11y_1.INK_ON_DARK, 'a half-typed hex falls back to white');
eq((0, tokens_1.brandInkFor)(''), a11y_1.INK_ON_DARK, 'an empty brand colour falls back to white');
/* ── following the phone between light and dark ────────────────────────── */
// The follow reads `counterpart` once in each direction. A counterpart that
// names a palette which does not exist, or one in the SAME scheme, is a dead
// end: a member on a light phone would be left in a dark app with no way back
// except finding Appearance and picking a hue by hand. Neither failure is
// visible in review, and both are one line of data.
for (const p of tokens_1.PALETTES) {
    const c = tokens_1.PALETTES.find((x) => x.key === p.counterpart);
    ok(!!c, `${p.key}: its counterpart "${p.counterpart}" is a real palette`);
    if (c)
        ok(c.light !== p.light, `${p.key}: its counterpart is in the other scheme, not another ${p.light ? 'light' : 'dark'} one`);
}
// The resolution itself. A palette that already matches the phone is left
// alone — somebody who picked Mono Noir and set their phone to dark stays in
// Mono Noir rather than being sent on a round trip through Swiss Ivory.
for (const p of tokens_1.PALETTES) {
    eq((0, tokens_1.paletteForScheme)(p.key, p.light ? 'light' : 'dark'), p.key, `${p.key}: a phone already in its scheme changes nothing`);
    const flipped = (0, tokens_1.paletteForScheme)(p.key, p.light ? 'dark' : 'light');
    eq((0, tokens_1.metaByKey)(flipped).light, !p.light, `${p.key}: the other scheme resolves to a palette of that scheme`);
    // Not asserted: that flipping twice returns the same key. It does not, and
    // must not be expected to — three dark palettes map onto Clinical Light, so
    // the mapping cannot be one-to-one. What makes the round trip lossless is
    // that AppThemeProvider never rewrites the STORED key; it derives.
}
// The platform declining to answer is not an answer. 'unspecified' is narrowed
// to null in AppThemeProvider, and null must change nothing.
for (const p of tokens_1.PALETTES) {
    eq((0, tokens_1.paletteForScheme)(p.key, null), p.key, `${p.key}: an unanswered scheme changes nothing`);
    eq((0, tokens_1.paletteForScheme)(p.key, undefined), p.key, `${p.key}: nor does a missing one`);
}
/* ── higher contrast, measured like everything else ────────────────────── */
// The transform invents no colour: ink3 becomes ink2 and ink2 becomes ink,
// both of which the loop above has already measured at 4.5:1 on all four
// grounds of all ten palettes. So this CANNOT fail while that passes — which
// is the entire argument for doing it as a transform rather than as an
// eleventh hand-picked palette. Measured anyway, because "cannot fail" is a
// claim about today's implementation and this is a check on tomorrow's.
for (const p of tokens_1.PALETTES) {
    const hc = (0, tokens_1.highContrast)(p.theme);
    for (const ink of INKS) {
        for (const g of GROUNDS) {
            atLeast((0, a11y_1.contrastRatio)(hc[ink], hc[g]), a11y_1.AA_TEXT, `${p.key} higher contrast: ${ink} on ${g} is body text`);
        }
    }
    // It raises the quiet inks and never lowers them. A "higher contrast" option
    // that made any text quieter would be the worst possible version of this.
    for (const ink of INKS) {
        for (const g of GROUNDS) {
            const before = (0, a11y_1.contrastRatio)(p.theme[ink], p.theme[g]);
            const after = (0, a11y_1.contrastRatio)(hc[ink], hc[g]);
            ok(after >= before - 0.001, `${p.key} higher contrast: ${ink} on ${g} did not get quieter`);
        }
    }
    eq(hc.brand, p.theme.brand, `${p.key} higher contrast: the brand colour is untouched`);
    eq(hc.crit, p.theme.crit, `${p.key} higher contrast: the status marks are untouched`);
    // The grounds must not move either: every ratio above is measured against
    // them, and a transform that shifted a surface would invalidate its own test.
    for (const g of GROUNDS)
        eq(hc[g], p.theme[g], `${p.key} higher contrast: ${g} is untouched`);
}
/* ── touch targets ─────────────────────────────────────────────────────── */
eq(a11y_1.MIN_TARGET, 44, 'the minimum target is 44pt');
eq((0, a11y_1.hitSlopFor)(44), 0, 'a 44pt control needs no slop');
eq((0, a11y_1.hitSlopFor)(60), 0, 'nor does a bigger one');
eq((0, a11y_1.hitSlopFor)(38), 3, 'the round Ghost button, 38pt, needs 3pt a side');
eq((0, a11y_1.hitSlopFor)(34), 5, 'a 34pt tile needs 5pt a side');
eq((0, a11y_1.hitSlopFor)(28), 8, 'a 28pt toggle needs 8pt a side');
// Odd shortfalls round UP — 43 - 44 is one point short, and 0.5pt of slop is
// not a thing, so it takes a whole one on each side.
eq((0, a11y_1.hitSlopFor)(43), 1, 'an odd shortfall rounds up rather than down');
eq((0, a11y_1.hitSlopFor)(0), 22, 'a zero-sized control needs the full 22pt a side');
// Every slop it returns actually reaches 44, which is the only property that
// matters and the one an off-by-one would break silently.
for (let s = 0; s <= 44; s++)
    ok(s + 2 * (0, a11y_1.hitSlopFor)(s) >= a11y_1.MIN_TARGET, `${s}pt plus its slop reaches 44pt`);
eq((0, a11y_1.hitSlopFor)(Number.NaN), 0, 'an unmeasurable size asks for no slop rather than NaN');
ok((0, a11y_1.meetsTarget)(44, 44), '44 by 44 is reachable');
ok(!(0, a11y_1.meetsTarget)(48, 28), 'the hand-rolled toggle, 48 by 28, is not');
ok(!(0, a11y_1.meetsTarget)(38, 38), 'the round icon button is not, without slop');
/* ── announcing a switch ───────────────────────────────────────────────── */
// The pill toggles in Settings and Reminders carry their state in colour alone.
// Colour is exactly what a screen reader does not have.
eq((0, a11y_1.switchLabel)('Hydration nudges', true), 'Hydration nudges, on', 'an on switch says so');
eq((0, a11y_1.switchLabel)('Hydration nudges', false), 'Hydration nudges, off', 'an off switch says so');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`a11y: ok (${tokens_1.PALETTES.length} palettes × ${GROUNDS.length} grounds measured)`);
