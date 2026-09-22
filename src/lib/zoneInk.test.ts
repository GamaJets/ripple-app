// The heart-rate zone numeral, measured against the tile it is drawn on.
//
// ── the defect this exists for ────────────────────────────────────────────
//
// `src/ui/ZoneBoard.tsx` states its own rule at the top of the file: the five
// zone hues are too close together to carry meaning — "zone 3 green and zone 4
// orange are only ΔE 6.2 apart under deuteranopia" — so "every row leads with
// its numeral and its name; the coloured bar is confirmation, not information."
//
// The numeral was then drawn in a hardcoded '#FFFFFF' on all five hues. Measured
// with src/lib/a11y.ts, against the colours in src/lib/hr.ts:
//
//     zone 1  Very light  #64748B    white 4.76:1     black 3.92:1
//     zone 2  Light       #3B82F6    white 3.68:1     black 5.08:1
//     zone 3  Base        #22C55E    white 2.28:1     black 8.20:1
//     zone 4  Push        #F97316    white 2.80:1     black 6.66:1
//     zone 5  All out     #DC2626    white 4.83:1     black 3.87:1
//
// Zones 3 and 4 are below even the 3:1 that WCAG 1.4.11 asks of a MARK, let
// alone the 4.5:1 this numeral needs at 12pt — and they are the two zones a
// session is actually aimed at, on a tile somebody glances at mid-effort with a
// wet screen. `readableInkOn` picks by measurement rather than by feel and takes
// every one of the five to 4.76:1 or better.
//
// ── what this test is for ─────────────────────────────────────────────────
//
// Not to re-check the fix — to stop the next zone colour. These five hues are
// ordinary product decisions that somebody will retune, and nothing about
// picking a nicer orange tells you that the numeral on it has gone quiet. This
// walks the palette that actually ships and does the arithmetic, so `npm test`
// answers instead of a screenshot.
import { AA_TEXT, AA_MARK, contrastRatio, readableInkOn, INK_ON_DARK, INK_ON_LIGHT } from './a11y';
import { ZONES, zoneColor, type ZoneNo } from './hr';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const atLeast = (a: number | null, min: number, msg: string) =>
  ok(a != null && a >= min, `${msg} — got ${a == null ? 'unmeasurable' : a.toFixed(2)}, wanted at least ${min}`);

// Start failed and reach success, so a throw or a hang cannot pass silently.
process.exitCode = 1;

/* ── every zone colour is a colour we can actually measure ──────────────── */

// `contrastRatio` returns null rather than a confident wrong number for
// anything that is not a six-digit hex — an rgba(), a shorthand, a keyword. A
// zone colour that cannot be measured is a zone whose numeral nobody checked,
// so it fails here rather than passing by being unreadable to the checker.
for (const z of ZONES) {
  ok(contrastRatio(INK_ON_DARK, z.color) != null,
    `zone ${z.no} (${z.name}) has a measurable colour — '${z.color}' is not a six-digit hex`);
}

/* ── the numeral, at the size it is actually drawn ──────────────────────── */

// Two numerals, and the smaller one sets the bar. ZoneNow draws it at 22 or
// 28pt, which is WCAG "large" and would only need 3:1. The board draws it five
// times at `ty.caption` — 12pt, weight 600 — and WCAG's "large" needs 14pt at
// 700, so this one takes the full 4.5:1. Asserting the stricter number for both
// is not gold-plating: it is the number the board already meets.
for (const z of ZONES) {
  const ink = readableInkOn(z.color);
  atLeast(contrastRatio(ink, z.color), AA_TEXT,
    `zone ${z.no} (${z.name}, ${z.color}): the numeral on the tile`);
}

/* ── and it is not white, on the two zones the sessions aim at ──────────── */

// The regression stated as the thing that was wrong, rather than as a ratio.
// If somebody reintroduces a flat white numeral, or retunes these hues so that
// white becomes the measured pick again while sitting below AA, the loop above
// catches the second and this catches the first.
const white = (no: ZoneNo) => contrastRatio(INK_ON_DARK, zoneColor(no));
ok((white(3) as number) < AA_MARK, 'white on zone 3 really is below even the 3:1 a mark needs');
ok((white(4) as number) < AA_MARK, 'white on zone 4 really is below even the 3:1 a mark needs');
eq(readableInkOn(zoneColor(3)), INK_ON_LIGHT, 'zone 3 takes the dark ink');
eq(readableInkOn(zoneColor(4)), INK_ON_LIGHT, 'zone 4 takes the dark ink');
// And the two that were right stay right — a fix that flipped all five would
// have made zones 1 and 5 worse to make 3 and 4 better.
eq(readableInkOn(zoneColor(1)), INK_ON_DARK, 'zone 1 keeps white, which is what measurement already chose');
eq(readableInkOn(zoneColor(5)), INK_ON_DARK, 'zone 5 keeps white');

/* ── the bar and the dot are marks, and 3:1 is all they promise ─────────── */

// Drawn on `surface3` in every palette, per ZoneBoard. Not asserted against
// the palettes here — src/lib/a11y.test.ts owns ink-on-ground across all ten —
// but a zone colour has to clear the mark threshold against BOTH ends of the
// range or the proportional bar disappears on one of them.
for (const z of ZONES) {
  const onBlack = contrastRatio(z.color, '#000000');
  const onWhite = contrastRatio(z.color, '#ffffff');
  ok(onBlack != null && onWhite != null && Math.max(onBlack, onWhite) >= AA_MARK,
    `zone ${z.no} (${z.name}) is visible as a bar against at least one extreme ground`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
process.exitCode = 0;
console.log(`zoneInk: ok (${ZONES.length} zones measured)`);
