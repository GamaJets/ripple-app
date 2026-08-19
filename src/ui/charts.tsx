// Reusable, theme-aware chart primitives for the business portals. One accent
// (brand), muted grid, accessible labels. SVG so they're crisp at any size.
import { View, Text } from 'react-native';
import Svg, { Polyline, Polygon, Circle, Line } from 'react-native-svg';
import { useTheme } from './components';
// `value` is aliased to `figure` so it can't shadow <DeltaBadge/>'s `value` prop.
import { sp, radius, type as ty, numeric, value as figure } from '../theme/scale';

/** A compact trend line with a soft fill. `data` = numeric series (oldest→newest). */
export function Sparkline({ data, w = 260, h = 56, color }: { data: number[]; w?: number; h?: number; color?: string }) {
  const t = useTheme();
  const stroke = color || t.brand;
  const pts = data.filter((n) => typeof n === 'number' && isFinite(n));
  if (pts.length < 2) return <View style={{ width: w, height: h }} />;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 6;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const line = pts.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const area = `${x(0)},${h - pad} ${line} ${x(pts.length - 1)},${h - pad}`;
  return (
    <Svg width={w} height={h} accessibilityLabel="Trend line">
      <Polygon points={area} fill={stroke} opacity={0.12} />
      <Polyline points={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r={6} fill={t.bg} />
      <Circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r={4} fill={stroke} />
    </Svg>
  );
}

/** An up/down delta chip. The direction is a dot; the figure stays ink. */
export function DeltaBadge({ value, unit = '', suffix = '' }: { value: number; unit?: string; suffix?: string }) {
  const t = useTheme();
  const up = value >= 0;
  const c = up ? t.brand : t.crit;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.sm, paddingVertical: 3 }}>
      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c }} />
      <Text style={{ ...ty.caption, ...numeric, fontWeight: '500', color: t.ink }}>{up ? '▲' : '▼'} {up ? '+' : ''}{value}{unit}</Text>
      {suffix ? <Text style={{ ...ty.caption, color: t.ink3 }}>{suffix}</Text> : null}
    </View>
  );
}

/** A small health score pill (0–100). Tone is a dot beside the score, not on it. */
export function HealthPill({ score, tone }: { score: number; tone: 'good' | 'moderate' | 'low' }) {
  const t = useTheme();
  const c = tone === 'good' ? t.brand : tone === 'moderate' ? t.warn : t.crit;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 4, minWidth: 42 }}>
      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c }} />
      <Text style={{ ...figure(13), color: t.ink }}>{score}</Text>
    </View>
  );
}

/** A labelled horizontal distribution bar (e.g. adherence buckets). */
export function DistBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden' }}>
      {segments.map((s, i) => (
        <View key={i} style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} />
      ))}
    </View>
  );
}
