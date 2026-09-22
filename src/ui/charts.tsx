// Reusable, theme-aware chart primitives for the business portals. One accent
// (brand), muted grid, accessible labels.
//
// Two components lived here and no longer do. <Sparkline> drew a line with an
// area fill under it and was replaced by <Spark> in src/ui/kit.tsx, which does
// the same job and more: it breaks the line across a month nobody recorded
// rather than closing over the gap, it sizes to its container, and a point can
// be tapped to read its own label. <DeltaBadge> drew an arrow and a figure, and
// the screens say the same thing in words through `deltaLabel` and `deltaSign`.
//
// Both went with every import they were the only user of — the whole of
// react-native-svg among them, which this file no longer needs at all.
import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from './components';
import { radius, value as figure } from '../theme/scale';

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


