// The muscles one MOVEMENT works, drawn on the body — the exercise heatmap.
//
// The client and coach exercise screens said this in words only: "Primary:
// gluteus maximus, hamstrings · Also: erector spinae". The words are kept, and
// the same body the Training Summary and the Recovery Map draw on is put over
// them, front and back side by side, with the primary movers in the darkest
// band and the assisting muscles in a lighter one. The library rows carry the
// same picture at thumbnail size so a member scanning six hundred movements can
// tell a hip hinge from a squat before reading either name.
//
// ── what the picture claims, and what it does not ─────────────────────────
//
// This is the CATALOGUE's claim about a movement, not a member's training.
// src/ui/MuscleBody.tsx takes a 0..1 intensity per drawn layer and was written
// for a week of logged sets; here the intensity is a fixed two-step code —
// primary 1.0, secondary 0.5 — and the numbers mean nothing beyond "leads" and
// "assists". So the body's own four-band legend is NOT drawn: a key naming
// "Light" and "Heavy" beside a picture that only ever uses two of its bands is a
// key to a picture that is not there (MuscleBody's own words). A two-chip key,
// "Primary" and "Also", is drawn instead, in the two colours the body actually
// used.
//
// The body's spoken sentence has the same problem — it says "band 4 of 4, Very
// heavy" about a muscle that is simply the primary mover — so the two figures
// are hidden from the screen reader and ONE composed sentence is put over them
// that says what the legend says. `bodySpoken` is right for a training picture
// and would be a false reading of this one.
//
// ── colour is never the only channel ──────────────────────────────────────
//
// Bands 4 and 2 of the ramp are about 1.7:1 apart, which is not a difference a
// reader can rely on in sunlight or with a red-green deficiency. The words
// under the picture and the two-chip key are the information; the tint
// confirms it. That is the rule src/lib/bodyHeat.ts sets for every body drawn
// in this app, and it is why the compact row picture is decorative — hidden
// from the reader, with the row's own label carrying the muscle group.
//
// ── honesty about what the artwork cannot show ────────────────────────────
//
// src/lib/muscleMap.ts explains the two vocabularies. A catalogue name with no
// layer (serratus anterior, quadratus lumborum) is NAMED in a caption rather
// than dropped: a member who reads "serratus anterior" in the words and sees
// nothing lit for it would otherwise conclude the picture is wrong. A name
// drawn by approximation (rhomboids on the trapezius) says so in the map's own
// sentence. And a movement whose every named muscle is undrawable gets the
// words and the caption and NO body, because an unlit body under "Muscles
// Worked" is a picture of nothing pretending to be a picture of something.
import { useMemo } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from './components';
import { Flag, type Tone } from './kit';
import { isWhole, type LoadStatus } from './loadStatus';
import { MuscleBody } from './MuscleBody';
import { layerNames, type BodySide } from './muscleArt';
import { sp, radius, grown, font, type as ty } from '../theme/scale';
import { rampFor } from '../lib/bodyHeat';
import { approximations, drawnIntensity, unmapped } from '../lib/muscleMap';
import { catalogueValue as cap } from '../lib/format';

/**
 * The tone a muscle GROUP is drawn in, wherever a group is a chip.
 *
 * One map, here, because the group chip sits beside this file's picture on
 * both screens that draw it — the library's filter row, its rows, and the
 * exercise's own chips — and a Chest that is blue in the filter and purple on
 * the row it filtered to is two groups to the eye. The hues are the approved
 * mockup's (Chest blue, Back teal, Shoulders purple, arms orange); the rest are
 * spread over what is left so neighbours in the alphabetical row differ.
 *
 * The BODY is not recoloured by this. Its ramp is src/lib/bodyHeat.ts's and
 * means "leads" and "assists" on every body in the app; a chip's hue names the
 * group and says nothing about intensity.
 *
 * A group nobody has listed — a coach types the clip's group by hand — is
 * 'neutral', never a guess at the nearest one.
 */
const GROUP_TONES: Readonly<Record<string, Tone>> = {
  chest: 'blue', back: 'teal', shoulders: 'purple',
  arms: 'orange', biceps: 'orange', triceps: 'orange', forearms: 'amber',
  legs: 'pink', quads: 'pink', quadriceps: 'pink', hamstrings: 'purple', glutes: 'red', calves: 'teal',
  core: 'amber', abs: 'amber', abdominals: 'amber',
  cardio: 'red', 'full body': 'brand', neck: 'blue',
};
export function groupTone(group: string | null | undefined): Tone {
  return GROUP_TONES[(group || '').trim().toLowerCase()] ?? 'neutral';
}

/** Intensity a primary mover is drawn at: the top of the ramp. */
const PRIMARY = 1;
/** Intensity an assisting muscle is drawn at: band 2 of the ramp. */
const SECONDARY = 0.5;

/** Height of each figure on the exercise screens. Two of them sit side by
 *  side and come to about 150 points across, which fits the narrowest phone
 *  with the section's own padding to spare. */
const FULL_HEIGHT = 170;
/** Height of the one figure on a library row. The body is a third as wide as
 *  it is tall, so this is a 15-point-wide sliver — enough to see WHERE the
 *  movement lands (hips, back, arms) and no more, which is all a row needs. */
const COMPACT_HEIGHT = 40;

// Computed once: which layer names each side can draw. `layerNames` walks the
// manifest and this is asked for every row of a fifty-row page.
const FRONT_LAYERS = new Set(layerNames('front'));
const BACK_LAYERS = new Set(layerNames('back'));

/**
 * Intensity per DRAWN layer for a movement, from the catalogue's two lists.
 *
 * A muscle named in both lists takes the primary value — `drawnIntensity`
 * keeps the LARGEST when two names land on one layer, and building the
 * trained map with primaries written last does the same one level up.
 */
function exerciseIntensity(primary: readonly string[], secondary: readonly string[]): Record<string, number> {
  const byTrained: Record<string, number> = {};
  for (const m of secondary) byTrained[m] = SECONDARY;
  for (const m of primary) byTrained[m] = PRIMARY;
  return drawnIntensity(byTrained);
}

/** How many of the lit layers this side can actually draw. */
function litOn(intensity: Readonly<Record<string, number>>, side: BodySide): number {
  const has = side === 'front' ? FRONT_LAYERS : BACK_LAYERS;
  let n = 0;
  for (const k of Object.keys(intensity)) if (has.has(k)) n += 1;
  return n;
}

export function ExerciseMuscles({ primary, secondary, status, compact = false, style }: {
  /** The catalogue's own names — 'gluteus maximus', never `gluteus_maximus`. */
  primary: readonly string[];
  secondary: readonly string[];
  /** The read that produced the row. 'ready' when the row is whole. */
  status: LoadStatus;
  /**
   * One small figure and nothing else, for a list row. Decorative: hidden
   * from the screen reader, because the row's own label already names the
   * muscle group and a sliver of tinted body says nothing a reader could use.
   */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bands = rampFor(t.bg);

  // Memoised per instance: a library page mounts fifty of these, and
  // MuscleBody's own memos are keyed on this object's identity, so a fresh
  // map on every keystroke in the search box would re-sort every row's paint
  // order for nothing.
  const intensity = useMemo(() => exerciseIntensity(primary, secondary), [primary, secondary]);
  const named = useMemo(() => [...primary, ...secondary], [primary, secondary]);
  const lit = Object.keys(intensity).length > 0;

  if (compact) {
    // No muscle data, or none the artwork can draw: nothing, never an unlit
    // body. A grey figure in a list of lit ones reads as "this movement works
    // nothing", which is a claim about the movement the catalogue did not make.
    if (!lit) return null;
    // Whichever side shows more of it. A squat is a front picture and a
    // deadlift a back one; a tie goes to the front because that is the side a
    // reader faces.
    const side: BodySide = litOn(intensity, 'back') > litOn(intensity, 'front') ? 'back' : 'front';
    return (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={style}>
        <MuscleBody side={side} intensity={intensity} status={status} height={COMPACT_HEIGHT}
          legend={false} captions={false} />
      </View>
    );
  }

  // `isWhole` and not `!== 'error'`: 'partial' is not gradeable and the body
  // draws it ungraded, so the two-chip key below is withheld with it.
  const graded = isWhole(status);
  const notDrawn = unmapped(named);
  const approx = approximations(named);
  const primaryWords = primary.map(cap).join(', ');
  const secondaryWords = secondary.map(cap).join(', ');

  const caution = status === 'error'
    ? 'The catalogue could not be read, so this is not a picture of the movement'
    : status === 'loading'
      ? 'Reading the catalogue'
      : status === 'partial'
        ? 'Only part of this entry came back, so the picture shows which muscles are worked but not which lead'
        : named.length === 0
          ? 'The catalogue names no muscles for this movement'
          : !lit
            ? 'None of the muscles the catalogue names for this movement can be drawn on the body'
            : null;

  // One sentence for the two figures, composed rather than a field —
  // scripts/check-a11y.mjs rule 3. The legend's words, in the legend's order,
  // and the undrawn names last so a reader hears the same admission the
  // caption prints.
  const spoken = [
    'Muscles worked, drawn on the front and back of the body',
    caution,
    primaryWords ? `Primary: ${primaryWords}` : null,
    secondaryWords ? `Also: ${secondaryWords}` : null,
    notDrawn.length ? `Not drawn: ${notDrawn.map(cap).join(', ')}` : null,
  ].filter(Boolean).join('. ') + '.';

  // The figures are drawn under 'loading' and 'error' — the body's own unlit
  // and dimmed drawings, which are the honest ones — and under 'ready' only
  // when something lights. See the header on why an unlit body is withheld.
  // whole-ok: 'partial' draws the muscles ungraded — WHICH muscles is a list,
  // which loadStatus.ts permits, and the caution above says the grading is
  // withheld; the graded key below is the figure and is gated on `isWhole`.
  const drawBodies = status === 'loading' || status === 'error' || lit;

  return (
    <View style={style}>
      {drawBodies ? (
        <View accessible accessibilityRole="image" accessibilityLabel={spoken} style={{ alignItems: 'center' }}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={{ flexDirection: 'row', justifyContent: 'center', gap: sp.xl }}>
            <MuscleBody side="front" intensity={intensity} status={status} height={FULL_HEIGHT}
              legend={false} captions={false} />
            <MuscleBody side="back" intensity={intensity} status={status} height={FULL_HEIGHT}
              legend={false} captions={false} />
          </View>
        </View>
      ) : null}

      {/* The two-chip key, in the house order from src/lib/hr.ts — the name
          first, the colour confirming. Only over a graded picture: under
          'partial' the body draws every muscle in one band, and a key to two
          bands beside it would describe a picture that is not there. */}
      {drawBodies && graded && lit ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: sp.sm, marginTop: sp.md }}>
          {([
            { label: 'Primary', said: 'Primary movers, the darker band', color: bands[3].color },
            { label: 'Also', said: 'Also worked, the lighter band', color: bands[1].color },
          ] as const).map((k) => (
            // The kit's chip — TonedChip's height, radius and bold micro label —
            // built here because its plate is a Tone's and this swatch is the
            // body ramp's own band, which is not one. The plate stays neutral
            // so the only colour on the chip is the colour on the body.
            <View key={k.label} accessible accessibilityRole="text" accessibilityLabel={k.said}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: grown(26), paddingHorizontal: 11, paddingVertical: 3, borderRadius: grown(26) / 2, backgroundColor: t.surface3 }}>
              <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: k.color }} />
              <Text style={{ ...ty.micro, ...font('700'), letterSpacing: 0, color: t.ink2 }}>{k.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* The words the screens have always carried, under the picture rather
          than instead of it. One paragraph so a long list wraps as prose. */}
      {primaryWords || secondaryWords ? (
        <Text style={{ ...ty.body, color: t.ink2, marginTop: drawBodies ? sp.md : 0 }}>
          {primaryWords ? (
            <Text style={{ color: t.ink }}><Text style={font('600')}>Primary: </Text>{primaryWords}</Text>
          ) : null}
          {primaryWords && secondaryWords ? ' · ' : null}
          {secondaryWords ? (
            <><Text style={font('600')}>Also: </Text>{secondaryWords}</>
          ) : null}
        </Text>
      ) : null}

      {caution ? (
        <Flag tone={status === 'error' ? t.crit : status === 'partial' ? t.warn : t.ink3} style={{ marginTop: sp.md }}>
          {caution}.
        </Flag>
      ) : null}

      {/* Named, not dropped. The muscle is in the words above and not in the
          picture, and the reader is owed the reason.

          'partial' is right to let through: this caption and the
          approximations under it are LISTS of names the catalogue gave, which
          src/ui/loadStatus.ts permits under a truncated read, and neither
          carries a figure — the one thing 'partial' forbids. The two-chip key
          above is the graded claim, and it is gated on `isWhole`. */}
      {/*
       * whole-ok: a list of names, no figure — see the paragraph above. */}
      {status !== 'loading' && status !== 'error' && notDrawn.length && lit ? (
        <Flag tone={t.ink3} style={{ marginTop: sp.sm }}>
          {`The artwork has no layer for ${notDrawn.map(cap).join(', ')}, so ${notDrawn.length === 1 ? 'it is' : 'they are'} in the words and not in the picture.`}
        </Flag>
      ) : null}

      {/* The approximations this particular picture leans on — only the ones
          actually used, in src/lib/muscleMap.ts's own sentences. */}
      {/*
       * whole-ok: a list of the map's own sentences, no figure — same reason as the caption above. */}
      {status !== 'loading' && status !== 'error' ? approx.map((a) => (
        <Flag key={a} tone={t.ink3} style={{ marginTop: sp.sm }}>{a}</Flag>
      )) : null}
    </View>
  );
}
