// ── The kit ──────────────────────────────────────────────────────────────────
// Screen-level primitives built on `theme/scale`. Screens compose these instead
// of hand-rolling a card out of inline styles for the 3,815th time.
//
// The look is "instrument panel": the data is the only thing with ink on it.
// Chrome recedes — sections are separated by air and a hairline rather than
// boxed, and a real card is spent only on something you can act on. Accent
// colour marks the live metric and the primary action, and nothing else.
import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, type ViewStyle, type StyleProp } from 'react-native';
import Svg, { Circle, Polyline, Line } from 'react-native-svg';
import { useTheme } from './components';
import { Icon, type IconName } from './Icon';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../theme/scale';
import { hitSlopFor } from '../lib/a11y';
import {
  axisLabel, pointLabel, tickIndices, maxTicksForWidth,
  segments, readablePoints, hasInteriorGap, nearestPoint,
} from '../lib/chartAxis';

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
 */
export function fig(v: number | string | null | undefined): string {
  if (v == null) return '—';
  if (typeof v === 'number' && !Number.isFinite(v)) return '—';
  const s = String(v);
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
      style={{ height: hairline, backgroundColor: t.ring, marginLeft: inset }}
    />
  );
}

/** Vertical rhythm between sections. Pairs with <Rule/>. */
export function Section({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ paddingVertical: layout.section }, style]}>{children}</View>;
}

/**
 * A section's header: a quiet uppercase title on the left, and an optional
 * tappable trailing note (a summary figure, "All activity ›") on the right.
 */
export function SectionHead({ title, note, onPress }: { title: string; note?: string; onPress?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: sp.lg }}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>{title}</Text>
      {note ? (
        // The chevron is drawn as a character, so it is also SPOKEN as one —
        // "All activity right-pointing angle quotation mark". The label says the
        // words and the role says it is a button, which is what the glyph was
        // there to convey. 12pt of caption plus this slop reaches 44pt.
        <Pressable
          onPress={onPress} disabled={!onPress}
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={onPress ? note : undefined}
          hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
        >
          <Text style={{ ...ty.caption, color: t.ink3 }}>{note}{onPress ? ' ›' : ''}</Text>
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
          <Text style={{ ...ty.hero, ...numeric, color: t.ink }}>{figure}</Text>
          {unit ? <Text style={{ ...ty.head, color: t.ink3, marginLeft: 6, letterSpacing: 0 }}>{unit}</Text> : null}
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
          style={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}
        >
          <Svg width={72} height={72} viewBox="0 0 72 72" style={{ position: 'absolute' }}>
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
            paddingRight: sp.md,
            paddingLeft: i === 0 ? 0 : sp.lg,
            borderLeftWidth: i === 0 ? 0 : hairline,
            borderLeftColor: t.ring,
          }}>
          <Text style={{ ...ty.caption, color: t.ink3 }}>{k.label}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 5 }}>
            <Text style={{ ...value(22), color: t.ink }}>{k.value}</Text>
            {k.unit ? <Text style={{ ...ty.caption, color: t.ink3, marginLeft: 2 }}>{k.unit}</Text> : null}
          </View>
          {k.delta ? (
            // Two lines, and the mark aligned to the first of them. Three
            // columns on a 390pt phone give a delta roughly 14 characters at
            // caption size, and one line silently ate the rest: "no session
            // fee set" arrived as "no session fe…", which is not a sentence
            // and not a fact. Anything genuinely longer still truncates, but
            // the useful notes now fit.
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 4 }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, marginTop: 5, flexShrink: 0, backgroundColor: k.good ? t.brand : t.ink3 }} />
              <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }} numberOfLines={2}>{k.delta}</Text>
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
      ...(tone ? { borderWidth: hairline, borderColor: tone } : null),
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
            <View style={{ width: 56, height: 56 }}>
              <Svg width={56} height={56} viewBox="0 0 56 56">
                <Circle cx="28" cy="28" r={R} fill="none" stroke={t.surface3} strokeWidth={2.5} />
                <Circle cx="28" cy="28" r={R} fill="none" stroke={mark} strokeWidth={2.5} strokeLinecap="round"
                  strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, ring)))}
                  transform="rotate(-90 28 28)" />
              </Svg>
              <View style={{ position: 'absolute', width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.head, ...numeric, color: t.ink }}>{ringLabel}</Text>
              </View>
            </View>
            {ringNote ? (
              <Text numberOfLines={1} style={{ ...ty.micro, color: t.ink3, marginTop: 4, textAlign: 'center', letterSpacing: 0.4 }}>
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
      <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={tone || t.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{title}</Text>
        {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{note}</Text> : null}
      </View>
      <Icon name="chevron" size={16} color={t.ink3} />
    </Pressable>
  );
}

/* ── controls ─────────────────────────────────────────────────────────────── */

export function Cta({ label, onPress, tone, wide, disabled }: {
  label: string; onPress: () => void; tone?: string; wide?: boolean; disabled?: boolean;
}) {
  const t = useTheme();
  return (
    // 11 + 18 + 11 is 40pt tall, four short of the minimum, and this is the
    // primary action on most screens — pressed one-handed, mid-set, with a wet
    // thumb. Slop rather than padding, so nothing in any layout moves.
    <Pressable onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      hitSlop={{ top: 2, bottom: 2, left: 0, right: 0 }}
      style={{
        backgroundColor: disabled ? t.surface2 : (tone || t.brand), borderRadius: radius.sm,
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
export function Field({ label, hint, children, style, a11y }: {
  label: string;
  hint?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  a11y?: string;
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

export function Ghost({ label, onPress, icon, a11yLabel }: {
  label?: string; onPress: () => void; icon?: IconName; a11yLabel?: string;
}) {
  const t = useTheme();
  const round = !label;
  const spoken = label || a11yLabel || (icon ? ICON_NAMES[icon] ?? icon : undefined);
  return (
    // The round form is 38pt and the pill form 40pt tall; both are under 44, and
    // the round one is the back button on nearly every screen in the app.
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={spoken}
      hitSlop={round ? hitSlopFor(38) : { top: 2, bottom: 2, left: 0, right: 0 }}
      style={{
        backgroundColor: t.surface2,
        borderRadius: round ? radius.pill : radius.sm,
        width: round ? 38 : undefined, height: round ? 38 : undefined,
        paddingVertical: round ? 0 : 11, paddingHorizontal: round ? 0 : sp.lg,
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: sp.sm,
      }}>
      {icon ? <Icon name={icon} size={round ? 18 : 15} color={t.ink2} /> : null}
      {label ? <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{label}</Text> : null}
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
          style={{ flex: 1, alignItems: 'center', paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
          <Icon name={q.icon} size={18} color={t.ink2} />
          <Text style={{ ...ty.micro, letterSpacing: 0.3, color: t.ink2, marginTop: 7 }}>{q.label}</Text>
        </Pressable>
      ))}
    </View>
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
      accessibilityLabel={`${label}, ${val} of ${target}${unit}`}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ marginTop: sp.md }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ ...ty.caption, color: t.ink2 }}>{label}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{val} / {target}{unit}</Text>
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
    : (Math.round(shownPoint.v * 10) / 10).toLocaleString('en-GB');
  const when = shownPoint == null || !labels ? null : pointLabel(labels[shownPoint.i]);

  // How many dates the axis carries is decided by the width it was actually
  // given, measured — not by the viewBox, which is a drawing unit and the same
  // 320 on every handset.
  const ticks = labels ? tickIndices(n, maxTicksForWidth(boxW || w)) : [];
  const gapped = hasInteriorGap(data);

  return (
    <View onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {/* The readout sits above the line rather than floating on it: a tooltip
          over a 74px chart covers the thing it is describing. */}
      <View style={{ height: 16, justifyContent: 'center' }}>
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
            ? `${(Math.round(last.v * 10) / 10).toLocaleString('en-GB')}${unit}${labels ? `, ${pointLabel(labels[last.i])}` : ''}`
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
          edges, where a centred box would be clipped by the container. */}
      {ticks.length ? (
        <View style={{ height: 14, marginTop: 3 }}>
          {ticks.map((i) => {
            const end = i === 0 ? 'first' : i === n - 1 ? 'last' : null;
            const frac = (6 + (i / (n - 1)) * (w - 12)) / w;
            const place: StyleProp<ViewStyle> = end === 'first' ? { left: 0, alignItems: 'flex-start' }
              : end === 'last' ? { right: 0, alignItems: 'flex-end' }
                : { left: `${frac * 100}%`, marginLeft: -27, width: 54, alignItems: 'center' };
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

/** Seven day-cells; filled ones are days trained. */
export function WeekDots({ done }: { done: number }) {
  const t = useTheme();
  // Seven 3px bars, and the only difference between a day trained and a day not
  // is which of two colours the bar is. Nothing else on screen says the number,
  // so to a screen reader this component was silent and to anyone who cannot
  // separate the accent from surface3 it was seven identical dashes.
  const n = Math.max(0, Math.min(7, Math.round(done)));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={n === 1 ? '1 of 7 days trained this week' : `${n} of 7 days trained this week`}
      accessibilityValue={{ min: 0, max: 7, now: n }}
      style={{ flexDirection: 'row', gap: 5, marginTop: sp.md }}
    >
      {Array.from({ length: 7 }).map((_, i) => (
        <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i < done ? t.brand : t.surface3 }} />
      ))}
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
      title={shown != null ? `Showing the first ${shown.toLocaleString()}` : 'Showing part of the list'}
      note={`There are more ${what} than fit in one read. What is listed is real and current. The rest are on the server and not on this screen, so anything here that looks like a total is not one.`}
    >
      {onPress ? <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={onPress} /></View> : null}
    </Notice>
  );
}
