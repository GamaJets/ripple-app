// Lightweight confetti burst — pure React Native Animated, no extra packages.
// Renders an absolute overlay of falling colored pieces when `show` is true,
// then calls onDone. Used to celebrate streak milestones and new PRs.
import { useEffect, useRef } from 'react';
import { Animated, useWindowDimensions, View, Easing, AccessibilityInfo } from 'react-native';

const COLORS = ['#2dd4bf', '#f59e0b', '#e06767', '#a78bfa', '#34d399', '#60a5fa', '#f472b6'];

export function Confetti({ show, onDone, count = 44 }: { show: boolean; onDone?: () => void; count?: number }) {
  const { width, height } = useWindowDimensions();
  const pieces = useRef(
    Array.from({ length: count }).map(() => ({
      x: Math.random() * width,
      size: 6 + Math.random() * 8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      delay: Math.random() * 260,
      drift: (Math.random() - 0.5) * 150,
      rot: Math.random() * 360,
      dur: 1500 + Math.random() * 900,
      anim: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    // Accessibility: skip the animation entirely when Reduce Motion is on.
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) { onDone && onDone(); return; }
      pieces.forEach((p) => p.anim.setValue(0));
      Animated.parallel(
        pieces.map((p) =>
          Animated.timing(p.anim, { toValue: 1, duration: p.dur, delay: p.delay, easing: Easing.linear, useNativeDriver: true })
        )
      ).start(() => onDone && onDone());
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 999 }}>
      {pieces.map((p, i) => {
        const translateY = p.anim.interpolate({ inputRange: [0, 1], outputRange: [-40, height + 40] });
        const translateX = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
        const rotate = p.anim.interpolate({ inputRange: [0, 1], outputRange: [`${p.rot}deg`, `${p.rot + 360}deg`] });
        const opacity = p.anim.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={i}
            style={{ position: 'absolute', left: p.x, top: 0, width: p.size, height: p.size * 0.6, borderRadius: 2, backgroundColor: p.color, opacity, transform: [{ translateY }, { translateX }, { rotate }] }}
          />
        );
      })}
    </View>
  );
}
