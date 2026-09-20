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

