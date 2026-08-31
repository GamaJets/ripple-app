// Reusable, theme-aware chart primitives for the business portals. One accent
// (brand), muted grid, accessible labels. SVG so they're crisp at any size.
import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Polyline, Polygon, Circle, Line } from 'react-native-svg';
import { useTheme } from './components';
import { axisLabel, segments, readablePoints } from '../lib/chartAxis';
import { deltaArrow, deltaLabel, deltaSign } from '../lib/deltaLabel';
// `value` is aliased to `figure` so it can't shadow <DeltaBadge/>'s `value` prop.
import { sp, radius, type as ty, numeric, value as figure } from '../theme/scale';

/**
 * A compact trend line with a soft fill. `data` = series (oldest→newest).
 *
 * `labels` is optional and parallel to `data`; given them, the line carries its
 * first and last date underneath, because a trend nobody can date is a shape.
 * The full treatment — a scaled axis and a touch readout — is <Spark> in
 * kit.tsx; this is the small one that sits inside a portal card, and two ends
 * is all the room there is.
 *
 * `data.filter(...)` used to run over the series before it was drawn, which
 * silently deleted the holes and slid every later point one slot earlier. A
 * hole here keeps its slot and breaks the line, for the reason set out at
 * length in src/lib/monthlyHistory.ts: a month with no reading is not a month
 * of zero, and a line drawn straight through it is a measurement nobody took.
 */
export function Sparkline({ data, w = 260, h = 56, color, labels }: {
  data: (number | null | undefined)[]; w?: number; h?: number; color?: string;
  /** ISO dates (or short labels) parallel to `data`. */
  labels?: string[];
}) {
  const t = useTheme();
  const stroke = color || t.brand;
  const runs = segments(data);
  const drawn = readablePoints(data);
  const n = data.length;
  if (drawn.length < 2) return <View style={{ width: w, height: h }} />;
  const vals = drawn.map((p) => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pad = 6;
  const x = (i: number) => pad + (i / (n - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const last = drawn[drawn.length - 1];
  const from = labels ? axisLabel(labels[drawn[0].i]) : null;
  const to = labels ? axisLabel(labels[last.i]) : null;
  return (
    <View style={{ width: w }}>
      <Svg width={w} height={h} accessibilityLabel={from ? `Trend line, ${from} to ${to}` : 'Trend line'}>
        {runs.map((run, ri) => {
          if (run.length < 2) return <Circle key={ri} cx={x(run[0].i)} cy={y(run[0].v)} r={2.5} fill={stroke} />;
          const line = run.map((p) => `${x(p.i)},${y(p.v)}`).join(' ');
          return (
            <React.Fragment key={ri}>
              <Polygon points={`${x(run[0].i)},${h - pad} ${line} ${x(run[run.length - 1].i)},${h - pad}`} fill={stroke} opacity={0.12} />
              <Polyline points={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </React.Fragment>
          );
        })}
        <Circle cx={x(last.i)} cy={y(last.v)} r={6} fill={t.bg} />
        <Circle cx={x(last.i)} cy={y(last.v)} r={4} fill={stroke} />
      </Svg>
      {from ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
          <Text style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3 }}>{from}</Text>
          <Text style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3 }}>{to}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** An up/down delta chip. The direction is a dot; the figure stays ink. */
export function DeltaBadge({ value, unit = '', suffix = '' }: { value: number; unit?: string; suffix?: string }) {
  const t = useTheme();
  // `value >= 0` made zero an increase: the badge drew ▲, printed a plus and
  // painted the mark in the accent colour for a figure that had not moved.
  // Nothing moved is its own state, and it is neither of the two.
  const sign = deltaSign(value);
  const c = sign === '' ? t.ink3 : sign === '+' ? t.brand : t.crit;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.sm, paddingVertical: 3 }}>
      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c }} />
      <Text style={{ ...ty.caption, ...numeric, fontWeight: '500', color: t.ink }}>{deltaArrow(value)} {deltaLabel(value, { since: null, unit, noChange: 'No change' })}</Text>
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
