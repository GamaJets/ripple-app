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
  return <View style={{ height: hairline, backgroundColor: t.ring, marginLeft: inset }} />;
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
        <Pressable onPress={onPress} disabled={!onPress} hitSlop={8}>
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
export function Hero({
  label, figure, unit, note, arc, tone, onPress,
}: {
  label: string; figure: string; unit?: string; note?: string;
  arc?: number; tone?: string; onPress?: () => void;
}) {
  const t = useTheme();
  const mark = tone || t.brand;
  const R = 31, C = 2 * Math.PI * R;
  return (
    <Pressable onPress={onPress} disabled={!onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.xl, paddingTop: sp.xxl, paddingBottom: sp.xl }}>
      <View style={{ flex: 1 }}>
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
        <Svg width={72} height={72} viewBox="0 0 72 72">
          <Circle cx="36" cy="36" r={R} fill="none" stroke={t.surface3} strokeWidth={3} />
          <Circle cx="36" cy="36" r={R} fill="none" stroke={mark} strokeWidth={3} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, arc)))}
            transform="rotate(-90 36 36)" />
        </Svg>
      ) : null}
    </Pressable>
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
      {items.map((k, i) => (
        <Pressable key={k.label} onPress={() => onPress?.(k)} disabled={!onPress || !k.route}
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
      ))}
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
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
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
          <View style={{ alignItems: 'center' }}>
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
    <Pressable onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
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
export function Ghost({ label, onPress, icon, a11yLabel }: {
  label?: string; onPress: () => void; icon?: IconName; a11yLabel?: string;
}) {
  const t = useTheme();
  const round = !label;
  const spoken = label || a11yLabel || (icon ? ICON_NAMES[icon] ?? icon : undefined);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={spoken}
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
        <Pressable key={q.label} onPress={q.onPress}
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
    <View style={{ marginTop: sp.md }}>
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
 * The line chart used across seven screens.
 *
 * Touch it and it reads out the point you are on. Before, a chart was shape
 * only — a member could see weight had gone down and had no way to ask by how
 * much, or when. It was reported twice, from two different screens: "points on
 * the graph have a numerical value to use to see how much of a change has
 * happened" and "should be able to tap on any given chart and see the numerical
 * value and the date associated with the value".
 *
 * `labels` is optional and parallel to `data`. Callers that have dates pass
 * them and get "72.9 kg · 14 Aug"; callers that do not still get the value.
 * Every existing call site keeps working untouched.
 */
export function Spark({ data, h = 74, w = 320, labels, unit = '' }: {
  data: number[]; h?: number; w?: number;
  /** ISO dates (or any short label) parallel to `data`. */
  labels?: string[];
  unit?: string;
}) {
  const t = useTheme();
  const [sel, setSel] = useState<number | null>(null);
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const top = 8, bottom = h - 18;
  const x = (i: number) => 6 + (i / (data.length - 1)) * (w - 12);
  const y = (v: number) => bottom - ((v - min) / rng) * (bottom - top);
  const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const lx = x(data.length - 1), ly = y(data[data.length - 1]);

  // The SVG is drawn in viewBox units and stretched to the real width, so a
  // touch has to be scaled back before it means anything.
  const [boxW, setBoxW] = useState(w);
  const pick = (px: number) => {
    const vx = (px / (boxW || w)) * w;
    const i = Math.round(((vx - 6) / (w - 12)) * (data.length - 1));
    setSel(Math.max(0, Math.min(data.length - 1, i)));
  };

  const at = sel == null ? null : sel;
  const shown = at == null ? null : data[at];
  const when = at == null || !labels ? null : sparkLabel(labels[at]);

  return (
    <View onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {/* The readout sits above the line rather than floating on it: a tooltip
          over a 74px chart covers the thing it is describing. */}
      <View style={{ height: 16, justifyContent: 'center' }}>
        {shown != null ? (
          <Text style={{ ...ty.caption, ...numeric, color: t.ink }}>
            {Math.round(shown * 10) / 10}{unit}{when ? ` · ${when}` : ''}
          </Text>
        ) : (
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            {labels ? 'Touch the line for a value and date' : 'Touch the line for a value'}
          </Text>
        )}
      </View>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Trend line — touch to read a point"
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        onResponderRelease={() => { /* the reading stays until the next touch */ }}
      >
        <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <Line x1={0} y1={h - 8} x2={w} y2={h - 8} stroke={t.ring} strokeWidth={1} />
          <Polyline points={pts} fill="none" stroke={t.brand} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {at != null ? (
            <>
              <Line x1={x(at)} y1={top} x2={x(at)} y2={bottom} stroke={t.ring} strokeWidth={1} />
              <Circle cx={x(at)} cy={y(data[at])} r={6} fill={t.bg} />
              <Circle cx={x(at)} cy={y(data[at])} r={4} fill={t.ink} />
            </>
          ) : null}
          <Circle cx={lx} cy={ly} r={6} fill={t.bg} />
          <Circle cx={lx} cy={ly} r={4} fill={t.brand} />
        </Svg>
      </View>
    </View>
  );
}

/** "2026-08-14" → "14 Aug". Anything unparseable is shown as given. */
function sparkLabel(raw: string | undefined): string {
  if (!raw) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw).trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(raw);
  if (isNaN(d.getTime())) return String(raw);
  return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
}

/** Seven day-cells; filled ones are days trained. */
export function WeekDots({ done }: { done: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 5, marginTop: sp.md }}>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.sm }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: mark }} />
        <Text style={{ ...ty.micro, color: t.ink3 }}>{kicker}</Text>
      </View>
      <Text style={{ ...ty.head, color: t.ink }}>{title}</Text>
      {note ? <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>{note}</Text> : null}
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
      {onPress ? <View style={{ marginTop: sp.md }}><Ghost label="Try again" onPress={onPress} /></View> : null}
    </Notice>
  );
}
