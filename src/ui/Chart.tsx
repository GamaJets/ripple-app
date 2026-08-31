// Reusable trend line chart (react-native-svg) — smooth line, gradient area fill,
// end-point dot, and a delta badge. Drop-in for any {t, v}[] series.
import { View, Text } from 'react-native';
import Svg, { Polyline, Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from './components';
import { type as ty, numeric } from '../theme/scale';
import { axisLabel } from '../lib/chartAxis';
import { deltaArrow, deltaLabel } from '../lib/deltaLabel';

export interface Point { t: string; v: number }

export function TrendChart({ data, unit = '', color, height = 150, goodDown = false }: { data: Point[]; unit?: string; color?: string; height?: number; goodDown?: boolean }) {
  const t = useTheme();
  const stroke = color || t.brand;
  if (!data || data.length < 2) {
    return <View style={{ height, alignItems: 'center', justifyContent: 'center' }}><Text style={{ ...ty.label, color: t.ink3 }}>Not enough data yet</Text></View>;
  }
  const W = 320, H = height, pl = 6, pr = 6, pt = 12, pb = 18;
  const vs = data.map((d) => d.v);
  const mn = Math.min(...vs), mx = Math.max(...vs);
  const pad = (mx - mn) * 0.18 || 1;
  const lo = mn - pad, hi = mx + pad;
  const X = (i: number) => pl + (W - pl - pr) * (i / (data.length - 1));
  const Y = (v: number) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const pts = data.map((d, i) => `${X(i).toFixed(1)},${Y(d.v).toFixed(1)}`).join(' ');
  const area = `M ${X(0).toFixed(1)},${Y(data[0].v).toFixed(1)} ` + data.map((d, i) => `L ${X(i).toFixed(1)},${Y(d.v).toFixed(1)}`).join(' ') + ` L ${X(data.length - 1).toFixed(1)},${H - pb} L ${X(0).toFixed(1)},${H - pb} Z`;
  const delta = Math.round((vs[vs.length - 1] - vs[0]) * 10) / 10;
  const good = goodDown ? delta < 0 : delta > 0;
  const last = data[data.length - 1];

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity="0.28" />
            <Stop offset="1" stopColor={stroke} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Line x1={pl} y1={H - pb} x2={W - pr} y2={H - pb} stroke={t.ring} strokeWidth="1" />
        <Path d={area} fill="url(#areaFill)" />
        <Polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* One end dot, ringed in the ground colour — no sub-8px per-point marks. */}
        <Circle cx={X(data.length - 1)} cy={Y(last.v)} r={6} fill={t.bg} />
        <Circle cx={X(data.length - 1)} cy={Y(last.v)} r={4} fill={stroke} />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{fmt(data[0].t)}</Text>
        {/* Direction is a dot; the delta itself stays ink. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: good ? t.good : t.serious }} />
          {/* An arrow is a sign drawn as a triangle, and `delta > 0 ? '▲' : '▼'`
              pointed a series that had not moved downwards. Nothing draws no
              arrow. */}
          <Text style={{ ...ty.caption, ...numeric, fontWeight: '500', color: t.ink2 }}>{deltaArrow(delta)} {deltaLabel(delta, { since: null, unit, noChange: 'No change' })}</Text>
        </View>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{fmt(last.t)} · {last.v}{unit}</Text>
      </View>
    </View>
  );
}

/**
 * The end dates under the line.
 *
 * Was a fourth hand-rolled date formatter: `new Date(iso)` then getDate() and
 * getMonth(). Two things wrong with it, both shipped.
 *
 * A bare 'YYYY-MM-DD' — which is what every `date` column in this schema comes
 * back as — is resolved by Date.parse to UTC midnight, and every local getter
 * then reads it back in the reader's own zone, so west of Greenwich the chart
 * reported both ends a day early. That is the trap src/lib/localDate.ts exists
 * for, and it was sitting in a chart axis.
 *
 * And an unreadable date returned '', which renders as a blank where a date
 * belongs. A blank reads as "no label here"; the true statement is "this
 * point's date is not known", which is a dash. src/lib/chartAxis.ts makes both
 * of those the same call the rest of the app's charts make.
 */
const fmt = axisLabel;
