// Heart-rate zone chart — a session/day HR line coloured by training zone
// (blue → green → orange → red, Orange-Theory style), over faint zone bands,
// with low/avg/high and time-in-zone. Pure presentational.
//
// Two input modes, because the sources differ:
//   samples      a real HR series (Apple Watch / HealthKit) → line + bands + zones
//   zoneSeconds  precomputed time per zone (WHOOP, which exposes per-workout zone
//                durations but NO intraday heart-rate samples) → zones only, no line
// Given neither, it says so rather than inventing a curve.
import { useState } from 'react';
import { View, Text } from 'react-native';
import Svg, { Rect, Line, Circle } from 'react-native-svg';
import { useTheme } from './components';
import { sp, radius, hairline, type as ty, numeric, value } from '../theme/scale';
import {
  type HrSample, hrStats, zoneBands, timeInZones, zoneOf, zoneColor, maxHr,
  ZONE_NOS, zoneName, zoneKey, emptyZoneSeconds, zoneSecondsTotal,
  type ZoneNo, type ZoneSeconds,
} from '../lib/hr';
import { ZoneBoard } from './ZoneBoard';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mmss = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 1 ? `${m} min` : `${Math.round(sec)}s`;
};

export function HrZoneChart({ samples, zoneSeconds, avgBpm, maxBpm, age, title, subtitle, height = 172 }: {
  samples: HrSample[];
  /** Seconds per zone, when the source gives totals instead of a series (WHOOP). */
  zoneSeconds?: Partial<ZoneSeconds> | null;
  /** Reported averages, used for the stat row when there is no series to derive them from. */
  avgBpm?: number | null;
  maxBpm?: number | null;
  age?: number | null; title?: string; subtitle?: string; height?: number;
}) {
  const t = useTheme();
  const [w, setW] = useState(320);

  const stats = hrStats(samples);
  const hasSeries = !!stats && samples.length >= 2;
  const zoneTotal = zoneSeconds ? ZONE_NOS.reduce((a, z) => a + (zoneSeconds[zoneKey(z)] || 0), 0) : 0;

  if (!hasSeries && zoneTotal <= 0) {
    return (
      <View style={{ backgroundColor: t.surface, borderRadius: radius.md, borderWidth: hairline, borderColor: t.ring, padding: sp.lg }}>
        {title ? <Text style={{ ...ty.head, color: t.ink, marginBottom: 4 }}>{title}</Text> : null}
        <Text style={{ ...ty.label, color: t.ink3 }}>No heart-rate data yet. Wear your watch during a workout and it’ll appear here.</Text>
      </View>
    );
  }

  const pts = samples.filter((s) => isFinite(s.bpm) && s.bpm > 0).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const n = pts.length;
  const lo = Math.max(40, (stats?.low ?? 60) - 10);
  const hi = Math.min(Math.round(maxHr(age) * 1.06), (stats?.high ?? Math.round(maxHr(age) * 0.9)) + 12);
  const span = hi - lo || 1;
  const padTop = 6, padBottom = 6;
  const chartH = height - padTop - padBottom;
  const yOf = (bpm: number) => padTop + (1 - (clamp(bpm, lo, hi) - lo) / span) * chartH;
  const xOf = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * w);

  const bands = zoneBands(age).filter((b) => b.hiBpm > lo && b.loBpm < hi);
  // Time-in-zone comes from the series when we have one, otherwise straight from
  // the provider's own totals.
  const tiz: ZoneSeconds = hasSeries
    ? timeInZones(pts, age)
    : ZONE_NOS.reduce((acc, z) => { acc[zoneKey(z)] = zoneSeconds?.[zoneKey(z)] || 0; return acc; }, emptyZoneSeconds());
  const peakZone: ZoneNo | null = hasSeries ? zoneOf(stats!.high, age) : null;
  const avgY = hasSeries ? yOf(stats!.avg) : 0;
  const peakI = pts.length ? pts.reduce((best, p, i) => (p.bpm > pts[best].bpm ? i : best), 0) : 0;

  // Stat row: derived from the series, or from whatever the provider reported.
  const showLow = hasSeries ? stats!.low : null;
  const showAvg = hasSeries ? stats!.avg : (typeof avgBpm === 'number' ? avgBpm : null);
  const showHigh = hasSeries ? stats!.high : (typeof maxBpm === 'number' ? maxBpm : null);

  // The figure stays ink; the zone it belongs to is carried by a dot beside the
  // label, never by colouring the number itself.
  const Stat = ({ label, value: v, tone }: { label: string; value: number; tone?: string }) => (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ ...value(19), color: t.ink }}>{v}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
        {tone ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: tone }} /> : null}
        <Text style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3 }}>{label}</Text>
      </View>
    </View>
  );

  return (
    <View style={{ backgroundColor: t.surface, borderRadius: radius.md, borderWidth: hairline, borderColor: t.ring, padding: sp.lg }}>
      {title ? <Text style={{ ...ty.head, color: t.ink }}>{title}</Text> : null}
      {subtitle ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 1 }}>{subtitle}</Text> : null}

      {(showLow != null || showAvg != null || showHigh != null) ? (
        <View style={{ flexDirection: 'row', marginTop: 12, marginBottom: 12 }}>
          {showLow != null ? <Stat label="Low" value={showLow} /> : null}
          {showAvg != null ? <Stat label="Avg" value={showAvg} tone={t.brand} /> : null}
          {showHigh != null ? <Stat label={hasSeries ? 'High' : 'Max'} value={showHigh} tone={t.crit} /> : null}
        </View>
      ) : <View style={{ height: 12 }} />}

      {hasSeries ? (
        <View onLayout={(e) => setW(Math.max(200, e.nativeEvent.layout.width))}>
          <Svg width={w} height={height} accessibilityLabel={`Heart-rate chart, low ${stats!.low}, average ${stats!.avg}, high ${stats!.high} bpm`}>
            {bands.map((b) => {
              const yTop = yOf(Math.min(b.hiBpm, hi));
              const yBot = yOf(Math.max(b.loBpm, lo));
              return <Rect key={b.no} x={0} y={yTop} width={w} height={Math.max(0, yBot - yTop)} fill={b.color} opacity={0.13} />;
            })}
            {pts.slice(0, -1).map((p, i) => (
              <Line key={i} x1={xOf(i)} y1={yOf(p.bpm)} x2={xOf(i + 1)} y2={yOf(pts[i + 1].bpm)}
                stroke={zoneColor(zoneOf(p.bpm, age))} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            <Line x1={0} y1={avgY} x2={w} y2={avgY} stroke={t.ink3} strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
            <Circle cx={xOf(peakI)} cy={yOf(pts[peakI].bpm)} r={6} fill={t.surface} />
            <Circle cx={xOf(peakI)} cy={yOf(pts[peakI].bpm)} r={4} fill={t.crit} />
          </Svg>
        </View>
      ) : null}

      {/* Time in zone. The board leads with the zone NUMBER because these hues
          are too close together to carry meaning alone — see src/lib/hr.ts. */}
      <View style={{ marginTop: sp.lg, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
        <ZoneBoard seconds={tiz} current={peakZone} />
      </View>
    </View>
  );
}
