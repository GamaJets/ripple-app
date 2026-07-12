// Reusable loading skeletons — a softly pulsing placeholder block so async
// screens fade in gracefully instead of flashing empty. Pure Animated (no native
// deps), theme-aware. Use <Skeleton w h r /> for a block, or <SkeletonCard /> for
// a roster/list-row shaped placeholder.
import { useEffect, useRef } from 'react';
import { Animated, View, Easing, type DimensionValue } from 'react-native';
import { useTheme } from './components';

export function Skeleton({ w = '100%', h = 14, r = 8, style }: { w?: DimensionValue; h?: number; r?: number; style?: any }) {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.85, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: t.surface3, opacity: pulse }, style]} />;
}

// A list-row placeholder (avatar + two lines + trailing chip) that matches the
// roster / client-card shape used across the app.
export function SkeletonCard() {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Skeleton w={42} h={42} r={21} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton w={'55%'} h={14} />
        <Skeleton w={'35%'} h={11} />
      </View>
      <Skeleton w={54} h={22} r={12} />
    </View>
  );
}

// Render `n` skeleton cards — a whole loading list in one line.
export function SkeletonList({ n = 4 }: { n?: number }) {
  return <>{Array.from({ length: n }).map((_, i) => <SkeletonCard key={i} />)}</>;
}
