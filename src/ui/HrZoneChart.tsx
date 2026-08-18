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
import {
  type HrSample, hrStats, zoneBands, timeInZones, hrZone, zoneColor,
  maxHr, HR_ZONE_ORDER, HR_ZONE_LABEL, type HrZone,
} from '../lib/hr';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mmss = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 1 ? `${m} min` : `${Math.round(sec)}s`;
};

export function HrZoneChart({ samples, zoneSeconds, avgBpm, maxBpm, age, title, subtitle, height = 172 }: {
  samples: HrSample[];
  /** Seconds per zone, when the source gives totals instead of a series (WHOOP). */
  zoneSeconds?: Partial<Record<HrZone, number>> | null;
  /** Reported averages, used for the stat row when there is no series to derive them from. */
  avgBpm?: number | null;
  maxBpm?: number | null;
  age?: number | null; title?: string; subtitle?: string; height?: number;
}) {
  const t = useTheme();
  const [w, setW] = useState(320);

  const stats = hrStats(samples);
  const hasSeries = !!stats && samples.length >= 2;
  const zoneTotal = zoneSeconds ? HR_ZONE_ORDER.reduce((a, z) => a + (zoneSeconds[z] || 0), 0) : 0;

  if (!hasSeries && zoneTotal <= 0) {
    return (
      <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
        {title ? <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, marginBottom: 4 }}>{title}</Text> : null}
        <Text style={{ color: t.ink3, fontSize: 13 }}>No heart-rate data yet. Wear your watch during a workout and it’ll appear here.</Text>
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
  const tiz: Record<HrZone, number> = hasSeries
    ? timeInZones(pts, age)
    : (HR_ZONE_ORDER.reduce((acc, z) => { acc[z] = zoneSeconds?.[z] || 0; return acc; }, {} as Record<HrZone, number>));
  const totalSec = HR_ZONE_ORDER.reduce((a, z) => a + tiz[z], 0) || 1;
  const activeZones = HR_ZONE_ORDER.filter((z) => tiz[z] > 0);
  const avgY = hasSeries ? yOf(stats!.avg) : 0;
  const peakI = pts.length ? pts.reduce((best, p, i) => (p.bpm > pts[best].bpm ? i : best), 0) : 0;

  // Stat row: derived from the series, or from whatever the provider reported.
  const showLow = hasSeries ? stats!.low : null;
  const showAvg = hasSeries ? stats!.avg : (typeof avgBpm === 'number' ? avgBpm : null);
  const showHigh = hasSeries ? stats!.high : (typeof maxBpm === 'number' ? maxBpm : null);

  const Stat = ({ label, value, color }: { label: string; value: number; color?: string }) => (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ color: color || t.ink, fontWeight: '800', fontSize: 19 }}>{value}</Text>
      <Text style={{ color: t.ink3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Text>
    </View>
  );

  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
      {title ? <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{title}</Text> : null}
      {subtitle ? <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 1 }}>{subtitle}</Text> : null}

      {(showLow != null || showAvg != null || showHigh != null) ? (
        <View style={{ flexDirection: 'row', marginTop: 12, marginBottom: 12 }}>
          {showLow != null ? <Stat label="Low" value={showLow} color={t.ink2} /> : null}
          {showAvg != null ? <Stat label="Avg" value={showAvg} color={t.brand} /> : null}
          {showHigh != null ? <Stat label={hasSeries ? 'High' : 'Max'} value={showHigh} color="#ef4444" /> : null}
        </View>
      ) : <View style={{ height: 12 }} />}

      {hasSeries ? (
        <View onLayout={(e) => setW(Math.max(200, e.nativeEvent.layout.width))}>
          <Svg width={w} height={height} accessibilityLabel={`Heart-rate chart, low ${stats!.low}, average ${stats!.avg}, high ${stats!.high} bpm`}>
            {bands.map((b) => {
              const yTop = yOf(Math.min(b.hiBpm, hi));
              const yBot = yOf(Math.max(b.loBpm, lo));
              return <Rect key={b.zone} x={0} y={yTop} width={w} height={Math.max(0, yBot - yTop)} fill={b.color} opacity={0.13} />;
            })}
            {pts.slice(0, -1).map((p, i) => (
              <Line key={i} x1={xOf(i)} y1={yOf(p.bpm)} x2={xOf(i + 1)} y2={yOf(pts[i + 1].bpm)}
                stroke={zoneColor(hrZone(p.bpm, age))} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            <Line x1={0} y1={avgY} x2={w} y2={avgY} stroke={t.ink3} strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
            <Circle cx={xOf(peakI)} cy={yOf(pts[peakI].bpm)} r={3.6} fill="#ef4444" />
          </Svg>
        </View>
      ) : null}

      {/* time-in-zone stacked bar */}
      <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 12 }}>
        {HR_ZONE_ORDER.map((z) => (tiz[z] > 0 ? <View key={z} style={{ width: `${(tiz[z] / totalSec) * 100}%`, backgroundColor: zoneColor(z) }} /> : null))}
      </View>
      <View style={{ marginTop: 10, gap: 5 }}>
        {activeZones.map((z: HrZone) => (
          <View key={z} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: zoneColor(z) }} />
            <Text style={{ color: t.ink2, fontSize: 12.5, flex: 1 }}>{HR_ZONE_LABEL[z]}</Text>
            <Text style={{ color: t.ink3, fontSize: 12.5, fontWeight: '700' }}>{mmss(tiz[z])}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
