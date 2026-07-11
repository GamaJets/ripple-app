// Reusable trend line chart (react-native-svg) — smooth line, gradient area fill,
// end-point dot, and a delta badge. Drop-in for any {t, v}[] series.
import { View, Text } from 'react-native';
import Svg, { Polyline, Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from './components';

export interface Point { t: string; v: number }

export function TrendChart({ data, unit = '', color, height = 150, goodDown = false }: { data: Point[]; unit?: string; color?: string; height?: number; goodDown?: boolean }) {
  const t = useTheme();
  const stroke = color || t.brand;
  if (!data || data.length < 2) {
    return <View style={{ height, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.ink3, fontSize: 13 }}>Not enough data yet</Text></View>;
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
        <Polyline points={pts} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => <Circle key={i} cx={X(i)} cy={Y(d.v)} r={i === data.length - 1 ? 4 : 2.5} fill={stroke} />)}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ color: t.ink3, fontSize: 11 }}>{fmt(data[0].t)}</Text>
        <Text style={{ color: good ? t.good : t.serious, fontSize: 12, fontWeight: '700' }}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}{unit}</Text>
        <Text style={{ color: t.ink3, fontSize: 11 }}>{fmt(last.t)} · {last.v}{unit}</Text>
      </View>
    </View>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getDate()}/${d.getMonth() + 1}`;
}
