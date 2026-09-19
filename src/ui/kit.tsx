// ── The kit ──────────────────────────────────────────────────────────────────
// Screen-level primitives built on `theme/scale`. Screens compose these instead
// of hand-rolling a card out of inline styles for the 3,815th time.
//
// The look is "instrument panel": the data is the only thing with ink on it.
// Chrome recedes — sections are separated by air and a hairline rather than
// boxed, and a real card is spent only on something you can act on. Accent
// colour marks the live metric and the primary action, and nothing else.
import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, type ViewStyle, type StyleProp } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle, Polyline, Line } from 'react-native-svg';
import { useTheme } from './components';
import { Icon, type IconName } from './Icon';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value, fontScale, grown } from '../theme/scale';
import { effectiveWidth, linesAtScale } from '../lib/typeScale';
import { hitSlopFor } from '../lib/a11y';
import { appLocale } from '../lib/locale';
import { num } from '../lib/format';
import { plainExact } from '../lib/units';
import {
  axisLabel, pointLabel, tickIndices, maxTicksForWidth,
  segments, readablePoints, hasInteriorGap, nearestPoint,
} from '../lib/chartAxis';
import { BACK_ICON, END_ALIGN, FORWARD_CHAR, FORWARD_ICON, turn } from './direction';
import { isWhole, type LoadStatus } from './loadStatus';

/* ── how this kit talks ───────────────────────────────────────────────────
 *
 * Two rules, applied to every component below.
 *
 * ONE CONTROL, ONE SENTENCE. A Kpi column is a label, a value, a unit and a
 * note — four Texts, and to VoiceOver four separate stops that arrive as
 * "Weight", "72.9", "kg", "down 400 grams this week" with a swipe between each.
 * Where a group of Texts is really one fact, it is marked `accessible` and given
 * the sentence a person would say. Where the visible text already IS the
 * sentence, nothing is added — a label that repeats what is on screen costs a
 * maintainer something and buys the reader nothing.
 *
 * COLOUR IS NEVER THE ONLY CHANNEL. A filled ring, a lit dot, a brand-coloured
 * bar: each of these says something that a screen reader gets nothing of, and
 * that a person with low vision or in bright sun may not get either. Every one
 * of them below now carries its state in words as well.
 */

/* ── structure ────────────────────────────────────────────────────────────── */

/** A 1px divider. Sections are separated by this + air, not by boxing them. */
/**
 * A figure for a Hero or a Kpi, or an em dash when there is nothing to show.
 *
 * Exists because `String(x)` is the obvious thing to write and is silently
 * wrong: `String(null)` is the four-letter string "null", which TypeScript
 * cannot object to and which shipped to the client dashboard as
 * "null kg / null % / null kg" for anyone with no body scan on record.
 *
 * NaN is caught too — `0/0` reaching a screen as "NaN" is the same failure
 * wearing a different word. Both mean "not measured", and both must read as a
 * dash rather than as a value the reader might believe.
 *
 * ── and why a NUMBER does not go through String ────────────────────────────
 *
 * `String(3.42)` is "3.42" on every handset there has ever been. A member whose
 * language writes 3,42 was reading an English decimal point here — in the Hero
 * figure, in every Kpi column, and in the report tables — while the same
 * screen's `weightLabel`, `deltaLabel` and `plain` output beside it wrote the
 * comma. Two decimal conventions in one row, one of them not the reader's.
 *
 * `plainExact` from src/lib/units.ts changes the separator and NOTHING else: it
 * does not round, does not group and does not write the locale's own digits, so
 * a figure this printer has never seen the grain of comes out with exactly the
 * digits it came in with. A string argument is already somebody else's finished
 * sentence — `weightLabel`, `liftLabel`, `num1` — and is passed through
 * untouched, because spelling an already-spelled figure a second time is how a
 * separator gets applied twice.
 */
export function fig(v: number | string | null | undefined): string {
  if (v == null) return '—';
  if (typeof v === 'number' && !Number.isFinite(v)) return '—';
  const s = typeof v === 'number' ? plainExact(v) : String(v);
  return s === 'null' || s === 'undefined' || s === 'NaN' ? '—' : s;
}

export function Rule({ inset = 0 }: { inset?: number }) {
  const t = useTheme();
  // A hairline divides for the eye and means nothing to the ear. Hidden so a
  // screen reader walking a long settings screen does not stop on each of the
  // twenty rules between the rows it actually wants.
  return (
    <View
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ height: hairline, backgroundColor: t.ring, marginStart: inset }}
    />
  );
}

/**
 * A section, drawn the board's way: a card.
 *
 * This was air and a hairline — `paddingVertical` and nothing else, with a
 * <Rule/> between neighbours — which is the "instrument panel" the header of
 * this file describes. The approved board groups every screen into white
 * cards on the ground with 16pt inside them, and that is the single largest
 * visible difference between the board and the app. Changing it HERE, once,
 * moves every screen at the same time; changing it screen by screen is how
 * two screens come to disagree about what a section is.
 *
 * The <Rule/> a screen puts between two sections still draws; on the ground
 * between two cards it is a faint line in a gap and nothing more. The
 * paddings are inside the card, so a row's own vertical padding is unchanged
 * and a Card inside a Section keeps its hairline (see Card) so white on
 * white stays a box.
 */
export function Section({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{
      backgroundColor: t.surface, borderRadius: radius.md,
      borderWidth: hairline, borderColor: t.ring,
      paddingVertical: layout.section, paddingHorizontal: sp.lg,
      marginTop: sp.md,
    }, style]}>{children}</View>
  );
}

/**
 * A consistent screen opening: context first, then the page title, with only
 * genuinely global actions beside it. At larger text sizes the actions move
 * below the title instead of squeezing or truncating the reader's name.
 *
 * One component rather than the same twelve lines on every tab, because the
 * approved board opens every screen the same way — a quiet eyebrow, a title,
 * and at most two round controls at the trailing edge — and twelve hand
 * copies of that is twelve places for it to drift.
 */
export function ScreenHeader({
  eyebrow, title, subtitle, leading, actions, greeting,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  actions?: ReactNode;
  /** The eyebrow as a spoken line — "Good morning," in body ink over the
   *  name — the way the board opens Home, rather than as a small label. */
  greeting?: boolean;
}) {
  const t = useTheme();
  const stacked = fontScale >= 1.35;
  return (
    <View style={{
      flexDirection: stacked ? 'column' : 'row',
      alignItems: stacked ? 'stretch' : 'flex-start',
      justifyContent: 'space-between',
      gap: sp.md,
      paddingTop: sp.md,
    }}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: sp.md }}>
        {leading ? <View style={{ paddingTop: eyebrow ? 0 : 1 }}>{leading}</View> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          {eyebrow ? <Text style={greeting ? { ...ty.body, color: t.ink2 } : { ...ty.micro, color: t.ink3 }}>{eyebrow}</Text> : null}
          <Text accessibilityRole="header" style={{ ...ty.title, color: t.ink, marginTop: eyebrow ? (greeting ? 2 : 5) : 0 }}>
            {title}
          </Text>
          {subtitle ? <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.sm }}>{subtitle}</Text> : null}
        </View>
      </View>
      {actions ? (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: stacked ? 'flex-end' : 'auto',
          gap: sp.sm,
          marginTop: stacked ? 0 : 2,
        }}>
          {actions}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The round Ghost's diameter. A blank that stands in for one — the trailing
 * slot of a PageHead with nothing in it — has to be exactly this wide, or the
 * title beside it is centred on the row and not on the screen.
 */
const ROUND = 38;

/**
 * The head of every page reached from a row, the way the approved board draws
 * it: a round back control at the leading edge, the title on the SCREEN's
 * centre line, and at the trailing edge either one control — the settings
 * gear on Profile, the unread pill on Notifications, a share, a + — or a blank
 * the width of the back control. The blank is the whole trick: a title
 * centred between a 38pt button and nothing sits 19pt off the axis, which is
 * visible from across the room and was visible on every one of the twelve
 * hand copies this replaces.
 *
 * A sibling of ScreenHeader rather than a `centered` flag on it, because the
 * two share nothing but the word "title". ScreenHeader is the tab opening —
 * eyebrow, a title at the leading edge, up to two actions that STACK under it
 * at large text — and this is the page opening, which must not stack: the
 * back control has to stay where the thumb learned it is. A flag that turns
 * off an eyebrow, a greeting, the leading layout and the stacking is not a
 * mode, it is a second component wearing the first one's name.
 *
 * `leading` and `trailing`, never left and right: the row is a plain flex row
 * and Yoga swaps the ends for a right-to-left reader on its own. BACK_ICON is
 * already the mirrored glyph.
 *
 * The title wraps — two lines, three at accessibility sizes — rather than
 * truncating: "Credentials & Reviews" at 1.35 is a fit only as two lines, and
 * an exercise name is the one thing on a set screen that must not end in an
 * ellipsis. `title` is optional for the one page whose title is the identity
 * block under the bar (coach Profile); the slot is then empty and the two
 * controls hold the two ends.
 */
export function PageHead({ title, subtitle, leading, trailing, onBack, backLabel = 'Back' }: {
  title?: string;
  /** One quiet line under the title — the client's name under "Nutrition Plan". */
  subtitle?: string;
  /** Replaces the back control. Pass `null` for an empty leading slot. */
  leading?: ReactNode;
  /** The one trailing control. Absent, a blank of the back control's width. */
  trailing?: ReactNode;
  /** Where back goes when it is not `router.back()` — a set screen returning
   *  to its exercise, say. */
  onBack?: () => void;
  /** What the back control says when "Back" is not the whole truth. */
  backLabel?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ paddingTop: sp.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
        {leading === undefined
          ? <Ghost icon={BACK_ICON} a11yLabel={backLabel} onPress={onBack ?? (() => router.back())} />
          : (leading ?? <View style={{ width: ROUND }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />)}
        {title ? (
          <Text accessibilityRole="header" numberOfLines={linesAtScale(fontScale, 2)}
            style={{ ...ty.title, color: t.ink, flex: 1, minWidth: 0, textAlign: 'center' }}>
            {title}
          </Text>
        ) : <View style={{ flex: 1 }} />}
        {trailing ?? <View style={{ width: ROUND }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />}
      </View>
      {subtitle ? (
        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

/**
 * A section's header: the title at the leading edge, and an optional tappable
 * trailing note (a summary figure, "All activity ›").
 *
 * ── The title is a HEADING, and is drawn as one ───────────────────────────
 *
 * It was `ty.micro` on `t.ink3` — the same face and the same grey as the
 * label over a field and the caption under a row. A coach testing the app
 * wrote, of exactly this component: "With the subheadings like coaching
 * tools, this month. It blends in too much with the other text it's easy to
 * miss." They were right, and the arithmetic says why: on a dense screen a
 * card holds a 13pt grey title over 15pt INK rows, so the thing that names
 * the card was the quietest text in it. A heading that is outranked by what
 * it heads is not doing the one job it has.
 *
 * So the title is `ty.head` in `t.ink` — 17pt bold, the same step a Notice's
 * title and an ActionBlock's use, one below the page title — and it is said
 * as a header, so a VoiceOver reader can move card to card with the rotor
 * instead of swiping through every row between them. The NOTE stays caption
 * on `t.ink3`: it is the aside, and the contrast between the two is what
 * makes the title read as the title.
 *
 * "Leading" and "trailing" rather than left and right because the row is a
 * plain `flexDirection: 'row'` and Yoga swaps the two ends in a right-to-left
 * locale on its own. The chevron does not swap on its own, which is what
 * FORWARD_CHAR below is for.
 */
export function SectionHead({ title, note, onPress }: { title: string; note?: string; onPress?: () => void }) {
  const t = useTheme();
  // At the largest accessibility sizes even proportional shrinking leaves a
  // sentence-length note as a column of three-letter lines beside the title.
  // Past that point the two stack, title over note, and each gets the width.
  //
  // And at ANY size where the two cannot share a line. At 13pt the title gave
  // up little; at 17pt bold "What Your Business Costs" beside "What you have
  // recorded going out" is two columns of two-word lines, which is the defect
  // described below arriving by a different road. A 17pt bold character
  // averages about 9pt and a 12pt caption character about 6, and the inside of
  // a card on the narrowest phone the app supports is a little under 300pt —
  // so where the sum does not fit, the note goes UNDER the title and reads as
  // its subtitle, which is how the board sets a sentence-length note anyway.
  // Short pairs ("This Month" / "Analytics ›") are nowhere near the line and
  // stay a row. An estimate, deliberately: measuring would cost a layout pass
  // and a flash of the wrong arrangement on every card of every screen.
  const crowded = !!note && (title.length * 9 + note.length * 6) * fontScale > 290;
  const stacked = fontScale >= 1.5 || crowded;
  return (
    // `gap` and the two `flexShrink`s are not tidying. Without them this row
    // had no way to be too wide: `space-between` puts nothing between the two
    // children when they already fill the line, and a Text that cannot shrink
    // runs off the end rather than wrapping. Seen on an iPhone 17 Pro at the
    // DEFAULT text size, on two screens:
    //
    //   AT-RISK CLIENTSWell below their own rate over the last 14 days. I
    //   WHAT YOU HAVE ISSUEDPriced in AED, from your gym's setting
    //
    // — no space after the title, the first line running past the right edge,
    // and the remainder wrapping to a stray centred second line. Twenty-odd
    // call sites pass a `note` over 28 characters, so this is the whole set of
    // them, not two screens; and it gets worse, not better, at the larger text
    // sizes a good many people use.
    //
    // Both children shrink rather than one: giving only the note `flexShrink`
    // protects the title and squeezes the note to a column of single letters,
    // which is not better. Yoga shrinks proportionally to size, so the short
    // uppercase title keeps most of its width and the long sentence gives up
    // most of the slack, which is the right trade in every case here.
    <View style={{
      flexDirection: stacked ? 'column' : 'row',
      justifyContent: 'space-between',
      alignItems: stacked ? 'flex-start' : 'baseline',
      gap: stacked ? sp.xs : sp.md,
      marginBottom: sp.md,
    }}>
      <Text accessibilityRole="header" style={{ ...ty.head, color: t.ink, flexShrink: 1 }}>{title}</Text>
      {note ? (
        // The chevron is drawn as a character, so it is also SPOKEN as one —
        // "All activity right-pointing angle quotation mark". The label says the
        // words and the role says it is a button, which is what the glyph was
        // there to convey. 12pt of caption plus this slop reaches 44pt.
        //
        // The hitSlop stays on physical left/right, here and everywhere else
        // in the app: React Native's Insets type is {top,left,bottom,right},
        // there is no start/end spelling of it, and RN does not mirror one. So
        // there is nothing to convert TO — which is why scripts/check-rtl.mjs
        // exempts the whole property by name rather than asking for a marker on
        // each of the twenty-odd call sites.
        <Pressable
          onPress={onPress} disabled={!onPress}
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={onPress ? note : undefined}
          hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
          style={{ flexShrink: 1 }}
        >
          {/* END_ALIGN rather than a raw 'right': a note that has wrapped to a
              second line must stay against the trailing edge it started at, and
              in a right-to-left locale that edge is the left one. */}
          {/* …and stacked under the title it is a subtitle, which starts where
              the title starts. 'auto' is the leading edge in every locale. */}
          <Text style={{ ...ty.caption, color: t.ink3, textAlign: stacked ? 'auto' : END_ALIGN }}>{note}{onPress ? ' ' + FORWARD_CHAR : ''}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ── the hero ─────────────────────────────────────────────────────────────── */

/**
 * The single number a screen leads with. One per screen — a second hero means
 * neither is the hero. `arc` draws the value as a ring at 0..1.
 */
/** A 0–1 arc as a whole percentage, clamped — 103% of a target is still a
 *  full ring, and the figure beside it already says how far over. */
function arcPct(arc: number): number {
  return Math.round(Math.max(0, Math.min(1, arc)) * 100);
}

export function Hero({
  label, figure, unit, note, arc, arcLabel, tone, onPress,
}: {
  label: string; figure: string; unit?: string; note?: string;
  arc?: number;
  /** What the ring measures, as it would be read aloud after the percentage:
   *  "of today's calories eaten". The component cannot know — on the Meals
   *  hero the figure counts DOWN as the ring fills up — and a sentence guessed
   *  from `label` would confidently say the wrong thing. */
  arcLabel?: string;
  tone?: string; onPress?: () => void;
}) {
  const t = useTheme();
  const mark = tone || t.brand;
  const R = 31, C = 2 * Math.PI * R;
  // "Weight" / "72.9" / "kg" / "down 400 g since Monday" are one fact and were
  // four stops. Said as the sentence a person would say. The ring keeps its own
  // element after it, because it is a different quantity and often a different
  // subject — see arcLabel.
  const spoken = [label, [figure, unit].filter(Boolean).join(' '), note].filter(Boolean).join(', ');
  return (
    <Pressable onPress={onPress} disabled={!onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.xl, paddingTop: sp.xxl, paddingBottom: sp.xl }}>
      <View style={{ flex: 1 }} accessible accessibilityLabel={spoken}
        accessibilityRole={onPress ? 'button' : undefined}>
        <Text style={{ ...ty.micro, color: t.ink3 }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: sp.sm }}>
          {/* ── One line, shrunk to fit, never wrapped and never clipped ──
              This is the one number on the screen and it had no guard of any
              kind: 44pt display type, no `flexShrink`, no `numberOfLines`, in a
              row beside a 72pt ring. On a 375pt phone "AED 1,284,900.00" wraps
              MID-NUMBER — a money figure broken across two lines is a figure an
              owner reads wrong — and at iOS Larger Text it wrapped down into the
              note beneath it.

              `adjustsFontSizeToFit` and not a font-size cap. src/lib/typeScale.ts
              is explicit that nothing in this app caps the reader's text size,
              because a ceiling on somebody's text size is a ceiling on whether
              they can read the app at all; where a fixed box was the problem the
              box gives way. Here the box cannot give way — the ring is beside it
              — so the FIGURE gives up points and everything else on the screen
              still scales.

              `minimumFontScale` is 0.35 rather than the 0.85 used on a chip
              label, and the low floor is the whole point: below the floor iOS
              stops shrinking and ELLIPSISES, and "AED 1,284,9…" is not a smaller
              rendering of a number, it is a different number. 0.35 of 44pt is
              15pt, which still fits a six-figure sum in a currency with a
              three-letter code on the narrowest phone the app supports, at an
              accessibility text size, next to the ring. */}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.35}
            style={{ ...ty.hero, ...numeric, color: t.ink, flexShrink: 1 }}
          >{figure}</Text>
          {/* The unit is two or three characters and is what the figure MEANS,
              so it does not shrink and does not get pushed off — the figure
              yields first. */}
          {unit ? <Text numberOfLines={1} style={{ ...ty.head, color: t.ink3, marginStart: 6, letterSpacing: 0, flexShrink: 0 }}>{unit}</Text> : null}
        </View>
        {note ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.sm }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: mark }} />
            <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{note}</Text>
          </View>
        ) : null}
      </View>
      {arc != null ? (
        // The ring is how far through the figure above you are, and it used to
        // say so nowhere: asked outright, "what does the circle do or what is
        // it for?". At 0% it is an empty grey track and reads as decoration,
        // which is the moment it most needs to be legible. The percentage sits
        // inside it, and screen readers get the same sentence rather than an
        // unlabelled graphic.
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={arcLabel ? `${arcPct(arc)}% ${arcLabel}` : `${arcPct(arc)}%`}
          accessibilityValue={{ min: 0, max: 100, now: arcPct(arc) }}
          // The ring grows with the reader's text because the percentage is
          // drawn INSIDE it. `viewBox` is unitless, so the whole drawing scales
          // and the stroke stays proportional; capping the figure instead would
          // have left the one number this ring exists to state as the only
          // small text on a screen somebody turned up to read.
          style={{ width: grown(72), height: grown(72), alignItems: 'center', justifyContent: 'center' }}
        >
          <Svg width={grown(72)} height={grown(72)} viewBox="0 0 72 72" style={{ position: 'absolute' }}>
            <Circle cx="36" cy="36" r={R} fill="none" stroke={t.surface3} strokeWidth={3} />
            <Circle cx="36" cy="36" r={R} fill="none" stroke={mark} strokeWidth={3} strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, arc)))}
              transform="rotate(-90 36 36)" />
          </Svg>
          <Text style={{ ...ty.caption, ...numeric, fontWeight: '600', color: t.ink2 }}>{arcPct(arc)}%</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/* ── chip grid ────────────────────────────────────────────────────────────── */

/**
 * A set of destinations, all of them visible.
 *
 * The alternative — and what both apps did — is a horizontal ScrollView with
 * `showsHorizontalScrollIndicator={false}`, which puts everything past the
 * screen edge somewhere nobody knows to look. On the client's Train tab that
 * hid roughly seven of twelve destinations; Music & Playlists was reported
 * MISSING while it sat in that row's tail, and so were Library, Tools, Watch &
 * Devices and When to Rest. A row you have to discover by dragging is a row
 * most people never read.
 *
 * `flexWrap` is inert inside a horizontal ScrollView — it lays out on one
 * unbounded main axis — which is why this is a plain View, and why the chips
 * must NOT take `flex: 1`: they size to their content, and that is what lets
 * twelve of them flow onto three lines.
 *
 * Distinct from QuickRow, which is a fixed row of equal-width vertical tiles
 * for three or four primary actions. Handing QuickRow seven items squeezes
 * them into one line rather than wrapping.
 */
export interface Chip {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Stable key. Defaults to the label, which is unique within a set in
   *  practice; pass a route when two chips could ever share a word. */
  key?: string;
}

export function ChipGrid({ items, tone }: { items: Chip[]; tone?: string }) {
  const t = useTheme();
  const mark = tone || t.ink2;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
      {items.map((c) => (
        <Pressable
          key={c.key ?? c.label}
          onPress={c.onPress}
          accessibilityRole="button"
          accessibilityLabel={c.label}
          // 8 + 18 + 8 is a 34pt pill. These are the destination chips a client
          // taps between sets; five points of slop a side is the difference
          // between hitting one and hitting its neighbour.
          hitSlop={{ top: hitSlopFor(34), bottom: hitSlopFor(34), left: 0, right: 0 }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: sp.sm }}
        >
          <Icon name={c.icon} size={14} color={mark} />
          <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{c.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ── KPI row ──────────────────────────────────────────────────────────────── */

export interface KpiItem {
  label: string; value: string; unit?: string;
  delta?: string;
  /** true = this delta is movement in the direction the client wants. */
  good?: boolean;
  route?: string;
}

/**
 * Metrics as columns divided by a hairline — not as a row of bordered boxes.
 * Same information, roughly half the packaging.
 */
export function KpiRow({ items, onPress }: { items: KpiItem[]; onPress?: (i: KpiItem) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row' }}>
      {items.map((k, i) => {
        const live = !!onPress && !!k.route;
        // The delta's direction is drawn as a dot in the accent colour when it
        // is movement the client wants and in ink3 when it is not. That is the
        // whole signal, and it is colour alone — so it is also said.
        const spoken = [
          k.label,
          [k.value, k.unit].filter(Boolean).join(' '),
          k.delta ? `${k.delta}${k.good ? ', on track' : ''}` : '',
        ].filter(Boolean).join(', ');
        return (
        <Pressable key={k.label} onPress={() => onPress?.(k)} disabled={!live}
          accessible accessibilityLabel={spoken} accessibilityRole={live ? 'button' : undefined}
          style={{
            flex: 1,
            paddingEnd: sp.md,
            paddingStart: i === 0 ? 0 : sp.lg,
            borderStartWidth: i === 0 ? 0 : hairline,
            borderStartColor: t.ring,
          }}>
          {/* The figure first and the label UNDER it, the board's way — its
              KPI figures are the biggest thing on the page ("12 / 8 / 95%" on
              coach page 2) and the word is a footnote to the number, not a
              heading over it. 26 rather than the 22 this had: three of these
              in 358pt at 22 read as body copy beside the board's.

              `adjustsFontSizeToFit` on the figure and not on the unit: at
              fontScale 1.35 a column is ~100pt and "1,240" at 26 × 1.35 is
              not, so the figure yields — to 70% — before it wraps or clips.
              The unit stays caption size whatever the figure does, because
              "0 of 12" and "under 1%" are a figure and a qualifier, and a
              qualifier drawn at figure size becomes a second figure. It can
              wrap; a suffix on a second line is still the suffix. */}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Text style={{ ...value(26), color: t.ink, flexShrink: 1 }} numberOfLines={1}
              adjustsFontSizeToFit minimumFontScale={0.7}>{k.value}</Text>
            {k.unit ? <Text style={{ ...ty.caption, color: t.ink3, marginStart: 2, flexShrink: 1 }}>{k.unit}</Text> : null}
          </View>
          <Text style={{ ...ty.micro, color: t.ink3, marginTop: 2 }}>{k.label}</Text>
          {k.delta ? (
            // Two lines, and the mark aligned to the first of them. Three
            // columns on a 390pt phone give a delta roughly 14 characters at
            // caption size, and one line silently ate the rest: "no session
            // fee set" arrived as "no session fe…", which is not a sentence
            // and not a fact. Anything genuinely longer still truncates, but
            // the useful notes now fit.
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 4 }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, marginTop: 5, flexShrink: 0, backgroundColor: k.good ? t.brand : t.ink3 }} />
              <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }} numberOfLines={linesAtScale(fontScale, 2)}>{k.delta}</Text>
            </View>
          ) : null}
        </Pressable>
        );
      })}
    </View>
  );
}

/* ── cards, spent sparingly ───────────────────────────────────────────────── */

/** A surface that groups. Depth, not a border — reserve it for actionable things. */
export function Card({ children, onPress, tone, style }: {
  children: ReactNode; onPress?: () => void; tone?: string; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const body = (
    <View style={[{
      backgroundColor: t.surface, borderRadius: radius.md, padding: sp.lg,
      ...elevation.e1,
      // A hairline on every card, not only a toned one: sections are cards
      // now, so a Card inside a Section is white on white and needs an edge
      // to be a box at all. The tone, where there is one, is that edge.
      borderWidth: hairline, borderColor: tone ?? t.ring,
    }, style]}>{children}</View>
  );
  // A tappable card is a button and has to say so; without a role it announces
  // its contents and gives no hint that anything happens if you double-tap.
  // No label — a card's own text is already the sentence.
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{body}</Pressable> : body;
}

/** The primary action: a ring, two lines, one button. */
export function ActionCard({
  ring, ringLabel, ringNote, title, note, cta, onPress, tone,
}: {
  ring?: number;
  ringLabel?: string;
  /**
   * What the number in the ring COUNTS. Not decoration — required wherever the
   * ring measures something other than the card's own subject.
   *
   * This card is adaptive: on a "Fuel up" day the title and note are about
   * calories and the button says "Log a meal", while the ring's fill is
   * workouts-this-week and the number inside it is a day streak. Three
   * quantities, one card, and the number had no label at all — so a reader saw
   * "1" beside "Log a meal" and read it as one meal logged, which is what a
   * tester did and said so.
   */
  ringNote?: string;
  title: string; note?: string;
  cta: string; onPress: () => void; tone?: string;
}) {
  const t = useTheme();
  const mark = tone || t.brand;
  const R = 24, C = 2 * Math.PI * R;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg }}>
        {/* The column is NOT width:56 — that is the ring's width, and pinning
            the column to it clipped the caption to "DAY ST…". It sizes to
            whichever is wider, the ring or the word under it. */}
        {ring != null ? (
          // Same problem the Hero's arc had, and the same answer: the fill is a
          // proportion nobody says out loud, and the number inside it belongs to
          // a different quantity again. ringNote is what the number counts, so
          // it is what the element is called.
          <View style={{ alignItems: 'center' }}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={[ringLabel, ringNote].filter(Boolean).join(' ') || undefined}
            accessibilityValue={{ min: 0, max: 100, now: arcPct(ring) }}
          >
            {/* Grows with the reader's text: `ringLabel` is drawn inside it.
                Same reasoning as the Hero's arc above. */}
            <View style={{ width: grown(56), height: grown(56) }}>
              <Svg width={grown(56)} height={grown(56)} viewBox="0 0 56 56">
                <Circle cx="28" cy="28" r={R} fill="none" stroke={t.surface3} strokeWidth={2.5} />
                <Circle cx="28" cy="28" r={R} fill="none" stroke={mark} strokeWidth={2.5} strokeLinecap="round"
                  strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, ring)))}
                  transform="rotate(-90 28 28)" />
              </Svg>
              <View style={{ position: 'absolute', width: grown(56), height: grown(56), alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.head, ...numeric, color: t.ink }}>{ringLabel}</Text>
              </View>
            </View>
            {ringNote ? (
              <Text numberOfLines={linesAtScale(fontScale)} style={{ ...ty.micro, color: t.ink3, marginTop: 4, textAlign: 'center', letterSpacing: 0.4 }}>
                {ringNote}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{title}</Text>
          {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{note}</Text> : null}
        </View>
        <Cta label={cta} onPress={onPress} tone={mark} />
      </View>
    </Card>
  );
}

/** A row that reads as one line of a list: icon, two lines, chevron. */
export function ListRow({ icon, title, note, onPress, tone }: {
  icon: IconName; title: string; note?: string; onPress: () => void; tone?: string;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={note ? `${title}. ${note}` : title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
      {/* A circle, as the board draws every row's icon. */}
      <View style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={tone || t.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{title}</Text>
        {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{note}</Text> : null}
      </View>
      <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
    </Pressable>
  );
}

/* ── controls ─────────────────────────────────────────────────────────────── */

export function Cta({ label, onPress, tone, wide, disabled, a11yLabel }: {
  label: string; onPress: () => void; tone?: string; wide?: boolean; disabled?: boolean;
  /**
   * What to SAY, when the visible label is not enough on its own.
   *
   * A primary action is read out of context by a screen reader: "Cancel",
   * "Approve Session", "Join" — cancel what, approve whose, join which. The
   * visible label can lean on the row it sits in and the spoken one cannot, so
   * this is where the row's subject goes. Same prop, same precedence and same
   * reasoning as `Ghost` below.
   */
  a11yLabel?: string;
}) {
  const t = useTheme();
  return (
    // 11 + 18 + 11 is 40pt tall, four short of the minimum, and this is the
    // primary action on most screens — pressed one-handed, mid-set, with a wet
    // thumb. Slop rather than padding, so nothing in any layout moves.
    <Pressable onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={a11yLabel || label} accessibilityState={{ disabled: !!disabled }}
      hitSlop={{ top: 2, bottom: 2, left: 0, right: 0 }}
      style={{
        backgroundColor: disabled ? t.surface2 : (tone || t.brand), borderRadius: radius.sm,
        // A DISABLED PRIMARY ACTION HAS TO STILL LOOK LIKE A BUTTON.
        //
        // Reported from the gym floor: "how does a coach save a session they
        // have logged for a client as there is no save logged session button
        // for them to tap". There was one. It was this control, disabled,
        // drawn as `surface2` on a `surface`/`bg` ground with `ink3` text —
        // two greys a step apart and no edge between them — sitting below the
        // fold at the end of a long form. A person who scrolls to the bottom
        // and sees no button concludes there is no button, and they are not
        // being careless: nothing on screen said otherwise.
        //
        // The fix is an edge, not a colour: the fill and the ink stay exactly
        // as they were, so every contrast reading this component has ever been
        // measured at is unchanged, and the control simply acquires a shape.
        // "Not yet" and "not there" then look different, which is the whole
        // distinction the disabled state exists to draw.
        //
        // A hairline is deliberately not enough here — it disappears on the
        // greys involved — so this is the same 2× hairline the sheet's own tick
        // uses for an untapped set.
        ...(disabled ? { borderWidth: hairline * 2, borderColor: t.ring } : null),
        paddingVertical: 11, paddingHorizontal: wide ? 0 : sp.lg,
        alignItems: 'center', ...(wide ? { alignSelf: 'stretch' } : null),
      }}>
      <Text style={{ ...ty.label, fontWeight: '600', color: disabled ? t.ink3 : t.brandInk }}>{label}</Text>
    </Pressable>
  );
}

// What an icon-only button should be called out loud. `Ghost` renders no text
// when it has only an icon, and it passed `label` straight through as the
// accessibility label — so 65 buttons, 57 of them the back button on nearly
// every screen, announced themselves to VoiceOver as an unnamed "button".
//
// A screen with a genuinely unusual icon should pass `a11yLabel` rather than
// hope the name here fits.
const ICON_NAMES: Partial<Record<IconName, string>> = {
  back: 'Back', search: 'Search', share: 'Share', pencil: 'Edit', minus: 'Remove',
  message: 'Messages', chat: 'Messages', calendar: 'Calendar', bell: 'Notifications',
  plus: 'Add', settings: 'Settings', heart: 'Heart rate', camera: 'Camera',
  video: 'Video', chart: 'Charts', trophy: 'Records', clock: 'History',
  swap: 'Swap', sparkle: 'Suggestions', grid: 'More', chevron: 'More',
};

/** A low-emphasis button — no border, just a barely-there fill. */
/**
 * A form field with a label that STAYS.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every numeric box in this app named its unit in the placeholder — "Minutes",
 * "Distance (km)", "Watts (optional)", "kg". A placeholder is drawn only while
 * the field is EMPTY, so on any form that opens holding values already typed —
 * an edit sheet, a correction, anything read back from the log — all of them
 * are gone, and what is left is a column of bare numerals:
 *
 *     CARDIO   [ 43 ]  [ 12.7 ]
 *              [ 141 ]
 *
 * 43 minutes or 43 seconds; 12.7 km or miles; 141 watts, or a heart rate, which
 * is what 141 looks like. Nothing on the screen said, and the one place the
 * reader most needs the unit is the place they are about to CHANGE the number.
 * A guess that lands is a wrong figure saved over a right one.
 *
 * So the label is a sibling of the input rather than a property of it, and the
 * unit is part of the label rather than a hint inside the box. `hint` carries
 * what the placeholder should have carried all along — "optional", "leave blank
 * if unknown" — and is likewise always visible.
 *
 * The label is NOT repeated as an accessibility label on the input: VoiceOver
 * reads a `TextInput` together with the text above it, and doing both makes it
 * say the word twice. Pass `a11y` only where the visible label is too terse to
 * stand alone as a spoken sentence.
 */
export function Field({ label, hint, children, style, a11y, accessory }: {
  label: string;
  hint?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  a11y?: string;
  /** A control that belongs ON the label line rather than under it — the
   *  weight-unit toggle beside a load box. Sits after the label and before the
   *  hint, so a field can carry both. Nothing about the box below moves: the
   *  row it joins is already `alignItems: 'baseline'`. */
  accessory?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={[{ flex: 1 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 5 }}>
        <Text
          accessible
          accessibilityLabel={a11y ?? undefined}
          style={{ ...ty.micro, color: t.ink3 }}
        >
          {label}
        </Text>
        {accessory}
        {/* Not `ty.micro`: that face is uppercased, and an uppercased aside
            reads as loudly as the label it is qualifying — "CALORIES KCAL ·
            LEAVE BLANK IF UNKNOWN" is one shout where it should be a word and
            then a murmur. The label keeps the uppercase because it is the
            heading; the hint is a sentence and is set as one. */}
        {hint ? <Text style={{ ...ty.caption, color: t.ink3 }}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function Ghost({ label, onPress, icon, a11yLabel, disabled }: {
  label?: string; onPress: () => void; icon?: IconName; a11yLabel?: string;
  /**
   * Off, and visibly so.
   *
   * `Cta` has had this since it was written and `Ghost` had not, so a screen
   * with a control that must not be pressed yet — a minus button over a water
   * count that has not been read, where the tap writes an absolute figure
   * computed from an unread base — had no way to say it with the quiet form of
   * the button and had to say it with the loud one. Same three effects as
   * `Cta`: the press is refused, the state is announced, and the fill drops so
   * it does not merely look broken.
   */
  disabled?: boolean;
}) {
  const t = useTheme();
  const round = !label;
  // `a11yLabel` FIRST. It used to come second, so a caller that passed both got
  // the visible label read out and the spoken one silently discarded — which is
  // exactly what four buttons in the coach app were already doing: three
  // "Try Again" buttons that had been given "Try reading your clip library
  // again" and one that had been given the client's name. The prop existed for
  // icon-only buttons and quietly refused to do the other half of its job, so a
  // row of identical "Cancel" and "Leave" buttons could not be told apart.
  const spoken = a11yLabel || label || (icon ? ICON_NAMES[icon] ?? icon : undefined);
  return (
    // The round form is 38pt and the pill form 40pt tall; both are under 44, and
    // the round one is the back button on nearly every screen in the app.
    <Pressable onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={spoken}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={round ? hitSlopFor(38) : { top: 2, bottom: 2, left: 0, right: 0 }}
      style={{
        backgroundColor: t.surface2,
        borderRadius: round ? radius.pill : radius.sm,
        width: round ? ROUND : undefined, height: round ? ROUND : undefined,
        paddingVertical: round ? 0 : 11, paddingHorizontal: round ? 0 : sp.lg,
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: sp.sm,
        opacity: disabled ? 0.5 : 1,
      }}>
      {icon ? <Icon name={icon} size={round ? 18 : 15} color={disabled ? t.ink3 : t.ink2} /> : null}
      {label ? <Text style={{ ...ty.label, fontWeight: '500', color: disabled ? t.ink3 : t.ink }}>{label}</Text> : null}
    </Pressable>
  );
}

/** Icon tiles in a row. Quiet by default — these are shortcuts, not the point. */
export function QuickRow({ items }: { items: { icon: IconName; label: string; onPress: () => void }[] }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: sp.sm }}>
      {items.map((q) => (
        <Pressable key={q.label} onPress={q.onPress} accessibilityRole="button"
          style={{ flex: 1, alignItems: 'center', paddingVertical: sp.md, borderRadius: radius.md, backgroundColor: t.surface, borderWidth: hairline, borderColor: t.ring }}>
          <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={q.icon} size={17} color={t.brand} />
          </View>
          <Text style={{ ...ty.micro, letterSpacing: 0.3, color: t.ink2, marginTop: 7 }}>{q.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ── the dimmed half of a bottom sheet ────────────────────────────────────── */

/**
 * The tap-to-dismiss area above a bottom sheet.
 *
 * ── What this replaces, and why it is worth a component ───────────────────
 *
 * Sixty-eight times across the three apps, a sheet opens like this:
 *
 *     <Modal visible={open} transparent animationType="slide" …>
 *       <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={close} />
 *       <View style={sheet}>…</View>
 *
 * That `Pressable` has no children, so it has no text to be named by, and no
 * `accessibilityLabel` to name it instead. React Native does not treat that as
 * decoration: `Pressable` renders its View with `accessible={accessible !==
 * false}`, so an element with no label at all is still FOCUSABLE. What
 * VoiceOver finds when a sheet opens is an unnamed control covering the top
 * third to half of the screen, announced as nothing, which dismisses the sheet
 * if you double-tap it.
 *
 * So the reader who most needs to be told what is on screen gets, first, the
 * one element on it that says nothing — and the gesture that gets rid of it.
 *
 * ── Named rather than hidden, and why that is the default ─────────────────
 *
 * `src/ui/DateSheet.tsx` reached the other answer first and argued it well: it
 * hides its scrim, on the grounds that a full-screen touchable read out above
 * the sheet's own heading makes it sound as though the whole month were one
 * control, and that the Cancel button below is the accessible way out.
 *
 * That reasoning holds for DateSheet and does not generalise, which is why
 * `hidden` is here as an option and is not the default. These are `transparent`
 * slide-up modals: iOS gives them no swipe-to-dismiss and no system chrome, so
 * on a sheet whose only exit is the scrim — and there are several — hiding it
 * is not tidying the reading order, it is locking the reader in. A named button
 * is never a trap; an unnamed one is only ever a trap or a surprise. Pass
 * `hidden` where the sheet demonstrably has another way out, as DateSheet does,
 * and say which one in a comment.
 *
 * `label` is what the tap DOES, not where it is: "Close", "Cancel", "Discard
 * this draft". It is deliberately not defaulted to the sheet's title.
 */
export function Scrim({ onPress, label = 'Close', hidden, opacity = 0.55 }: {
  onPress: () => void;
  /** What tapping it does, in words. Read out before the sheet's heading. */
  label?: string;
  /** Take it out of the accessibility tree. Only where the sheet has another
   *  way out — see DateSheet, and say which one at the call site. */
  hidden?: boolean;
  /** How dark. 0.55 everywhere except two sheets drawn over a photo. */
  opacity?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      {...(hidden
        ? { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const }
        : { accessibilityRole: 'button' as const, accessibilityLabel: label })}
      style={{ flex: 1, backgroundColor: `rgba(0,0,0,${opacity})` }}
    />
  );
}

/* ── data marks ───────────────────────────────────────────────────────────── */

/**
 * A 3px meter. The track is a dim step of the fill, so state reads across the
 * whole bar rather than only where it's filled.
 */
export function Meter({ label, val, target, unit = 'g', dim }: {
  label: string; val: number; target: number; unit?: string; dim?: boolean;
}) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(100, Math.round((val / (target || 1)) * 100)));
  return (
    // "Protein" and "84 / 150g" are two stops that read as two unrelated facts,
    // and the 3px bar between them is the third — a proportion carried entirely
    // by how far a coloured line travels. One element, one sentence, and the
    // percentage said rather than drawn.
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}, ${plainExact(val)} of ${plainExact(target)}${unit}`}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ marginTop: sp.md }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ ...ty.caption, color: t.ink2 }}>{label}</Text>
        {/* `plainExact`, and the same in the label above, because these are
            grams of a macro and a challenge score in kilometres — both carry a
            decimal place, and a bare `{val}` writes an English full stop into a
            row whose other figures come from `num1` and `plain`. Separator
            only: a meter must not round what it was handed. */}
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{plainExact(val)} / {plainExact(target)}{unit}</Text>
      </View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
        <View style={{ height: 3, borderRadius: 2, width: `${pct}%`, backgroundColor: t.brand, opacity: dim ? 0.45 : 1 }} />
      </View>
    </View>
  );
}

/**
 * Single-series trend. 2px line, one recessive baseline, and an end dot ringed
 * in the ground colour so it stays legible where it crosses the rule. One
 * series needs no legend — the section title says what is plotted.
 */
/**
 * The line chart used across seven screens, and the one that says WHEN.
 *
 * ── What "show the date" means here, and why this shape ────────────────────
 *
 * Two readings, because a reader has two different questions and one answer
 * cannot serve both:
 *
 *   the axis      first and last always, and as many evenly spaced between
 *                 them as the measured width takes without the labels
 *                 touching. This answers "what period am I looking at",
 *                 scanned in a glance, without anybody touching anything.
 *   the readout   the exact date and value of one point, when a reader puts a
 *                 finger on it. It carries the year; the axis does not, because
 *                 six "14 Aug 2026"s across 320px is a smear.
 *
 * The axis is drawn HERE rather than by each caller. Four screens had already
 * hand-rolled a label row under a <Spark>, all four differently, and two of
 * them were wrong in the same way (see below). Fixing the component fixes every
 * caller at once and there is one date formatter left in the app instead of
 * five.
 *
 * ── A gap is a gap ────────────────────────────────────────────────────────
 *
 * `data` may contain nulls, and a null means NOBODY RECORDED THIS. It does not
 * mean zero, and it must not be deleted. src/lib/monthlyHistory.ts produces
 * those nulls deliberately and says so in capitals; three screens then drew the
 * series as `data.filter((v) => v != null)`, which did two things:
 *
 *   1. closed the line over the hole, so a gym with no February looked like a
 *      gym that traded through February;
 *   2. left the hand-rolled label row underneath rendering all six month slots
 *      evenly spaced, while the line now had four points across the same width.
 *      **Every point sat above the wrong month.** Not a missing date — a wrong
 *      one, which is worse, because there is nothing on screen to doubt.
 *
 * So x is a function of the ORIGINAL index, always. A hole keeps its slot, the
 * line breaks across it, a run of one is drawn as a lone dot, and the label
 * under a point is that point's own label because both come from one index.
 *
 * ── And it may not invent a date ──────────────────────────────────────────
 *
 * A label whose timestamp cannot be read is an em dash. Not today, not the
 * neighbour's, not the raw string printed as if it were a date — which is what
 * the formatter this replaced did. src/lib/chartAxis.ts holds that rule and the
 * test that keeps putting the bug back.
 *
 * `labels` stays optional and parallel to `data`. A caller with dates gets an
 * axis and "72.9 kg · 14 Aug 2026"; a caller without still gets the value, and
 * the hint line says only what is actually on offer.
 */
export function Spark({ data, h = 74, w = 320, labels, unit = '' }: {
  data: (number | null | undefined)[]; h?: number; w?: number;
  /** ISO dates ('2026-08-14' or '2026-08'), or short labels, parallel to `data`. */
  labels?: string[];
  unit?: string;
}) {
  const t = useTheme();
  const [sel, setSel] = useState<number | null>(null);
  const [boxW, setBoxW] = useState(w);

  const runs = segments(data);
  const drawn = readablePoints(data);
  const n = data.length;
  if (n < 2 || drawn.length < 1) return null;

  const vals = drawn.map((p) => p.v);
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const top = 8, bottom = h - 18;
  const x = (i: number) => 6 + (i / (n - 1)) * (w - 12);
  const y = (v: number) => bottom - ((v - min) / rng) * (bottom - top);
  const last = drawn[drawn.length - 1];

  // The SVG is drawn in viewBox units and stretched to the real width, so a
  // touch has to be scaled back before it means anything. It then SNAPS to the
  // nearest point that exists: a touch landing on a hole reports the real
  // reading beside it, at that reading's own date, rather than reporting a
  // value for a slot nobody measured.
  const pick = (px: number) => {
    const vx = (px / (boxW || w)) * w;
    const raw = Math.round(((vx - 6) / (w - 12)) * (n - 1));
    const near = nearestPoint(data, Math.max(0, Math.min(n - 1, raw)));
    setSel(near ? near.i : null);
  };

  const at = sel != null && sel >= 0 && sel < n ? sel : null;
  const shownPoint = at == null ? null : nearestPoint(data, at);
  // toLocaleString, not a bare number: a weekly tonnage reaches five digits and
  // the house rule is that anything which can pass a thousand is separated.
  const shownValue = shownPoint == null ? null
    : (Math.round(shownPoint.v * 10) / 10).toLocaleString(appLocale());
  const when = shownPoint == null || !labels ? null : pointLabel(labels[shownPoint.i]);

  // How many dates the axis carries is decided by the width it was actually
  // given, measured — not by the viewBox, which is a drawing unit and the same
  // 320 on every handset.
  // Fewer dates, not smaller ones. At 200% text a 54pt axis label holds "14 A…"
  // and the fix is not a smaller font — it is to stop trying to fit six labels
  // where three now belong. `maxTicksForWidth` already decides this from a
  // MEASURED width, so it is handed a width divided by the reader's text scale
  // rather than taught a second rule about type.
  const ticks = labels ? tickIndices(n, maxTicksForWidth(effectiveWidth(boxW || w, fontScale))) : [];
  const gapped = hasInteriorGap(data);

  return (
    <View onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {/* The readout sits above the line rather than floating on it: a tooltip
          over a 74px chart covers the thing it is describing. */}
      {/* One line of caption. Pinned at 16 it clipped the readout in half for
          anybody on Larger Text — the strip grows with the line it holds. */}
      <View style={{ height: grown(16), justifyContent: 'center' }}>
        {shownValue != null ? (
          <Text style={{ ...ty.caption, ...numeric, color: t.ink }}>
            {shownValue}{unit}{when ? ` · ${when}` : ''}
          </Text>
        ) : (
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            {labels ? 'Touch the line for a value and date' : 'Touch the line for a value'}
          </Text>
        )}
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={labels
          ? `Trend line, ${axisLabel(labels[drawn[0].i])} to ${axisLabel(labels[last.i])} — touch to read a point`
          : 'Trend line — touch to read a point'}
        // "adjustable" makes VoiceOver offer swipe-up and swipe-down, and until
        // now nothing was listening: the gesture was advertised and did nothing,
        // which is worse than not advertising it. These step through the points
        // that EXIST — a swipe skips a hole rather than reading it as a value,
        // the same rule the touch handler follows.
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const act = e.nativeEvent.actionName;
          if (act !== 'increment' && act !== 'decrement') return;
          const here = sel == null ? drawn[drawn.length - 1].i : sel;
          const at = drawn.findIndex((p) => p.i === here);
          const next = drawn[Math.max(0, Math.min(drawn.length - 1, (at < 0 ? drawn.length - 1 : at) + (act === 'increment' ? 1 : -1)))];
          if (next) setSel(next.i);
        }}
        accessibilityValue={{
          text: shownPoint == null
            ? `${(Math.round(last.v * 10) / 10).toLocaleString(appLocale())}${unit}${labels ? `, ${pointLabel(labels[last.i])}` : ''}`
            : `${shownValue}${unit}${when ? `, ${when}` : ''}`,
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        onResponderRelease={() => { /* the reading stays until the next touch */ }}
      >
        <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <Line x1={0} y1={h - 8} x2={w} y2={h - 8} stroke={t.ring} strokeWidth={1} />
          {/* One polyline per unbroken run. Two runs are two lines with air
              between them, and that air is the honest picture of a month
              nobody recorded. A run of one cannot be a line and is drawn as
              the dot it is — deleting it would erase the only evidence that
              the reading was ever taken. */}
          {runs.map((run, ri) => run.length >= 2 ? (
            <Polyline key={ri} points={run.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
              fill="none" stroke={t.brand} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <Circle key={ri} cx={x(run[0].i)} cy={y(run[0].v)} r={2.5} fill={t.brand} />
          ))}
          {shownPoint != null ? (
            <>
              <Line x1={x(shownPoint.i)} y1={top} x2={x(shownPoint.i)} y2={bottom} stroke={t.ring} strokeWidth={1} />
              <Circle cx={x(shownPoint.i)} cy={y(shownPoint.v)} r={6} fill={t.bg} />
              <Circle cx={x(shownPoint.i)} cy={y(shownPoint.v)} r={4} fill={t.ink} />
            </>
          ) : null}
          <Circle cx={x(last.i)} cy={y(last.v)} r={6} fill={t.bg} />
          <Circle cx={x(last.i)} cy={y(last.v)} r={4} fill={t.brand} />
        </Svg>
      </View>
      {/* The axis. Each label is placed at its own point's x fraction, so it
          sits under the thing it names; the two ends are pulled flush to the
          edges, where a centred box would be clipped by the container.

          rtl-ok: this strip is pinned LTR and stays on physical left/right.
          The line above it is an <Svg> in user-space coordinates and
          react-native-svg mirrors nothing, so the polyline runs oldest-on-the-
          left in every locale. Mirror the labels and every date sits under the
          wrong point — a chart that renders perfectly and is false, which is
          worse than one that leans the wrong way. `direction: 'ltr'` is what
          holds it: without it `alignItems: 'flex-start'` would flip on its own,
          because flex-start is a LOGICAL edge in Yoga even when left is not.
          See src/lib/direction.ts for the rule and what else it covers. */}
      {ticks.length ? (
        <View style={{ height: grown(14), marginTop: 3, direction: 'ltr' }}>
          {ticks.map((i) => {
            const end = i === 0 ? 'first' : i === n - 1 ? 'last' : null;
            const frac = (6 + (i / (n - 1)) * (w - 12)) / w;
            // rtl-ok: physical sides, under the `direction: 'ltr'` pin above.
            // These three placements are the x coordinates of the polyline
            // restated in layout terms, and the polyline is SVG user-space:
            // mirror one without the other and every label names a different
            // point than the one it sits under.
            const place: StyleProp<ViewStyle> = end === 'first' ? { left: 0, alignItems: 'flex-start' }
              : end === 'last' ? { right: 0, alignItems: 'flex-end' }
                : { left: `${frac * 100}%`, marginLeft: -grown(54) / 2, width: grown(54), alignItems: 'center' };
            return (
              <View key={i} style={[{ position: 'absolute', top: 0 }, place]}>
                <Text numberOfLines={1} style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3 }}>
                  {axisLabel(labels![i])}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {/* Said only where it is true. An even axis over an uneven series is the
          claim this whole component was rebuilt to stop making, so where the
          series really does have a hole the chart says which kind of hole. */}
      {gapped ? (
        <Text style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3, marginTop: 2 }}>
          A break in the line is a period with no reading — not a reading of zero.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One line of trouble, inline — the Notice idiom without the card.
 *
 * scale.ts: "Status colours are reserved for status and are never used as text
 * colour; a coloured mark sits beside ink-coloured text instead." Nineteen
 * places across eleven screens did the opposite, and measuring says the rule
 * was right twice over: t.crit as text is between 3.87:1 and 4.47:1 on all ten
 * palettes, so it fails AA everywhere it appeared. As a MARK it only needs
 * 3:1, which it clears everywhere. Same colour, same meaning, legible.
 */
export function Flag({ tone, children, style }: {
  tone?: string; children: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const mark = tone || t.crit;
  return (
    <View style={[{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-start' }, style]}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: mark, marginTop: 6, flexShrink: 0 }} />
      <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{children}</Text>
    </View>
  );
}

/** A quiet banner for something that needs attention. Tone marks it; text stays ink. */
export function Notice({ tone, kicker, title, note, children }: {
  tone?: string; kicker: string; title: string; note?: string; children?: ReactNode;
}) {
  const t = useTheme();
  const mark = tone || t.brand;
  return (
    <Card tone={mark} style={{ marginBottom: sp.md }}>
      {/* Kicker, title and note are one statement — "Not the whole list.
          Showing the first 200. There are more members than fit in one read."
          Three stops with a swipe between them is three fragments. `children`
          stays outside the group because it is usually a button, and a button
          inside an `accessible` View stops being reachable. */}
      <View accessible accessibilityLabel={[kicker, title, note].filter(Boolean).join('. ')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.sm }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: mark }} />
          <Text style={{ ...ty.micro, color: t.ink3 }}>{kicker}</Text>
        </View>
        <Text style={{ ...ty.head, color: t.ink }}>{title}</Text>
        {note ? <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>{note}</Text> : null}
      </View>
      {children}
    </Card>
  );
}

/**
 * What a screen puts on the page when a provider comes back 'partial'.
 *
 * Truncation had no shape a screen could draw, and the shapes that already
 * existed were both wrong for it: an error card says the read failed, which it
 * did not, and saying nothing says the list is complete, which it is not. The
 * rows below this banner are real and worth reading. What is not true is that
 * they are all of them, and that is the sentence a coach needs before they
 * count what they can see.
 *
 * `shown` is the number of rows actually on screen, not a total — deliberately
 * phrased as "the first N" rather than "N of M", because M is exactly the
 * figure a truncated read does not know. See src/lib/rowCap.ts.
 */
export function PartialRead({ what, shown, onPress }: {
  what: string; shown?: number; onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Notice
      tone={t.warn}
      kicker="Not the whole list"
      title={shown != null ? `Showing the first ${num(shown)}` : 'Showing part of the list'}
      note={`There are more ${what} than fit in one read. What is listed is real and current. The rest are on the server and not on this screen, so anything here that looks like a total is not one.`}
    >
      {onPress ? <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={onPress} /></View> : null}
    </Notice>
  );
}

/* ── the data-layout shapes ───────────────────────────────────────────────── */

/* The review of how real data is ordered on every screen — docs/claude-handoff/
 * CLAUDE-CODE-DATA-LAYOUT-AND-FLOW-REVIEW.md — asks for a small set of shared
 * shapes before any screen is touched, "through the existing theme and UI
 * files", and gives ten rules they have to hold. The ones below are the shapes
 * this kit did not have. Each is built out of the parts above it — Section,
 * SectionHead, Cta, Ghost, Flag's mark — so there is still one card, one
 * button and one dot in the app, and the rule each shape exists for is named
 * beside it so a later reader can check the component against the rule rather
 * than against a memory of it.
 */

/** The 6pt status mark: the same dot Hero, Flag and Notice draw. A mark and
 *  never the message — every caller below puts words beside it, and hides it
 *  from the screen reader, which gets the words. */
function Dot({ tone, top = 0 }: { tone: string; top?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone, marginTop: top, flexShrink: 0 }} />
  );
}

/**
 * One figure of a FigureCard, where a card holds more than one.
 *
 * That is money, and only money: the audit rule is that two currencies are
 * never summed, so "Total Taken" for a coach paid in AED and GBP is two
 * figures under one heading and there is no honest single one. Everything
 * else passes `figure` and never sees this type.
 */
export interface FigureItem {
  /** Stable key — the currency code. */
  key: string;
  /** Already spelled by the caller; null or undefined draws the dash. */
  figure: string | null | undefined;
  unit?: string;
  /** Already a sentence — see FigureCard's `comparison`. */
  comparison?: string;
  /** The comparison's mark. Absent, the quiet one. */
  tone?: string;
  /** The whole figure as one spoken sentence, where the caller can say it
   *  better than "title, figure, comparison" — "AED 4,800, 12 payments in AED
   *  in September". */
  spoken?: string;
}

/**
 * The metric summary: a card that leads with ONE figure and says what it is,
 * what it is measured in, how it moved, over what period and on whose word.
 *
 * ── Why this is a component ───────────────────────────────────────────────
 *
 * Round 3 retired `Hero` screen by screen in favour of "a Section figure
 * card": SectionHead, a `ty.hero` Text with `adjustsFontSizeToFit`, a unit in
 * `ty.head`, a note, and an `accessible` wrapper with a hand-joined sentence.
 * About fifteen screens now carry those fifteen lines, and they have already
 * drifted — one forgot the shrink-to-fit and wraps AED figures mid-number, two
 * colour the movement as TEXT in a status colour, which scale.ts forbids and
 * check:contrast only catches for warn and crit. This is that card, once.
 *
 * ── Rule 2: a metric with context, source and time ────────────────────────
 *
 * "78%" alone is not information; "Adherence · 78% · last 7 days · down 9
 * points" is. So the slots are the review's, in its order: the label is
 * `title`, then `figure` and `unit`, then `comparison`, then `period` and
 * `source` on one quiet line. None is invented when absent — a card with no
 * comparison draws no comparison, and never "no change", which is a claim.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * It will not compute. `comparison` arrives as the sentence `deltaLabel`
 * wrote — sign, unit, baseline and the three no-baseline arms all decided in
 * src/lib/deltaLabel.ts, where the test is — because a second place that
 * subtracts is a second place that subtracts two rounded ends. `figure`
 * arrives spelled (`minorMoney`, `weightLabel`, `num`) or null, and null is
 * the dash, by `fig()`: rule 5, unknown is not zero. When it IS the dash,
 * `detail` is where the caller says why — a dash with no reason beside it
 * reads as the screen having broken.
 *
 * ── Colour ────────────────────────────────────────────────────────────────
 *
 * `tone` colours the 6pt mark beside the comparison and nothing else. The
 * words stay ink: `t.brand` as 13pt text does not clear 4.5:1 on every
 * white-label palette, and "+2 cm" already says which way it went. Pass a
 * tone only for a VERDICT — movement the reader's own goal wanted — and leave
 * it off for a movement that is merely a fact.
 *
 * One spoken sentence for the whole figure, as Hero had: label, figure, unit,
 * comparison, detail, period, source. `children` sit outside that group,
 * because a label replaces its subtree and a button or a meter swept inside
 * it stops being reachable (rule 3 of scripts/check-a11y.mjs).
 */
export function FigureCard({
  title, note, onPress, figure, unit, comparison, period, source, tone, detail, figures, spoken, children,
}: {
  title: string;
  /** SectionHead's trailing note, and `onPress` makes it the way onward. */
  note?: string;
  onPress?: () => void;
  /** Spelled by the caller, or null. Null, undefined and NaN draw the dash. */
  figure?: string | null;
  unit?: string;
  /** A finished `deltaLabel` sentence — "−1.2 cm since 3 Aug". Never a number. */
  comparison?: string;
  /** "This month", "Last 30 days", "Measured 14 Aug". */
  period?: string;
  /** Whose word the figure is — "From your figures", "Mirrored from Stripe". */
  source?: string;
  /** The comparison's mark. */
  tone?: string;
  /** One sentence under the figure: what it counts, or why it is a dash. */
  detail?: string;
  /** Several figures under one heading — one per currency, never summed.
   *  Replaces `figure`/`unit`/`comparison`/`tone`. */
  figures?: FigureItem[];
  /** The spoken sentence, where the default joins the wrong things. */
  spoken?: string;
  /** Under the figure: a meter, a staleness note, a PartialRead, a button. */
  children?: ReactNode;
}) {
  const t = useTheme();
  const tail = [period, source].filter(Boolean).join(' · ');
  // The dash is an answer in a slot and a hole in a sentence (check:prose), and
  // VoiceOver reads "—" as nothing at all — so the ear gets the words.
  const say = (f: string | null | undefined, u?: string) => {
    const shown = fig(f);
    return shown === '—' ? 'no figure' : [shown, u].filter(Boolean).join(' ');
  };
  const one = (f: string | null | undefined, u?: string, cmp?: string, mark?: string) => (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        {/* Shrunk to fit and never wrapped — Hero's reasoning, above, in full:
            a money figure broken across two lines is a figure read wrong, and
            the floor is low because below it iOS ellipsises, and "AED 1,284,9…"
            is a different number. */}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.35}
          style={{ ...ty.hero, ...numeric, color: t.ink, flexShrink: 1 }}>{fig(f)}</Text>
        {u ? <Text numberOfLines={1} style={{ ...ty.head, color: t.ink3, marginStart: 6, letterSpacing: 0, flexShrink: 0 }}>{u}</Text> : null}
      </View>
      {/* UNDER the figure, not beside it. Beside it the two compete for one
          line, and either the money shrinks to make room for "+12% against
          August" or the comparison wraps into a column; under it both get the
          card's width at every text size. */}
      {cmp ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 3 }}>
          <Dot tone={mark || t.ink3} top={grown(6)} />
          <Text style={{ ...ty.label, ...numeric, fontWeight: '600', color: t.ink2, flex: 1 }}>{cmp}</Text>
        </View>
      ) : null}
    </>
  );
  return (
    <Section>
      <SectionHead title={title} note={note} onPress={onPress} />
      {figures && figures.length ? (
        <>
          {figures.map((f, i) => (
            <View key={f.key} accessible style={{ marginTop: i === 0 ? 0 : sp.md }}
              accessibilityLabel={f.spoken ?? [title, say(f.figure, f.unit), f.comparison].filter(Boolean).join(', ')}>
              {one(f.figure, f.unit, f.comparison, f.tone)}
            </View>
          ))}
          {detail ? <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{detail}</Text> : null}
          {tail ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{tail}</Text> : null}
        </>
      ) : (
        <View accessible
          accessibilityLabel={spoken ?? [title, say(figure, unit), comparison, detail, tail].filter(Boolean).join(', ')}>
          {one(figure, unit, comparison, tone)}
          {detail ? <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{detail}</Text> : null}
          {tail ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{tail}</Text> : null}
        </View>
      )}
      {children}
    </Section>
  );
}

/** What a write's state is called. Title Case, because it is a label beside a
 *  row and not a sentence in it. "Waiting to Send" rather than "Queued": the
 *  second is our word for it, and the first is what is happening to their set. */
const SYNC_WORDS = {
  queued: 'Waiting to Send',
  retrying: 'Retrying',
  failed: 'Not Sent',
  delivered: 'Sent',
} as const;

export type SyncState = keyof typeof SYNC_WORDS;

/**
 * The state of ONE write, beside the thing that was written.
 *
 * ── Rule 6: sync state beside affected data ───────────────────────────────
 *
 * The offline outbox tells a member that "3 things are waiting to send" in a
 * banner, and not WHICH three — so a coach looking at a client's Tuesday
 * cannot tell whether the workout that is missing was never done or has not
 * arrived. This is the small inline mark that goes on the workout, the
 * attendance tick, the message or the payment itself.
 *
 * ── Rule 9: never colour alone ────────────────────────────────────────────
 *
 * Words and a dot, always both. Four states are four colours only to somebody
 * who can tell warn from crit at 6pt in sunlight; the word is the state, and
 * the dot lets an eye find the one row in forty that has it. There is no
 * icon-only or dot-only form and no prop to get one.
 *
 * `label` replaces the words where the row can say more — "Sent 09:14",
 * "Not Sent · Tap to Retry" — and must still name the state, because it is
 * also what is spoken. Polite live region: a badge that turns from Retrying
 * to Not Sent while somebody is on the row is news, and not an interruption.
 *
 * It draws what it is TOLD. A badge left saying "Waiting to Send" after the
 * outbox has drained is a false statement about somebody's data, so pass
 * `state` from the queue's own answer and never from a flag set at tap time.
 */
export function SyncBadge({ state, label }: { state: SyncState; label?: string }) {
  const t = useTheme();
  const tone = state === 'failed' ? t.crit : state === 'retrying' ? t.warn : state === 'delivered' ? t.brand : t.ink3;
  const words = label ?? SYNC_WORDS[state];
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={words} accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' }}>
      <Dot tone={tone} />
      <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2, flexShrink: 1 }}>{words}</Text>
    </View>
  );
}

/**
 * One line of a "who needs me" list: who, WHY, how long, what state, one action.
 *
 * ── Rule 4: the reason beside the alert ───────────────────────────────────
 *
 * "Needs attention" with the reason one tap away is a list of names, and a
 * coach with forty clients opens forty records to find the two that matter.
 * The owner's Trainer Health board did exactly this: a score, a name, "At
 * risk" — and the sentence saying WHY ("6 sessions finished but unmarked")
 * was computed, and shown only in the sheet behind the row. So `reason` is
 * not optional here. A row with no reason to give is a ListRow.
 *
 * The order is the review's: name → reason → age and status → action.
 * `status` is words with the 6pt mark beside them (rule 9); `age` is how old
 * this is or when it falls due — "3 days", "Due Friday" — or the one count
 * that sizes it, in the quiet ink because it qualifies the status.
 * `sync` puts a SyncBadge on the row where the row IS the queued write.
 *
 * ── One action, and where it lives ────────────────────────────────────────
 *
 * The row opens the record; `action` is the one thing worth doing WITHOUT
 * opening it ("Message", "Mark Delivered"). It is a Ghost and not a Cta: ten
 * of these in a list would be ten primary buttons, and rule 1 allows a screen
 * one. It is a SIBLING of the pressable row rather than a child — a button
 * inside an `accessible` element is unreachable by VoiceOver — and it names
 * its subject when spoken ("Message, Dana Whitfield"), since a screen reader
 * meets ten identical "Message" buttons with nothing to tell them apart. At
 * large text it drops under the words so the name keeps the row's width.
 *
 * The name wraps to two lines and the reason to three: a long name is rule
 * 10's first test, and an ellipsis in the reason is rule 4 broken again.
 */
export function AttentionRow({
  monogram, avatar, icon, name, reason, age, status, tone, sync, action, onPress, divider,
}: {
  /** Initials, as the caller's own rule cuts them. Two characters are drawn. */
  monogram?: string;
  /** Anything round and about 40pt — a photo, a HealthPill. Wins over the others. */
  avatar?: ReactNode;
  icon?: IconName;
  name: string;
  reason: string;
  age?: string;
  status?: string;
  /** The status mark's colour. The words carry the meaning. */
  tone?: string;
  sync?: SyncState;
  action?: { label: string; onPress: () => void };
  onPress?: () => void;
  /** A hairline above — every row but the first. */
  divider?: boolean;
}) {
  const t = useTheme();
  const below = !!action && fontScale >= 1.35;
  const D = grown(40);
  const spoken = [name, reason, status, age, sync ? SYNC_WORDS[sync] : ''].filter(Boolean).join('. ');
  const identity = avatar ?? (monogram || icon ? (
    <View style={{ width: D, height: D, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
      {monogram
        // Array.from, not slice: a name that opens with an emoji or an
        // astral-plane letter is two UTF-16 units, and half of one is "�".
        ? <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>{Array.from(monogram).slice(0, 2).join('')}</Text>
        : <Icon name={icon!} size={18} color={tone || t.brand} />}
    </View>
  ) : null);
  const body = (
    <>
      {identity}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{name}</Text>
        <Text numberOfLines={linesAtScale(fontScale, 3)} style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{reason}</Text>
        {status || age ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 3 }}>
            {status ? <Dot tone={tone || t.ink3} top={grown(5)} /> : null}
            <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
              {status ? <Text style={{ color: t.ink2, fontWeight: '500' }}>{status}</Text> : null}
              {status && age ? ' · ' : ''}{age}
            </Text>
          </View>
        ) : null}
        {sync ? <View style={{ marginTop: sp.xs }}><SyncBadge state={sync} /></View> : null}
      </View>
      {onPress && !(action && !below) ? <Icon name={FORWARD_ICON} size={15} color={t.ink3} /> : null}
    </>
  );
  const rowStyle = { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: sp.md } as const;
  const act = action ? (
    <Ghost label={action.label} a11yLabel={`${action.label}, ${name}`} onPress={action.onPress} />
  ) : null;
  return (
    <View style={{ paddingVertical: sp.md, borderTopWidth: divider ? hairline : 0, borderTopColor: t.ring }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
        {onPress ? (
          <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={spoken} style={rowStyle}>{body}</Pressable>
        ) : (
          <View accessible accessibilityLabel={spoken} style={rowStyle}>{body}</View>
        )}
        {below ? null : act}
      </View>
      {below && act ? (
        <View style={{ flexDirection: 'row', marginTop: sp.sm, marginStart: identity ? D + sp.md : 0 }}>{act}</View>
      ) : null}
    </View>
  );
}

/**
 * The primary action block: what to do next, WHY, and one button to do it.
 *
 * ── Rule 1: one primary question, one dominant action ─────────────────────
 *
 * The review's stack for every primary screen is context → current state →
 * NEXT ACTION → evidence → tools, and the next action was the part with no
 * shape. ActionCard above is a ring, two lines and a small button at the
 * trailing edge — right for Home's adaptive nudge, and wrong here twice over:
 * the button is the smallest thing in it, and there is nowhere to put the
 * reason. An empty state's "Log a Workout" was a paragraph and a Cta in a bare
 * Section, hand-built each time, some with a title and some without.
 *
 * So: a title that names the action's SUBJECT, the reason in a sentence
 * ("the review needs your revenue for the month — every figure below is a
 * share of it"), one quiet line of `meta` (when, how long, where it is kept),
 * and a full-width Cta that cannot be mistaken for anything else. `secondary`
 * is the quiet way out and is a Ghost under it, never a second Cta beside it:
 * two equal buttons is a question, and this block exists to be an answer.
 *
 * A disabled `cta` keeps its shape (see Cta) — put WHY it is disabled in
 * `reason`, where the reader looks, rather than leaving a dead button to
 * explain itself. One of these per screen; a second means neither is primary.
 */
export function ActionBlock({ title, reason, meta, cta, secondary, children }: {
  title: string;
  reason?: string;
  meta?: string;
  cta: { label: string; onPress: () => void; disabled?: boolean; a11yLabel?: string };
  secondary?: { label: string; onPress: () => void };
  /** Between the words and the button — a field, a picker. Rarely. */
  children?: ReactNode;
}) {
  const t = useTheme();
  return (
    <Section>
      <Text accessibilityRole="header" style={{ ...ty.head, color: t.ink }}>{title}</Text>
      {reason ? <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.sm }}>{reason}</Text> : null}
      {meta ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{meta}</Text> : null}
      {children}
      <View style={{ marginTop: sp.lg }}>
        <Cta wide label={cta.label} onPress={cta.onPress} disabled={cta.disabled} a11yLabel={cta.a11yLabel} />
      </View>
      {secondary ? (
        <View style={{ marginTop: sp.sm }}>
          <Ghost label={secondary.label} onPress={secondary.onPress} />
        </View>
      ) : null}
    </Section>
  );
}

/**
 * Low-frequency tools, folded behind their own heading.
 *
 * ── Rule 7: progressive disclosure ────────────────────────────────────────
 *
 * "The first viewport should contain the decision, not the database." A coach
 * testing the app asked for this in as many words — "A way to minimise the
 * coaching tools so like a drop down" — about a grid of seven destinations
 * that sat between them and their client list every time they opened Home.
 * Nothing is removed by folding it: the review is explicit that a working
 * feature absent from the first viewport moves "into progressive disclosure or
 * its existing secondary route", and this is the first of those.
 *
 * The header is the whole control — a 44pt row, not a chevron to aim at — and
 * it is a button that says `expanded` or collapsed, which is the state a
 * screen reader otherwise has no way to learn (rule 9). `note` is one quiet
 * line saying what is inside, so nobody has to open it to find out it was not
 * what they wanted. The chevron turns through `turn()`, so it points the
 * reader's own forward when shut, and down when open, in either direction.
 *
 * ── What is inside is kept ────────────────────────────────────────────────
 *
 * The children are not mounted until the first opening — a folded tool should
 * cost nothing, and several of these run a read — and after that they are
 * HIDDEN on collapse rather than unmounted. A half-typed import or a picked
 * filter survives being folded away; `display: 'none'` takes the subtree out
 * of layout and out of the accessibility tree on both platforms, so nothing
 * folded can be swiped into.
 */
export function Expandable({ title, note, defaultOpen = false, children }: {
  title: string;
  note?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen);
  return (
    <Section>
      <Pressable
        onPress={() => { setMounted(true); setOpen((o) => !o); }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={note ? `${title}. ${note}` : title}
        style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, minHeight: 44, marginVertical: -sp.sm }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...ty.head, color: t.ink }}>{title}</Text>
          {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{note}</Text> : null}
        </View>
        <View style={{ transform: [{ rotate: turn(open ? 90 : 0) }] }}>
          <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
        </View>
      </Pressable>
      {mounted ? (
        <View style={{ display: open ? 'flex' : 'none', marginTop: sp.lg }}>{children}</View>
      ) : null}
    </Section>
  );
}

/**
 * The frame round a chart that decides whether there is a chart.
 *
 * ── Rules 5 and 10: unknown is not zero, and one point is not a trend ─────
 *
 * Every screen with a <Spark> carries the same ladder by hand — failed read,
 * too little history, otherwise draw — and they disagree. One screen folds
 * 'loading' into "could not be read"; one draws on a 'partial' read, which is
 * a line through the rows that happened to fit in one query, sloping
 * wherever the truncation put it; two say "not enough history" under a FAILED
 * read, which is a claim about the member's record that nobody checked.
 *
 * Five states, five different things on the page:
 *
 *   loading     a quiet line. Not the empty sentence — nothing is known yet.
 *   error       the read failed. Marked, and never "no data".
 *   partial     some of it came back. Marked, and NOT drawn: a trend over part
 *               of a series is a wrong trend, not a shorter one.
 *   no points   `emptyLine` — a whole read with nothing in it, which is the
 *               only state in which "nothing recorded yet" is a fact.
 *   one point   said as the reading it is. A line needs two ends.
 *
 * and `children` — the chart — on a whole read with two points or more, and
 * at no other time. `points` is the count of READINGS, not of slots: a
 * six-month series with two recorded months has two. `isWhole` is the gate,
 * the same function check:whole holds every figure in the app to.
 *
 * The three failure sentences have defaults that are true of any chart;
 * `emptyLine` has none, because what an empty one means is the caller's to
 * say. Error and partial take Flag's mark so the two that are FAULTS look
 * different from the two that are merely early — in shape, not only in words.
 */
export function ChartShell({ status, points, emptyLine, partialLine, errorLine, onePointLine, loadingLine, children }: {
  status: LoadStatus;
  /** How many real readings the series holds. Nulls are not readings. */
  points: number;
  emptyLine: string;
  partialLine?: string;
  errorLine?: string;
  onePointLine?: string;
  loadingLine?: string;
  children: ReactNode;
}) {
  const t = useTheme();
  const quiet = (line: string) => <Text style={{ ...ty.label, color: t.ink3 }}>{line}</Text>;
  if (status === 'loading') return quiet(loadingLine ?? 'Reading…');
  if (status === 'error') {
    return <Flag>{errorLine ?? 'This could not be read, so no trend is drawn. That is a read that failed, not a record with nothing in it.'}</Flag>;
  }
  if (!isWhole(status)) {
    return <Flag tone={t.warn}>{partialLine ?? 'Only part of this came back, so the trend is held back rather than drawn through the part that did.'}</Flag>;
  }
  if (points <= 0) return quiet(emptyLine);
  if (points === 1) return quiet(onePointLine ?? 'One reading so far. The trend appears from the second one.');
  return <>{children}</>;
}

/** One segment of a Segmented bar. */
export interface Segment<K extends string = string> {
  key: K;
  label: string;
  /** What to say when the label is an abbreviation — "Last 3 months" for "3M". */
  a11yLabel?: string;
  /** A segment that GOES somewhere instead of selecting — Photos, on a bar of
   *  three series and one other screen. It never draws as selected. */
  onPress?: () => void;
  disabled?: boolean;
}

/**
 * The board's segmented bar: a `surface2` pill of equal segments, the chosen
 * one filled in ink.
 *
 * About twenty screens build this by hand — the same `tablist` View, the same
 * `seg(on)` style, the same ternary on `t.bg` — and the copies disagree in the
 * ways that matter: some have the tab roles and some have none, a few cap the
 * label at one line with no shrink so "Body Fat" becomes "Body F…", and none
 * of them does anything at all about large text.
 *
 * ── Rule 8: the filter stays attached to its data ─────────────────────────
 *
 * This is a LOCAL control: it sits on the card or over the list it changes,
 * and its state is the caller's — `value` in, `onChange` out — so the screen
 * decides whether a range survives leaving the page. It is a tablist of tabs
 * with `selected` said on each, which is the state a colour fill cannot give
 * a screen reader (rule 9): selected is ink on the ground colour, 600 weight,
 * AND announced.
 *
 * ── Large text ────────────────────────────────────────────────────────────
 *
 * Four equal segments on a 390pt phone are 85pt each, and "Body Fat" at 1.35
 * is not. The label first gives up 15% — below that floor iOS ellipsises, so
 * the floor is high and the bar does the rest: from 1.35 the segments WRAP,
 * two to a row, in a rounded box rather than a pill. `scroll` is the other
 * answer, for a set whose length is the data's (a day's meal slots, a
 * programme's weeks) and could be seven: the bar scrolls sideways, segments
 * sized to their words. It is opt-in and not the default for the reason
 * ChipGrid gives — a row you must drag to discover hides its tail — and it
 * earns the exception only because the selected segment is always on screen
 * to show the row is a row.
 */
export function Segmented<K extends string>({ options, value, onChange, scroll, style }: {
  options: readonly Segment<K>[];
  value: K | null | undefined;
  onChange: (key: K) => void;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const wrap = !scroll && fontScale >= 1.35 && options.length > 2;
  const segs = options.map((o, i) => {
    const on = !o.onPress && o.key === value;
    return (
      <Pressable key={`${o.key}-${i}`}
        onPress={o.onPress ?? (() => onChange(o.key))}
        disabled={o.disabled}
        accessibilityRole="tab"
        accessibilityLabel={o.a11yLabel ?? o.label}
        accessibilityState={{ selected: on, disabled: !!o.disabled }}
        // 40pt tall; the slop makes it 44 without moving anything round it.
        hitSlop={{ top: 2, bottom: 2, left: 0, right: 0 }}
        style={{
          // Scrolling, a segment is as wide as its words and GROWS, so three
          // short ones still fill the bar; wrapping, two share a row; otherwise
          // they are equal, which is what makes it read as one control.
          ...(scroll ? { flexGrow: 1 } : wrap ? { flexGrow: 1, flexBasis: '45%' } : { flex: 1 }),
          minHeight: grown(40), paddingHorizontal: scroll ? sp.lg : sp.xs,
          alignItems: 'center', justifyContent: 'center',
          borderRadius: wrap ? radius.sm : radius.pill,
          backgroundColor: on ? t.ink : 'transparent',
          opacity: o.disabled ? 0.5 : 1,
        }}>
        <Text numberOfLines={1} adjustsFontSizeToFit={!scroll} minimumFontScale={0.85}
          style={{ ...ty.label, ...numeric, fontWeight: on ? '600' : '500', color: on ? t.bg : t.ink2, textAlign: 'center' }}>
          {o.label}
        </Text>
      </Pressable>
    );
  });
  const bar: ViewStyle = { backgroundColor: t.surface2, borderRadius: wrap ? radius.md : radius.pill, padding: 3 };
  return scroll ? (
    <View style={[bar, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist"
        keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        {segs}
      </ScrollView>
    </View>
  ) : (
    <View accessibilityRole="tablist" style={[bar, { flexDirection: 'row', flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>
      {segs}
    </View>
  );
}
