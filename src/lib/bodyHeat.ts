// How much of a muscle is lit, what colour that is, and what it says out loud.
//
// The picture side of the muscle heatmap. `src/lib/muscleMap.ts` answers "which
// overlay does this trained muscle reach"; this file answers "and how dark do I
// draw it, on this palette, and what does a screen reader hear". It is separated
// from src/ui/MuscleBody.tsx for the ordinary reason — a component cannot be
// asserted and this can — and everything here is a pure function of its inputs.
//
// ── why the intensity is drawn in BANDS and not as a gradient ─────────────
//
// The obvious rendering of a 0..1 intensity is a continuous ramp: interpolate a
// colour, set it, done. It is also unreadable and unsayable. Nobody can name the
// difference between 0.61 and 0.68 of a colour, a screen reader cannot read a
// gradient at all, and the house rule in src/lib/hr.ts forbids exactly this —
// "every zone mark carries its NUMBER and its NAME, and colour merely confirms
// what the text already said."
//
// So the ramp is four numbered, named bands, built the same way the five
// heart-rate zones are, for the same reason and with the same admission: the
// bands next to each other are NOT reliably distinguishable by colour. The
// measured neighbour contrasts are 1.24–1.38:1 (see RAMP_DARK below), well
// inside the range where two adjacent oranges read as one orange in sunlight, on
// a smeared screen, or with any red-green deficiency. That is not a palette that
// can be fixed by picking better hex codes — a four-step monotone ramp inside
// the lightness range a single ground allows has nowhere else to go. It is why
// the band NUMBER and NAME go in the accessibility label and in the legend, and
// why a screen that draws this body is expected to draw the ranking list beside
// it. The colour is confirmation. The list is the information.
//
// ── why there are two ramps and not one ───────────────────────────────────
//
// This was measured rather than assumed, and the measurement settles it.
//
// A band has to clear 3:1 (WCAG 1.4.11, a graphical object) against the unlit
// body it sits on. The unlit body has to be visible against the card. Across the
// ten palettes in src/theme/tokens.ts the card ranges from #000000 to #ffffff,
// so the unlit body ground ranges with it — computed at L=0.075 on the lightest
// dark palette and L=0.514 on the darkest light one. A band clearing 3:1 above
// the first needs lightness ≥ 0.325; a band clearing 3:1 below the second needs
// lightness ≤ 0.138. Those two windows do not overlap. One fixed ramp CANNOT
// clear 3:1 on both a dark and a light palette — not with better colours, not
// with more of them.
//
// That is the same wall src/theme/tokens.ts hit when its status colours sat
// byte-identical in `darkSem` and `lightSem` and warn came out at 1.68:1 on
// white. The answer here is the answer there: two sets, one per scheme, hue held
// and lightness walked until the worst ground of that scheme clears the bar.
// Both ramps land at 3.13:1 worst case, asserted over all ten palettes and all
// four of each palette's grounds in bodyHeat.test.ts.
//
// What is NOT theme-derived is the ramp's MEANING. Band 3 is the same orange on
// Mono Noir as on Swiss Ivory, because a member who changes palette has not
// changed their training and must not see it recoloured — which is why the five
// heart-rate zones are fixed too.
import { luminance } from './a11y';

/* ── the bands ────────────────────────────────────────────────────────────── */

export type BandNo = 1 | 2 | 3 | 4;

export interface Band {
  no: BandNo;
  /** Said, not shown alone. "Moderate", never a swatch on its own. */
  name: string;
  color: string;
  /** Lower bound of the intensity that reaches this band (exclusive). */
  from: number;
  /** Upper bound (inclusive). Band 4 takes everything above its floor. */
  to: number;
}

const NAMES: Record<BandNo, string> = { 1: 'Light', 2: 'Moderate', 3: 'Heavy', 4: 'Very heavy' };
const CUTS: Array<[number, number]> = [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1]];

const band = (no: BandNo, color: string): Band =>
  ({ no, name: NAMES[no], color, from: CUTS[no - 1][0], to: CUTS[no - 1][1] });

/**
 * The ramp for a DARK palette: amber up to a pale gold, brightening with load.
 *
 * Lightness walked against the worst dark ground (L = 0.075, Electric Violet's
 * surface3 under the body tint) until every band cleared 3:1. Worst measured
 * band-vs-ground 3.14:1; neighbour contrasts 1.33, 1.28, 1.24:1, which the
 * header is honest about.
 */
export const RAMP_DARK: readonly Band[] = [
  band(1, '#f87b28'), band(2, '#fba33d'), band(3, '#fbc65e'), band(4, '#fbe397'),
];

/**
 * The ramp for a LIGHT palette: the same fire, deepening instead of brightening.
 *
 * It runs the other way because it has to. On a white card the unlit body is a
 * light grey (L = 0.514 at worst, Swiss Ivory over its own surface3) and the
 * only room left for a band is BELOW it. Walked to a worst band-vs-ground of
 * 3.13:1; neighbours 1.35, 1.36, 1.38:1.
 */
export const RAMP_LIGHT: readonly Band[] = [
  band(1, '#ad4407'), band(2, '#913209'), band(3, '#73220a'), band(4, '#4d1409'),
];

/**
 * Which ramp a background wants.
 *
 * Measured off the background rather than read off a flag because `Theme` in
 * src/theme/tokens.ts carries no light/dark bit — `PaletteMeta.light` does, and
 * a component holding a `Theme` from `useTheme()` cannot see it. The threshold
 * is 0.5 relative luminance; the ten palettes sit at 0.000–0.028 and
 * 0.775–1.000, so nothing in this app is anywhere near the edge.
 */
export function rampFor(bg: string): readonly Band[] {
  const l = luminance(bg);
  return l != null && l > 0.5 ? RAMP_LIGHT : RAMP_DARK;
}

/**
 * The band an intensity falls in, or null for a muscle that was not trained.
 *
 * Null and band 1 are different pictures and the caller must keep them apart: a
 * muscle at 0 is not drawn at all, so the body shows through, and a muscle at
 * 0.01 is drawn in band 1. Anything above 1 is clamped rather than rejected —
 * an aggregation that normalises to a period's own maximum can hand back 1.0000002.
 */
export function bandOf(intensity: number, ramp: readonly Band[]): Band | null {
  if (!Number.isFinite(intensity) || intensity <= 0) return null;
  const v = Math.min(1, intensity);
  for (const b of ramp) if (v <= b.to) return b;
  return ramp[ramp.length - 1];
}

/* ── the unlit body ───────────────────────────────────────────────────────── */

/**
 * How much of `ink3` the unlit body is made of. The rest is the card behind it.
 *
 * 0.30 is not a taste. It is the largest mix that still leaves both ramps a
 * window: raising it to 0.35 pushes the dark band floor to L 0.355 and the light
 * ceiling down to L 0.126, and at 0.40 the light ramp has to fit four steps into
 * L ≤ 0.115, which is four near-blacks. Lowering it below 0.25 fades the body
 * under 1.35:1 against its own card, which is a body you cannot find.
 */
export const GROUND_MIX = 0.3;

const hx = (h: string): [number, number, number] | null => {
  const s = String(h ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
};

/**
 * The colour the unlit body is drawn in: `ink3` mixed 30% over the card.
 *
 * Composited HERE, into an opaque colour, rather than drawn as `ink3` at 0.3
 * opacity — even though on screen the two are the same pixel. The difference is
 * that this one is a value the test can measure. Every contrast figure in this
 * file's header is a ratio against what this returns, and a claim about an alpha
 * blend that only exists inside the compositor is a claim nothing can check.
 *
 * Falls back to the card itself if either colour is not a plain 6-digit hex —
 * a white-label tenant's brand colour reaches `Theme` from the database, and an
 * unparseable one should cost a member the tint, not the whole diagram.
 */
export function bodyGround(ink3: string, card: string): string {
  const a = hx(ink3); const b = hx(card);
  if (!a || !b) return card;
  const mix = a.map((v, i) => Math.round(GROUND_MIX * v + (1 - GROUND_MIX) * b[i]));
  return `#${mix.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/* ── which overlays actually get drawn ────────────────────────────────────── */

export interface LitLayer {
  layer: string;
  band: Band;
}

/**
 * The layers to draw, in paint order, from an intensity map and a side's index.
 *
 * Three things happen here and each of them is a defect somebody would otherwise
 * hit on a device:
 *
 *  · A layer at zero is DROPPED, not drawn transparent. This is the performance
 *    decision and it is measured against the asset set rather than guessed: a
 *    side carries 36 or 38 overlay files, so drawing them all is 37 or 39
 *    `<Image>` elements stacked with `position: absolute`, every one of which is
 *    a decode, an upload to the GPU and a composited layer even at opacity 0 —
 *    React Native does not skip a zero-opacity view, it composites it. The
 *    realistic case is far smaller: `drawnIntensity` over one week of a normal
 *    programme lights on the order of 6–12 layer NAMES, which is 12–24 files
 *    once both halves of the body are counted, so dropping the zeroes is
 *    typically a two-thirds cut and never a cost. The cap on the bad case is the
 *    manifest's own size, which is why nothing here needs a limit of its own.
 *
 *  · The COLDEST is painted first. Several overlays genuinely overlap — the
 *    front carries both `gracilis` and `gracilis_gastrocnemius`, and the
 *    adductor group runs under the quadriceps — and whichever is drawn last
 *    wins those pixels. Painting in ascending band order means an overlap
 *    resolves to the HOTTER of the two, so a hard-trained muscle is never hidden
 *    under a lightly-trained one. The reverse order loses the exact fact the
 *    picture exists to show.
 *
 *  · A layer this side cannot draw is not silently dropped — see `notOnThisSide`.
 */
export function litLayers(
  intensity: Readonly<Record<string, number>>,
  sideLayers: readonly string[],
  ramp: readonly Band[],
): LitLayer[] {
  const has = new Set(sideLayers);
  const out: LitLayer[] = [];
  for (const [layer, value] of Object.entries(intensity ?? {})) {
    if (!has.has(layer)) continue;
    const b = bandOf(value, ramp);
    if (b) out.push({ layer, band: b });
  }
  // Ascending band, then by name so the order is stable across renders and the
  // test can state it. A stack whose order depends on object-key order is a
  // stack that reorders when the aggregation changes shape.
  return out.sort((x, y) => x.band.no - y.band.no || x.layer.localeCompare(y.layer));
}

/**
 * Layers the caller asked to light that this SIDE has no artwork for.
 *
 * The front and the back are two views of one body and neither draws all of it:
 * `soleus` and `erector_spinae` exist only on the back, `abdominals` and
 * `pectoralis_major` only on the front. A member looking at the front who
 * trained calves would otherwise see an unlit body and conclude the app lost the
 * session — the same wrong conclusion src/lib/muscleMap.ts exists to prevent one
 * level up, where a trained NAME reaches no layer at all.
 *
 * So this is reported rather than swallowed, and MuscleBody says how many there
 * are and that the other view has them.
 */
export function notOnThisSide(
  intensity: Readonly<Record<string, number>>,
  sideLayers: readonly string[],
): string[] {
  const has = new Set(sideLayers);
  const out: string[] = [];
  for (const [layer, value] of Object.entries(intensity ?? {})) {
    if (Number.isFinite(value) && value > 0 && !has.has(layer)) out.push(layer);
  }
  return out.sort();
}

/* ── what it says ─────────────────────────────────────────────────────────── */

/**
 * A layer name as a person would say it: `biceps_femoris` → "biceps femoris".
 *
 * Underscores only. The anatomical names are not translated and not prettified
 * beyond this, because inventing a friendlier word for `infraspinatus_teres_minor`
 * would be inventing a claim about which muscle it is.
 */
export const sayLayer = (layer: string): string => String(layer ?? '').replace(/_/g, ' ');

/**
 * What VoiceOver is told about the whole diagram, as one sentence.
 *
 * ── why the picture is ONE element and not seventy-six ────────────────────
 *
 * The tempting shape is an accessible element per overlay, so a reader can swipe
 * around a body. It does not work: the overlays are absolutely-positioned images
 * stacked in one box, so the focus order is paint order — coldest to hottest,
 * which is not a body — and the focus RECTANGLE is the whole box for every one
 * of them, so the ring never moves. A reader would swipe through a dozen
 * identically-placed stops. The picture is one thing and it says one sentence,
 * which is the same rule `ZoneNow` in src/ui/ZoneBoard.tsx follows.
 *
 * ── why the sentence is built and not a field ─────────────────────────────
 *
 * scripts/check-a11y.mjs rule 3 flags an `accessibilityLabel` that is a bare
 * property access on an element with several `<Text>` descendants, because such
 * a label REPLACES everything the children would have said rather than adding to
 * it. Handing this diagram `side` or the top muscle's name would drop the count,
 * the bands and the load status. This composes the lot.
 *
 * The status leads, always, and this is the whole point of taking a LoadStatus.
 * "Front of the body. Nothing trained." and "Front of the body. Your training
 * could not be read." are the two pictures src/ui/loadStatus.ts exists to keep
 * apart, and to a reader who cannot see the diagram the sentence IS the diagram.
 */
export function bodySpoken(opts: {
  side: 'front' | 'back';
  lit: readonly LitLayer[];
  missing: readonly string[];
  /** False under 'partial': the bands are computed off an unknown fraction. */
  graded: boolean;
  /** The status sentence, or null when the read is whole and non-empty. */
  caution: string | null;
}): string {
  const where = opts.side === 'front' ? 'Front of the body' : 'Back of the body';
  const parts: string[] = [where];
  if (opts.caution) parts.push(opts.caution);
  if (opts.lit.length) {
    const n = opts.lit.length;
    parts.push(`${n} muscle${n === 1 ? '' : 's'} trained`);
    // Hottest first when we are allowed to grade, because that is the order a
    // person would ask about. Under 'partial' there is no order to claim.
    const named = [...opts.lit].sort((a, b) => b.band.no - a.band.no || a.layer.localeCompare(b.layer));
    for (const l of named) {
      parts.push(opts.graded
        ? `${sayLayer(l.layer)}, band ${l.band.no} of 4, ${l.band.name}`
        : sayLayer(l.layer));
    }
  }
  if (opts.missing.length) {
    const n = opts.missing.length;
    const other = opts.side === 'front' ? 'back' : 'front';
    parts.push(`${n} more muscle${n === 1 ? '' : 's'} trained ${n === 1 ? 'is' : 'are'} drawn on the ${other} of the body`);
  }
  return `${parts.join('. ')}.`;
}

/** One legend entry, said the way the diagram says it. "Band 2 of 4, Moderate". */
export const bandSpoken = (b: Band): string => `Band ${b.no} of 4, ${b.name}`;
