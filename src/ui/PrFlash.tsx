// The record moment: the PR notice springs in with a brief glow ring, beside
// the confetti and success haptic the runner already fires. Native-driver
// transforms and opacity only, so it costs the JS thread nothing mid-set.
// Mount it with `key={message}` so each new record replays. Reduce Motion: the
// notice simply appears.
import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import { useTheme } from './components';

export function PrFlash({ children }: { children: ReactNode }) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(0.86)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!live) return;
      if (reduce) { scale.setValue(1); fade.setValue(1); return; }
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      ]).start();
    }).catch(() => { scale.setValue(1); fade.setValue(1); });
    return () => { live = false; };
  }, [scale, fade, glow]);

  return (
    <View>
      <Animated.View pointerEvents="none" style={{
        position: 'absolute', left: -6, right: -6, top: -6, bottom: -6, borderRadius: 22,
        borderWidth: 2, borderColor: t.brandBright,
        opacity: glow, transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.03] }) }],
      }} />
      <Animated.View style={{ opacity: fade, transform: [{ scale }] }}>{children}</Animated.View>
    </View>
  );
}
