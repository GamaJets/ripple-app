// The body diagram every muscle screen draws on: one figure, tinted per muscle.
//
// Four screens sit on this — Training Summary, the Recovery Map, the body
// diagram itself and muscle rankings — and none of them owns any of it. They
// hand it a side, a map of intensities and the status of the read that produced
// them; it draws a body and says one sentence about it.
//
// ── how the artwork actually works, verified rather than taken on trust ───
//
// `assets/muscle-heatmap/` is 76 WebP files and a manifest. Three things were
// checked against the decoded pixels before this component was written, because
// the shipped README asserts them and one of the three is wrong.
//
//  1. TRUE — every file on a side shares one pixel size: 334×900 at the front
//     (36 overlays + base = 37 files) and 349×900 at the back (38 + 1 = 39).
//     Confirmed on all 76. That is what lets the whole stack be absolutely
//     positioned in one box with no per-muscle offset arithmetic anywhere.
//
//  2. FALSE — "overlays are RGB white with the shape in the alpha channel, so
//     no colour is baked in". They are not. The overlays are full-colour
//     anatomical art: mean RGB 216,99,65 on the trapezius, 214,97,63 on the
//     abdominals, with ~100% of opaque pixels carrying real chroma (max 180)
//     and per-muscle SHADING baked in — the gluteus maximus averages 125,66,55
//     because half of it is drawn in shadow.
//
//     `tintColor` still works, so the plan survives, but not for the stated
//     reason and it is worth being exact about why. React Native's tintColor is
//     a template render on iOS and an SRC_IN filter on Android: it REPLACES
//     every non-transparent pixel's colour and keeps only the alpha. So it works
//     on any RGB content at all, white or otherwise, and the alpha channel —
//     which is genuinely the shape, 154–175 distinct values per overlay, i.e.
//     properly anti-aliased — is what comes through.
//
//     Tinting is therefore not a convenience here, it is REQUIRED. Drawn
//     untinted, the shading above is a second signal the member cannot switch
//     off: a muscle drawn in shadow reads as darker than an identically-trained
//     muscle drawn in light, and the picture would be reporting the illustrator
//     rather than the training.
//
//  3. The BASE is not neutral either, and this is what decides the design. It is
//     near-greyscale (max chroma 50) but it is a shaded drawing, and the ground
//     under an overlay ranges from relative luminance 0.03 to 0.91 — most
//     muscles sit on light grey at L≈0.70, but the glutes sit at L≈0.084 and the
//     vastus lateralis spans 0.07–0.64, because the figure is drawn WEARING
//     SHORTS. No single tint clears 3:1 against both ends of that; the arithmetic
//     leaves a window of L 0.19–0.27, which is one colour, not a ramp.
//
//     So the base is tinted flat too, to `bodyGround` in src/lib/bodyHeat.ts.
//     The cost is the anatomical shading, which is a real loss and is taken
//     deliberately: it buys a ground that is ONE known colour, which is the only
//     way any contrast claim about a band can be true, and it removes a dark
//     patch across the glutes that read as a hard-trained muscle to anyone
//     glancing at an untrained body.
//
//     The overlays sit inside the base silhouette — checked pixel by pixel, and
//     0.00% of overlay pixels fall outside the base on twelve of the fourteen
//     sampled, so a lit muscle keeps a ground-coloured rim against the card. The
//     deltoid is the exception at 5.3% (170 anti-aliased pixels at the shoulder),
//     which is stated rather than rounded away.
//
// ── right-to-left ─────────────────────────────────────────────────────────
//
// Nothing here mirrors, and nothing here needs to be told not to.
//
// There is no physical side in this file — the stack is `StyleSheet.absoluteFill`
// in a box — so there is nothing for Yoga to flip, and React Native does not
// mirror an `<Image>`'s CONTENT under any circumstances. That is the same
// situation src/lib/direction.ts already argues for `svg-drawing`: a drawing
// that cannot follow the reader, whose labels therefore must not follow either.
//
// It is worth saying why mirroring would be wrong and not merely absent, since
// this is a body and bodies have a left and a right. The front view is a figure
// FACING the reader, so its left arm is drawn on the reader's right. Mirroring
// the box in Arabic would move that arm to the reader's left and the picture
// would then assert the wrong side of the member's own body — a false claim, not
// a foreign-looking layout, which is exactly the line direction.ts draws.
//
// The `L`/`R` in the filenames is the FIGURE'S left and right. Nothing in this
// component or in `drawnIntensity` carries a side: intensity is keyed by layer
// NAME, so both halves of a muscle always take the same tint and the spoken
// label never names a side. If per-side training ever arrives, both the map and
// this sentence have to change together; neither can be quietly upgraded.
//
// ── colour is never the only channel ──────────────────────────────────────
//
// src/lib/hr.ts states the rule and src/lib/bodyHeat.ts explains why this ramp
// is subject to it: four monotone bands inside the lightness window a single
// ground allows are 1.24–1.38:1 apart, which is two oranges that read as one.
// So every band carries its number and its name, in the legend and in the spoken
// sentence, and a screen drawing this body is expected to draw the ranking list
// beside it. The picture confirms; the list informs.
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated, Easing, Image, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useTheme } from './components';
import { Flag } from './kit';
import { isWhole, type LoadStatus } from './loadStatus';
import { ART, layerNames, type BodySide } from './muscleArt';
import { sp, radius, type as ty } from '../theme/scale';
import {
  bandSpoken, bodyGround, bodySpoken, litLayers, notOnThisSide, rampFor, sayLayer,
  type Band,
} from '../lib/bodyHeat';

export type { BodySide };

/**
 * The four states, drawn so that no two of them look the same.
 *
 * This is the whole reason the component takes a LoadStatus at all, and
 * src/ui/loadStatus.ts is the argument: an intensity map that is empty because
 * nothing was trained and one that is empty because the read was refused arrive
 * here as the identical `{}`, and a diagram that drew them the same would be
 * telling a member a fact about their own training that it does not know.
 *
 *   loading  the unlit body, pulsing. No overlays, no legend, no count. Motion
 *            is what separates it from the two still empty states, and it is
 *            the only one of the four that claims nothing at all.
 *   ready    the picture, graded. An empty one says "Nothing trained" as a
 *            fact, because under 'ready' that is a fact.
 *   partial  the muscles, UNGRADED — all drawn in band 1, legend suppressed,
 *            and the note says so. Which muscles were trained is a LIST, and
 *            loadStatus.ts permits a list under 'partial'. How hard each was
 *            trained is a figure computed over the rows, and a figure computed
 *            from an unknown fraction of them is exactly what 'partial' forbids.
 *            Grading a truncated read would draw a member's heaviest week as a
 *            light one and give them no way to tell.
 *   error    the unlit body, dimmed, with a crit mark and a sentence that says
 *            it is not a picture of their training. Nothing is drawn on it,
 *            because whatever is in the map under 'error' is a cache, a seed or
 *            nothing, and none of those is this week.
 */
export function MuscleBody({
  side, intensity, status, ramp, height, surface, legend = true, style,
}: {
  side: BodySide;
  /** Intensity 0..1 per DRAWN layer name — `drawnIntensity` in src/lib/muscleMap.ts. */
  intensity: Readonly<Record<string, number>>;
  status: LoadStatus;
  /** Overrides the palette's own ramp. Defaults to `rampFor(t.bg)`. */
  ramp?: readonly Band[];
  /**
   * Drawn height in points. Omit and the figure fills its container instead,
   * still on the side's own aspect ratio — the front and the back are 0.3716 and
   * 0.3879 wide for their height and a shared number would squash one of them.
   */
  height?: number;
  /** The colour the diagram is drawn ON. The unlit body is mixed over it. */
  surface?: string;
  legend?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const card = surface ?? t.surface;
  const art = ART[side];
  const bands = ramp ?? rampFor(t.bg);
  const ground = bodyGround(t.ink3, card);

  // `isWhole` and not `status !== 'error'`: 'partial' is not 'error' and is not
  // gradeable either, and the two-way test is the one that keeps saying so.
  const graded = isWhole(status);
  const drawOverlays = status === 'ready' || status === 'partial';

  const { lit, missing } = useMemo(() => {
    if (!drawOverlays) return { lit: [], missing: [] as string[] };
    const names = layerNames(side);
    return { lit: litLayers(intensity, names, bands), missing: notOnThisSide(intensity, names) };
  }, [drawOverlays, side, intensity, bands]);

  // The overlays to draw, ALREADY IN PAINT ORDER — `lit` is sorted coldest
  // first by `litLayers`, and this walks it rather than walking the manifest.
  //
  // Walking `ART[side].layers` and looking each one up would have been the
  // obvious loop and it silently throws that order away: the manifest is in the
  // illustrator's own back-to-front order, so an overlap between a lightly and a
  // heavily trained muscle — `gracilis` under `gracilis_gastrocnemius`, the
  // adductors under the quadriceps — would resolve to whichever the artwork
  // happened to list last instead of to the hotter one. Both halves of a muscle
  // are emitted together because intensity is keyed by layer NAME and carries no
  // side; see the header on why that is deliberate.
  //
  // Under 'partial' the bands are not claimed, so every lit muscle is drawn in
  // the coldest one. It is deliberately the coldest and not the hottest: a
  // truncated read is a FLOOR on the work done, and drawing the floor in the
  // colour that means "very heavy" would overstate it in the other direction.
  const painted = useMemo(() => {
    const byName = new Map<string, typeof art.layers>();
    for (const l of art.layers) {
      const at = byName.get(l.name);
      if (at) at.push(l); else byName.set(l.name, [l]);
    }
    return lit.flatMap((l) =>
      (byName.get(l.layer) ?? []).map((a) => ({ art: a, color: graded ? l.band.color : bands[0].color })));
  }, [art, lit, graded, bands]);

  const caution = status === 'error'
    ? 'Your training could not be read, so this is not a picture of it'
    : status === 'loading'
      ? 'Reading your training'
      : status === 'partial'
        ? 'Only part of your history came back, so this shows which muscles were trained but not how hard'
        : lit.length === 0 && missing.length === 0
          ? 'Nothing trained in this period'
          : null;

  const spoken = bodySpoken({ side, lit, missing, graded, caution });

  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (status !== 'loading') { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.9, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [status, pulse]);

  const box: StyleProp<ViewStyle> = height != null
    ? { height, aspectRatio: art.aspect }
    : { flex: 1, aspectRatio: art.aspect, alignSelf: 'center' };

  return (
    <View style={style}>
      {/* One accessible element, one sentence. A stop per overlay would put a
          dozen identically-placed focus stops in paint order, which is not a
          body — the argument is in `bodySpoken`. `spoken` is composed rather
          than a field, which is what scripts/check-a11y.mjs rule 3 asks for. */}
      <View accessible accessibilityRole="image" accessibilityLabel={spoken}
        style={{ alignItems: 'center' }}>
        <Animated.View style={[box, { opacity: status === 'error' ? 0.45 : pulse }]}>
          {/* Every layer including the base is `contain` into the same box. They
              share a pixel size per side, so contain letterboxes all 37 (or 39)
              of them identically and the stack stays registered whatever ratio
              the box ends up with — which matters because the manifest's aspect
              is the SOURCE art's and the shipped files are 0.12% off it. */}
          <Image source={art.base} resizeMode="contain" accessibilityIgnoresInvertColors
            style={[StyleSheet.absoluteFill, { width: undefined, height: undefined, tintColor: ground }]} />
          {/* An untrained muscle is absent from this list rather than drawn at
              opacity 0: React Native composites a zero-opacity view, so it would
              still cost a decode, a texture upload and a layer. See `litLayers`
              for what that saves on a real week. */}
          {painted.map((p) => (
            <Image key={`${p.art.name}-${p.art.side}`} source={p.art.source} resizeMode="contain"
              accessibilityIgnoresInvertColors
              style={[StyleSheet.absoluteFill, { width: undefined, height: undefined, tintColor: p.color }]} />
          ))}
        </Animated.View>
      </View>

      {caution ? (
        <Flag tone={status === 'error' ? t.crit : status === 'partial' ? t.warn : t.ink3}
          style={{ marginTop: sp.md }}>
          {caution}.
        </Flag>
      ) : null}

      {missing.length ? (
        <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
          {`${missing.length} muscle${missing.length === 1 ? '' : 's'} you trained ${missing.length === 1 ? 'is' : 'are'} drawn on the ${side === 'front' ? 'back' : 'front'} of the body: ${missing.map(sayLayer).join(', ')}.`}
        </Flag>
      ) : null}

      {/* No legend when nothing is graded. A key to four bands beside a body
          drawn in one of them is a key to a picture that is not there. */}
      {legend && graded && lit.length > 0 ? (
        <MuscleBodyLegend ramp={bands} style={{ marginTop: sp.md }} />
      ) : null}
    </View>
  );
}

/**
 * The key to the four bands: number, name, and the colour last.
 *
 * Deliberately not a bare row of swatches. The order within a chip is the house
 * order from src/lib/hr.ts — the numeral leads, the name follows, the colour
 * confirms — because the four bands are 1.24–1.38:1 apart and a reader who
 * cannot separate two of them still has the numeral. The swatch is a filled
 * mark, never text, so no status or ramp colour is ever a `color:` here.
 */
export function MuscleBodyLegend({ ramp, style }: {
  ramp?: readonly Band[];
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bands = ramp ?? rampFor(t.bg);
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md }, style]}>
      {bands.map((b) => (
        <View key={b.no} accessible accessibilityLabel={bandSpoken(b)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: sp.xs }}>
          <View style={{ width: 10, height: 10, borderRadius: radius.sm, backgroundColor: b.color }} />
          <Text style={{ ...ty.micro, color: t.ink2 }}>{`${b.no} · ${b.name}`}</Text>
        </View>
      ))}
    </View>
  );
}
