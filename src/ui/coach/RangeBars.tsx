// The bar chart under Client Adherence on the coach's Analytics screen.
//
// `Spark` in src/ui/kit.tsx is the line, and the board draws adherence as
// BARS — one per day or week of the window, with the same period of the window
// before drawn faintly beside it, which is how the board's chart comes to have
// two greens. This is that drawing on Spark's rules, which are the rules that
// matter more than the shape:
//
//   · x is a function of the ORIGINAL index. A period nobody checked in on
//     keeps its slot and draws as a gap, never as a bar of nought — a bar of
//     nought is a specific and damaging claim, that everybody said they did
//     nothing. A counted zero (a period with no logged sessions under a whole
//     read) is a different thing and is passed in as 0, which draws as a stub
//     so the slot reads "measured, and none".
//   · The axis is src/lib/chartAxis.ts's: first and last always, as many
//     between as the MEASURED width takes, and a label never invents a date.
//   · A touch reads a bar — value and period — in the strip above the chart,
//     never in a tooltip over the thing it describes. VoiceOver steps through
//     the bars that exist with swipe up and down, because "adjustable" without
//     a listener advertises a gesture that does nothing.
//
// The scale is 0 to `max` (100 for a percentage) or to the tallest bar, so
// the picture is of the whole range and a good week and a bad one are the
// heights they are — a bar chart that zooms in on its own variance turns a
// 90-to-94 week into a collapse.
import { useState } from 'react';
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { useTheme } from '../components';
import { type as ty, numeric, fontScale, grown } from '../../theme/scale';
import { effectiveWidth } from '../../lib/typeScale';
import { appLocale } from '../../lib/locale';
import {
  axisLabel, pointLabel, tickIndices, maxTicksForWidth, readablePoints, type Series,
} from '../../lib/chartAxis';

export function RangeBars({ data, prior, labels, unit = '', max, what, priorNote, h = 96, w = 320 }: {
  /** One per period. Null is a gap; 0 is a counted zero. */
  data: Series;
  /** The same periods of the window before, drawn faintly beside each bar.
   *  Null when that window did not come back whole — the bars are then drawn
   *  alone rather than beside a comparison that may be short. */
  prior?: Series | null;
  /** ISO days ('2026-08-14'), parallel to `data`. The axis reads them itself. */
  labels: string[];
  unit?: string;
  /** Top of the scale. Omitted, the tallest bar sets it. */
  max?: number;
  /** What is plotted, for the ear: "Client adherence". */
  what: string;
  /** How the faint bar is described in the readout: "the 30 days before". */
  priorNote?: string;
  h?: number;
  w?: number;
}) {
  const t = useTheme();
  const [sel, setSel] = useState<number | null>(null);
  const [boxW, setBoxW] = useState(w);

  const drawn = readablePoints(data);
  const n = data.length;
  if (n < 1 || drawn.length < 1) return null;

  const priorPts = prior ? readablePoints(prior) : [];
  const tallest = Math.max(1, ...drawn.map((p) => p.v), ...priorPts.map((p) => p.v));
  const top = max != null && max > 0 ? max : tallest;
  const padTop = 6, base = h - 18;
  const slot = (w - 12) / n;
  // Two bars share a slot when there is a comparison: the faint one first, the
  // window's own second, so the eye reads "then, now" left to right.
  const pair = priorPts.length > 0;
  const gap = Math.min(4, slot * 0.25);
  const barW = Math.max(1, (slot - gap) / (pair ? 2 : 1));
  const x = (i: number) => 6 + i * slot + gap / 2;
  const height = (v: number) => Math.max(1.5, ((Math.min(v, top)) / top) * (base - padTop));
  // The approved mockup's bars have a 4pt shoulder. Capped at half the bar so a
  // 1Y window's narrow bars stay bars and do not become lozenges.
  const rx = Math.min(4, barW / 2);
  const last = drawn[drawn.length - 1];

  // Viewbox units back from the measured width, then the slot under the finger
  // — snapped to the nearest bar that EXISTS, so a touch on a gap reports the
  // real period beside it rather than a value for a slot nobody recorded.
  const pick = (px: number) => {
    const vx = (px / (boxW || w)) * w;
    const raw = Math.max(0, Math.min(n - 1, Math.floor((vx - 6) / slot)));
    const near = drawn.reduce((best, p) => (Math.abs(p.i - raw) < Math.abs(best.i - raw) ? p : best), drawn[0]);
    setSel(near.i);
  };

  const at = sel != null && sel >= 0 && sel < n ? sel : null;
  const shown = at == null ? null : drawn.find((p) => p.i === at) ?? null;
  const spell = (v: number) => (Math.round(v * 10) / 10).toLocaleString(appLocale());
  const priorAt = (i: number): number | null => {
    const p = prior?.[i];
    return typeof p === 'number' && Number.isFinite(p) ? p : null;
  };
  const readout = (p: { i: number; v: number }): string => {
    const before = priorAt(p.i);
    const was = before == null || !priorNote ? '' : ` · was ${spell(before)}${unit} ${priorNote}`;
    return `${spell(p.v)}${unit} · ${pointLabel(labels[p.i])}${was}`;
  };

  const ticks = tickIndices(n, maxTicksForWidth(effectiveWidth(boxW || w, fontScale)));

  return (
    <View onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {/* The readout sits above the bars. It grows with the reader's text
          rather than being pinned, so Larger Text does not clip it in half. */}
      <View style={{ height: grown(16), justifyContent: 'center' }}>
        {shown != null ? (
          <Text style={{ ...ty.caption, ...numeric, color: t.ink }}>{readout(shown)}</Text>
        ) : (
          <Text style={{ ...ty.caption, color: t.ink3 }}>Touch a bar for its value and period</Text>
        )}
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${what}, ${axisLabel(labels[drawn[0].i])} to ${axisLabel(labels[last.i])}${pair ? `, each beside the same period of ${priorNote ?? 'the window before'}` : ''}. Touch to read a bar`}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const act = e.nativeEvent.actionName;
          if (act !== 'increment' && act !== 'decrement') return;
          const here = sel == null ? last.i : sel;
          const k = drawn.findIndex((p) => p.i === here);
          const next = drawn[Math.max(0, Math.min(drawn.length - 1, (k < 0 ? drawn.length - 1 : k) + (act === 'increment' ? 1 : -1)))];
          if (next) setSel(next.i);
        }}
        accessibilityValue={{ text: readout(shown ?? last) }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        onResponderRelease={() => { /* the reading stays until the next touch */ }}
      >
        <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <Line x1={0} y1={base} x2={w} y2={base} stroke={t.ring} strokeWidth={1} />
          {/* The comparison first and faint — the second green — and only in
              the slots it has a value for. Its own gaps are its own gaps. */}
          {priorPts.map((p) => (
            <Rect key={`p${p.i}`} x={x(p.i)} y={base - height(p.v)} width={barW} height={height(p.v)}
              rx={rx} fill={t.brand} fillOpacity={0.35} />
          ))}
          {drawn.map((p) => (
            <Rect key={p.i} x={x(p.i) + (pair ? barW : 0)} y={base - height(p.v)} width={barW} height={height(p.v)}
              rx={rx} fill={shown != null && shown.i === p.i ? t.ink : t.brand} />
          ))}
        </Svg>
      </View>
      {/* The axis, each label under its own slot. rtl-ok: pinned LTR on
          physical sides because the bars above are <Svg> user-space and
          react-native-svg mirrors nothing — mirror the labels alone and every
          date sits under the wrong bar. The same pin Spark carries. */}
      {ticks.length ? (
        <View style={{ height: grown(14), marginTop: 3, direction: 'ltr' }}>
          {ticks.map((i) => {
            const end = i === 0 ? 'first' : i === n - 1 ? 'last' : null;
            const frac = (x(i) + (slot - gap) / 2) / w;
            // rtl-ok: physical sides, under the `direction: 'ltr'` pin above.
            const place: StyleProp<ViewStyle> = end === 'first' ? { left: 0, alignItems: 'flex-start' }
              : end === 'last' ? { right: 0, alignItems: 'flex-end' }
                : { left: `${frac * 100}%`, marginLeft: -grown(54) / 2, width: grown(54), alignItems: 'center' };
            return (
              <View key={i} style={[{ position: 'absolute', top: 0 }, place]}>
                <Text numberOfLines={1} style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3 }}>
                  {axisLabel(labels[i])}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
