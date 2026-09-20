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
import {
  AA_LARGE, AA_MARK, AA_TEXT, INK_ON_DARK, INK_ON_LIGHT, MIN_TARGET,
  contrastRatio, hitSlopFor, isLargeText, luminance, meetsMark, meetsTarget,
  meetsText, readableInkOn, rgb, switchLabel,
} from './a11y';
import { PALETTES, DATA_HUES, brandInkFor, highContrast, metaByKey, paletteForScheme, withAccent, type Theme } from '../theme/tokens';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const atLeast = (a: number | null, min: number, msg: string) =>
  ok(a != null && a >= min, `${msg} — got ${a == null ? 'unmeasurable' : a.toFixed(2)}, wanted at least ${min}`);

/* ── the arithmetic itself ─────────────────────────────────────────────── */

eq(contrastRatio('#000000', '#ffffff'), 21, 'black on white is the maximum, 21:1');
eq(contrastRatio('#ffffff', '#000000'), 21, 'contrast has no direction');
eq(contrastRatio('#808080', '#808080'), 1, 'a colour on itself is 1:1');
eq(luminance('#000000'), 0, 'black has no luminance');
eq(luminance('#ffffff'), 1, 'white has all of it');

// The channel weights are not equal, and a checker that treats them as equal
// passes colours that are unreadable. Green carries most of the luminance.
ok((contrastRatio('#00ff00', '#000000') as number) > (contrastRatio('#0000ff', '#000000') as number),
  'green is far brighter than blue at the same value');

// Parsing refuses rather than guesses. `ring` is an rgba() string and sits in
// every palette; half-parsing it would hand back a confident wrong number.
eq(rgb('rgba(255,255,255,0.09)'), null, 'an rgba string is not a hex');
eq(rgb('#fff'), null, 'three-digit shorthand is not accepted');
eq(rgb('#12345g'), null, 'a non-hex digit is not accepted');
eq(contrastRatio('rgba(0,0,0,0.5)', '#ffffff'), null, 'an unmeasurable colour measures to nothing, not to a number');
eq(contrastRatio('#ffffff', 'transparent'), null, 'a keyword colour measures to nothing');
// With and without the hash, and in either case.
eq(contrastRatio('000000', '#FFFFFF'), 21, 'the hash is optional and hex is case-insensitive');

/* ── WCAG's definition of large text, not ours ─────────────────────────── */

ok(isLargeText(18), '18pt is large');
ok(isLargeText(44, '600'), 'the hero figure is large');
ok(!isLargeText(17), '17pt is not large, however heavy');
ok(!isLargeText(15, '600'), 'body at 600 is not large — WCAG bold is 700');
ok(isLargeText(14, 700), '14pt at 700 is large');
// The Cta label was 13pt at 600 and is 18pt at 700 since the approved mockups'
// scale landed, which WCAG counts as large. The palette walk below STILL holds
// brandInk on brand to the full 4.5:1, deliberately: the same pairing is what a
// "selected" chip draws at 13pt, and a bar lowered for the button would be
// lowered for the chip with it.
ok(isLargeText(18, '700'), 'the Cta label is large text now — and is held to 4.5:1 anyway');
ok(!isLargeText(13, '600'), 'a 13pt chip in the same two colours is not');
// src/theme/scale.ts as it stands: Sora at 19 and up for titles and figures,
// Plus Jakarta Sans 700 for a row title and the current tab. Those take the
// 3:1 allowance by WCAG's arithmetic; nothing in the palette walk USES the
// allowance for an ink, so this records the scale rather than relaxing a bar.
ok(isLargeText(44, '700') && isLargeText(30, '700') && isLargeText(24, '700') && isLargeText(20, '700')
  && isLargeText(19, '600') && isLargeText(17, '700') && isLargeText(14, '700'),
  'hero, display, title, section, page, head and tab are large on this scale');
ok(!isLargeText(16, '400') && !isLargeText(15, '400') && !isLargeText(14, '400')
  && !isLargeText(13, '600') && !isLargeText(12, '700'),
  'body, label, caption, micro and eyebrow all need 4.5:1 on this scale');

eq(AA_TEXT, 4.5, 'AA body text is 4.5:1');
eq(AA_LARGE, 3, 'AA large text is 3:1');
eq(AA_MARK, 3, 'AA non-text (1.4.11) is 3:1');
ok(meetsText('#000000', '#ffffff'), 'black on white is readable');
ok(!meetsText('#777777', '#888888'), 'two greys a step apart are not');
ok(meetsMark('#767676', '#ffffff'), '3:1 is enough for a mark');

/* ── the ten palettes ──────────────────────────────────────────────────── */

const GROUNDS = ['bg', 'surface', 'surface2', 'surface3'] as const;
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
const INKS = ['ink', 'ink2', 'ink3'] as const;
// Status colours are MARKS by house rule — a dot beside ink-coloured text, a
// ring, a card's hairline — so 3:1 is the bar they must clear. See Flag() in
// kit.tsx. This file measures the palettes and says nothing about the screens;
// the screens are held by scripts/check-contrast.mjs, which fails the build on
// any `color:` naming a status token. The audit note that used to sit at the
// bottom of this file — a hand-written list of the screens that still drew a
// status colour as text — is gone because that list is now empty and the check
// is what keeps it so. A pointer to a note nobody can find reads as a record
// somebody kept, which is worse than no pointer at all.
const STATUS = ['good', 'warn', 'serious', 'crit'] as const;
// Chart series. A line you must follow to read the chart is a graphical object
// under WCAG 1.4.11 and needs 3:1 against what it is drawn on.
const SERIES = ['s1', 's2', 's3', 's5', 's6'] as const;

// Twelve: the ten selectable ones plus the approved board's pair, Repple and
// Repple Dark, which became the default on 19 Sep 2026.
ok(PALETTES.length === 12, `there are twelve palettes — found ${PALETTES.length}`);

for (const p of PALETTES) {
  const t: Theme = p.theme;

  for (const ink of INKS) {
    for (const g of GROUNDS) {
      atLeast(contrastRatio(t[ink], t[g]), AA_TEXT, `${p.key}: ${ink} on ${g} is body text`);
    }
  }

  // The three inks have to stay three steps apart, or "quiet" and "loud" stop
  // meaning anything and the fix above would have flattened the design.
  const li = luminance(t.ink) as number, l2 = luminance(t.ink2) as number, l3 = luminance(t.ink3) as number;
  ok(p.light ? li < l2 && l2 < l3 : li > l2 && l2 > l3,
    `${p.key}: ink, ink2 and ink3 are still three ordered steps`);

  for (const s of STATUS) {
    for (const g of GROUNDS) {
      atLeast(contrastRatio(t[s], t[g]), AA_MARK, `${p.key}: ${s} on ${g} is a mark`);
    }
  }

  for (const s of SERIES) {
    for (const g of GROUNDS) {
      atLeast(contrastRatio(t[s], t[g]), AA_MARK, `${p.key}: series ${s} on ${g} is a chart line`);
    }
  }

  // The primary button. Cta draws `ty.label` — 13px at 600 — in brandInk on
  // brand, which is not large text under any reading, so it needs 4.5:1.
  atLeast(contrastRatio(t.brandInk, t.brand), AA_TEXT, `${p.key}: the Cta label on the brand colour`);

  // ── the night hero card ──────────────────────────────────────────────
  // Three inks on two grounds, all of them text: the headline, the meta line
  // and the tracked eyebrow on `night`; a figure and its unit on a `night2`
  // tile. Not large-text allowance — the eyebrow is 12pt.
  for (const ink of ['nightInk', 'nightInk2', 'nightInk3'] as const) {
    for (const g of ['night', 'night2'] as const) {
      atLeast(contrastRatio(t[ink], t[g]), AA_TEXT, `${p.key}: ${ink} on ${g} is text on the hero`);
    }
  }
  // A hero has to read as a hero: told from the ground it sits on. 1.15:1 is
  // not a WCAG number — a card needs no contrast to be a card — it is the
  // floor under "one step lighter than the ground" on a dark palette, where
  // the hero is otherwise one more dark rectangle.
  atLeast(contrastRatio(t.night, t.bg), 1.15, `${p.key}: the hero card is told from the ground`);
  // The accent as it is drawn ON night: a button's fill, a ring's arc, the
  // current tab's icon — marks — with the button's label written on it.
  atLeast(contrastRatio(t.brandBright, t.night), AA_MARK, `${p.key}: brandBright on night is a mark`);
  atLeast(contrastRatio(t.brandDeep, t.brandBright), AA_TEXT, `${p.key}: the hero button's label on brandBright`);
  // The accent as TEXT — a section's "See all", a chip's label on the plate.
  for (const g of ['bg', 'surface', 'brandSoft'] as const) {
    atLeast(contrastRatio(t.brandText, t[g]), AA_TEXT, `${p.key}: brandText on ${g} is a link`);
  }

  // ── the data palette ─────────────────────────────────────────────────
  // Seven hues, three values each. The mark is a ring's arc or a bar on any of
  // the four grounds, or an icon on its own plate: 3:1. The ink is a chip's
  // label on the plate or a figure on a card: 4.5:1. The plate is measured by
  // being a ground in both.
  for (const h of DATA_HUES) {
    const soft = t.data[`${h}Soft`];
    for (const g of [...GROUNDS.map((k) => t[k]), soft]) {
      atLeast(contrastRatio(t.data[h], g), AA_MARK, `${p.key}: data ${h} on ${g} is a mark`);
      atLeast(contrastRatio(t.data[`${h}Ink`], g), AA_TEXT, `${p.key}: data ${h}Ink on ${g} is text`);
    }
    for (const k of [h, `${h}Soft`, `${h}Ink`] as const) {
      ok(rgb(t.data[k]) != null, `${p.key}: data ${k} is a six-digit hex (${t.data[k]})`);
    }
  }

  // Every palette must be measurable in the first place. A typo'd hex reads as
  // null here rather than silently scoring 21:1 against everything.
  for (const k of [...INKS, ...STATUS, ...SERIES, 'brand', 'brandInk', 'grid', ...GROUNDS,
    'night', 'night2', 'nightInk', 'nightInk2', 'nightInk3', 'brandBright', 'brandDeep', 'brandSoft', 'brandText'] as const) {
    ok(rgb(t[k]) != null, `${p.key}: ${k} is a six-digit hex (${t[k]})`);
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
const accentBelowMark: string[] = [];
for (const p of PALETTES) {
  let worst = Infinity;
  for (const g of GROUNDS) {
    const r = contrastRatio(p.theme.brand, p.theme[g]);
    if (r != null && r < worst) worst = r;
    if (!ACCENT_MARK_EXEMPT.has(p.key)) atLeast(r, AA_MARK, `${p.key}: the accent on ${g} is a mark`);
  }
  if (worst < AA_MARK) accentBelowMark.push(p.key);
}
eq(accentBelowMark.join(','), [...ACCENT_MARK_EXEMPT].join(','),
  'exactly one palette has an accent too pale to be a mark, and it is Cream & Coral');

/* ── white-label brand ink ─────────────────────────────────────────────── */

// The failure this replaced: perceived brightness said white, contrast said
// black, and the button label came out at 1.59:1.
eq(readableInkOn('#00ee00'), INK_ON_LIGHT, 'bright green takes dark ink');
eq(readableInkOn('#ffffff'), INK_ON_LIGHT, 'white takes dark ink');
eq(readableInkOn('#000000'), INK_ON_DARK, 'black takes white ink');
eq(brandInkFor('#00ee00'), INK_ON_LIGHT, 'brandInkFor agrees — it is the same function now');

// Whatever hex an owner types, the ink chosen is never the worse of the two.
// This is the whole contract, and it is checkable exhaustively over a grid.
let picked = 0, best = 0;
for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const chosen = contrastRatio(brandInkFor(hex), hex) as number;
  const better = Math.max(contrastRatio(INK_ON_DARK, hex) as number, contrastRatio(INK_ON_LIGHT, hex) as number);
  picked++;
  if (chosen >= better - 1e-9) best++;
}
eq(best, picked, `brandInkFor picks the better of black and white for every brand colour (${best}/${picked})`);

// Unparseable input has to answer something, and white is what the old version
// answered. A tenant mid-edit with "#12" in the field must not crash a screen.
eq(brandInkFor('#12'), INK_ON_DARK, 'a half-typed hex falls back to white');
eq(brandInkFor(''), INK_ON_DARK, 'an empty brand colour falls back to white');

/* ── a gym's colour, on everything the accent touches ──────────────────── */

// `withAccent` is what the app draws under a white-label colour. The button's
// label on the accent is `brandInkFor`, walked above. These are the three
// NEW places the accent goes since the approved mockups landed, and each has
// a fallback that must hold for ANY hex an owner types — so they are walked
// over the same grid, on every palette, rather than spot-checked:
//
//   on the night hero   the accent if it is a mark there, else the night ink
//   as text             the accent if it is readable, else ink
//   its plate           always the accent at 14% over the card
//
// and the two things a gym does not get to move are asserted unmoved.
let accents = 0;
for (const p of PALETTES) {
  for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) {
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const w = withAccent(p.theme, hex);
    accents++;
    atLeast(contrastRatio(w.brandBright, w.night), AA_MARK, `${p.key} under ${hex}: the hero button is visible on night`);
    for (const ground of ['bg', 'surface', 'brandSoft'] as const) {
      atLeast(contrastRatio(w.brandText, w[ground]), AA_TEXT, `${p.key} under ${hex}: brandText on ${ground} is readable`);
    }
    // Where the accent could not be the hero's button, the fallback pair is
    // the night ink on night — already measured above, and never the accent's
    // own ink, which was chosen for a different fill.
    if (w.brandBright !== hex) {
      eq(w.brandBright, p.theme.nightInk, `${p.key} under ${hex}: an accent that vanishes on night gives way to the night ink`);
      eq(w.brandDeep, p.theme.night, `${p.key} under ${hex}: and the label on it is the night itself`);
    } else {
      eq(w.brandDeep, brandInkFor(hex), `${p.key} under ${hex}: the hero button's label is the measured ink`);
    }
    ok(w.data === p.theme.data, `${p.key} under ${hex}: the data palette is meaning, not brand, and does not move`);
    eq(w.night, p.theme.night, `${p.key} under ${hex}: nor does the night ground`);
  }
}
ok(accents === PALETTES.length * 216, `every palette was walked under 216 accents (${accents})`);
// A half-typed hex must not crash a screen here either, and must not produce
// an unmeasurable token: everything falls back to a colour that was passing.
{
  const w = withAccent(PALETTES[0].theme, '#12');
  eq(w.brandText, PALETTES[0].theme.ink, 'a half-typed accent is not text; ink is');
  eq(w.brandBright, PALETTES[0].theme.nightInk, 'nor a hero button; the night ink is');
  ok(rgb(w.brandSoft) != null, 'and its plate is still a colour');
}


/* ── following the phone between light and dark ────────────────────────── */

// The follow reads `counterpart` once in each direction. A counterpart that
// names a palette which does not exist, or one in the SAME scheme, is a dead
// end: a member on a light phone would be left in a dark app with no way back
// except finding Appearance and picking a hue by hand. Neither failure is
// visible in review, and both are one line of data.
for (const p of PALETTES) {
  const c = PALETTES.find((x) => x.key === p.counterpart);
  ok(!!c, `${p.key}: its counterpart "${p.counterpart}" is a real palette`);
  if (c) ok(c.light !== p.light, `${p.key}: its counterpart is in the other scheme, not another ${p.light ? 'light' : 'dark'} one`);
}

// The resolution itself. A palette that already matches the phone is left
// alone — somebody who picked Mono Noir and set their phone to dark stays in
// Mono Noir rather than being sent on a round trip through Swiss Ivory.
for (const p of PALETTES) {
  eq(paletteForScheme(p.key, p.light ? 'light' : 'dark'), p.key, `${p.key}: a phone already in its scheme changes nothing`);
  const flipped = paletteForScheme(p.key, p.light ? 'dark' : 'light');
  eq(metaByKey(flipped).light, !p.light, `${p.key}: the other scheme resolves to a palette of that scheme`);
  // Not asserted: that flipping twice returns the same key. It does not, and
  // must not be expected to — three dark palettes map onto Clinical Light, so
  // the mapping cannot be one-to-one. What makes the round trip lossless is
  // that AppThemeProvider never rewrites the STORED key; it derives.
}

// The platform declining to answer is not an answer. 'unspecified' is narrowed
// to null in AppThemeProvider, and null must change nothing.
for (const p of PALETTES) {
  eq(paletteForScheme(p.key, null), p.key, `${p.key}: an unanswered scheme changes nothing`);
  eq(paletteForScheme(p.key, undefined), p.key, `${p.key}: nor does a missing one`);
}

/* ── higher contrast, measured like everything else ────────────────────── */

// The transform invents no colour: ink3 becomes ink2 and ink2 becomes ink,
// both of which the loop above has already measured at 4.5:1 on all four
// grounds of all ten palettes. So this CANNOT fail while that passes — which
// is the entire argument for doing it as a transform rather than as an
// eleventh hand-picked palette. Measured anyway, because "cannot fail" is a
// claim about today's implementation and this is a check on tomorrow's.
for (const p of PALETTES) {
  const hc = highContrast(p.theme);
  for (const ink of INKS) {
    for (const g of GROUNDS) {
      atLeast(contrastRatio(hc[ink], hc[g]), AA_TEXT, `${p.key} higher contrast: ${ink} on ${g} is body text`);
    }
  }
  // It raises the quiet inks and never lowers them. A "higher contrast" option
  // that made any text quieter would be the worst possible version of this.
  for (const ink of INKS) {
    for (const g of GROUNDS) {
      const before = contrastRatio(p.theme[ink], p.theme[g]) as number;
      const after = contrastRatio(hc[ink], hc[g]) as number;
      ok(after >= before - 0.001, `${p.key} higher contrast: ${ink} on ${g} did not get quieter`);
    }
  }
  eq(hc.brand, p.theme.brand, `${p.key} higher contrast: the brand colour is untouched`);
  eq(hc.crit, p.theme.crit, `${p.key} higher contrast: the status marks are untouched`);
  // The grounds must not move either: every ratio above is measured against
  // them, and a transform that shifted a surface would invalidate its own test.
  for (const g of GROUNDS) eq(hc[g], p.theme[g], `${p.key} higher contrast: ${g} is untouched`);
}

/* ── touch targets ─────────────────────────────────────────────────────── */

eq(MIN_TARGET, 44, 'the minimum target is 44pt');
eq(hitSlopFor(44), 0, 'a 44pt control needs no slop');
eq(hitSlopFor(60), 0, 'nor does a bigger one');
eq(hitSlopFor(38), 3, 'the round Ghost button, 38pt, needs 3pt a side');
eq(hitSlopFor(34), 5, 'a 34pt tile needs 5pt a side');
eq(hitSlopFor(28), 8, 'a 28pt toggle needs 8pt a side');
// Odd shortfalls round UP — 43 - 44 is one point short, and 0.5pt of slop is
// not a thing, so it takes a whole one on each side.
eq(hitSlopFor(43), 1, 'an odd shortfall rounds up rather than down');
eq(hitSlopFor(0), 22, 'a zero-sized control needs the full 22pt a side');
// Every slop it returns actually reaches 44, which is the only property that
// matters and the one an off-by-one would break silently.
for (let s = 0; s <= 44; s++) ok(s + 2 * hitSlopFor(s) >= MIN_TARGET, `${s}pt plus its slop reaches 44pt`);
eq(hitSlopFor(Number.NaN), 0, 'an unmeasurable size asks for no slop rather than NaN');

ok(meetsTarget(44, 44), '44 by 44 is reachable');
ok(!meetsTarget(48, 28), 'the hand-rolled toggle, 48 by 28, is not');
ok(!meetsTarget(38, 38), 'the round icon button is not, without slop');

/* ── announcing a switch ───────────────────────────────────────────────── */

// The pill toggles in Settings and Reminders carry their state in colour alone.
// Colour is exactly what a screen reader does not have.
eq(switchLabel('Hydration nudges', true), 'Hydration nudges, on', 'an on switch says so');
eq(switchLabel('Hydration nudges', false), 'Hydration nudges, off', 'an off switch says so');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`a11y: ok (${PALETTES.length} palettes × ${GROUNDS.length} grounds measured)`);
