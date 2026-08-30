// How a catalogue movement is shown moving, in every app that shows one.
//
// These three renderers were written for app/(client)/exercise.tsx and lived in
// it. The owner app now has an exercise screen of its own, and a demonstration
// copied into a second file is a demonstration that drifts: the cross-fade gets
// tuned on one screen, the WebP branch gets fixed on one screen, and two members
// of the same gym looking at the same lift on two apps see different artwork.
// One implementation, imported twice.
//
// Nothing here decides WHETHER a demonstration may be shown — that is
// demoIsShippable() in src/lib/exerciseMedia.ts, asked by the screen, because
// the answer depends on the licence recorded against the row and on whether the
// build is a release.
import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, ActivityIndicator, Animated, Easing } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { HAS_NATIVE_VIDEO, UPDATE_REQUIRED_NOTE } from './nativeModules';
import { Image as ExpoImage } from 'expo-image';
import { useTheme } from './components';
import type { Theme } from '../theme/tokens';
import { Icon } from './Icon';
import { radius, sp, type as ty } from '../theme/scale';

/**
 * A bought animation, looping.
 *
 * Muted and autoplaying, with no controls — the opposite of a coach's clip.
 * That one is somebody talking through a cue and is worth a play button and
 * sound; this is a diagram that happens to move, and asking somebody to press
 * play on a diagram is a step for nothing.
 *
 * ── Two renderers, because packs ship two different things ─────────────────
 *
 * Vendors deliver either video (MP4/WebM) or an animated image (WebP/GIF), and
 * the two need completely different players. React Native's own <Image> does
 * not animate WebP on iOS and expo-video cannot open one at all, so a WebP pack
 * played through the video path renders a blank box — no error, no log, just an
 * empty frame where the demonstration should be. That is exactly the class of
 * bug scripts/check-runtime-traps.mjs exists for, and it would have shipped.
 *
 * The extension decides, because it is the one thing about a bought file we
 * know for certain.
 */
const ANIMATED_IMAGE = /\.(webp|gif|apng)(\?|$)/i;

export function DemoVideo({ uri, label }: { uri: string; label: string }) {
  const t = useTheme();
  // An install made before expo-video was added has this screen and not the
  // player. Mounting it there gives a black rectangle with nothing to read;
  // this says which of the two possible problems it is.
  if (!HAS_NATIVE_VIDEO) {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={`This app version cannot play the demonstration of ${label}`}
        style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.lg }}
      >
        <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center' }}>{UPDATE_REQUIRED_NOTE}</Text>
      </View>
    );
  }
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play(); });
  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="contain"
      accessibilityLabel={`${label}, looping demonstration`}
      style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: t.surface2 }}
    />
  );
}

export function DemoAnimation({ uri, label }: { uri: string; label: string }) {
  const t = useTheme();
  if (!ANIMATED_IMAGE.test(uri)) return <DemoVideo uri={uri} label={label} />;
  return (
    <ExpoImage
      source={{ uri }}
      contentFit="contain"
      // expo-image animates WebP and GIF on both platforms; the built-in
      // <Image> shows only the first frame on iOS, which looks like a still
      // rather than like a failure.
      autoplay
      cachePolicy="disk"
      accessibilityLabel={`${label}, looping demonstration`}
      style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: t.surface2 }}
    />
  );
}

/**
 * The catalogue frames as a movement, not a slideshow.
 *
 * ── Why this is a cross-fade and not a swap ────────────────────────────────
 *
 * The first version toggled opacity between two mounted images every 900ms.
 * Two photographs are a start position and an end position, so that is a hard
 * cut between two quite different pictures, six or seven times a minute —
 * which reads as a strobe rather than as a repetition. Reported as "the video
 * is very choppy".
 *
 * Fading between them does not invent any motion that was not photographed,
 * and it is honest about that: what it removes is the JOLT. The eye reads a
 * dissolve between two postures as one movement passing through them, which is
 * what the client is being asked to copy.
 *
 * ── Why Animated with the native driver ────────────────────────────────────
 *
 * setInterval driving React state re-renders the whole screen on every tick,
 * on the JS thread, competing with a scroll. Animated.loop with
 * useNativeDriver hands the opacity curve to the UI thread once and never
 * touches JS again — so the fade holds 60fps even while the list below it is
 * being scrolled, and it costs nothing when the screen is idle.
 *
 * A two-frame set can never be smooth in the way a licensed animation is. This
 * is the most that two photographs can honestly be made to look like.
 */
const HOLD_MS = 620;   // long enough to read the posture
const FADE_MS = 420;   // long enough to dissolve rather than cut

export function FrameLoop({ urls, label }: { urls: string[]; label: string }) {
  const t = useTheme();
  const [ready, setReady] = useState(false);
  // 0 → first frame, 1 → second. Everything else is interpolated from it.
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let live = true;
    Promise.all(urls.map((u) => Image.prefetch(u).catch(() => false)))
      .then(() => { if (live) setReady(true); })
      .catch(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [urls.join('|')]);

  useEffect(() => {
    if (!ready || urls.length < 2) return;
    progress.setValue(0);
    // Ease in and out of each fade. A linear dissolve still reads as mechanical;
    // easing makes the hold at each end feel like the pause at the top and
    // bottom of a rep.
    const leg = (to: number) => Animated.timing(progress, {
      toValue: to, duration: FADE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
    });
    const wait = (d: number) => Animated.delay(d);
    const anim = Animated.loop(Animated.sequence([wait(HOLD_MS), leg(1), wait(HOLD_MS), leg(0)]));
    anim.start();
    return () => anim.stop();
  }, [ready, urls.length, progress]);

  // Opposed opacities from ONE value, so the two never both dim mid-fade and
  // show the container through the gap.
  const first = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const second = progress;

  return (
    <View style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: t.surface2, overflow: 'hidden' }}>
      {urls.slice(0, 2).map((u, n) => (
        <Animated.Image
          key={u}
          source={{ uri: u }}
          accessibilityLabel={n === 0 ? `${label}, start position` : `${label}, end position`}
          resizeMode="contain"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            opacity: urls.length < 2 ? 1 : (n === 0 ? first : second),
          }}
        />
      ))}
      {!ready ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  );
}

/**
 * A movement's picture at list size.
 *
 * The empty state is a marked tile rather than a blank one: a row with no
 * artwork and a row whose signed URL has not arrived look identical if both
 * are empty, and one of those is permanent. Sized and rounded here so the
 * client library, the coach's builder and the coach's picker cannot drift into
 * three slightly different squares.
 */
export function ExerciseThumb({ uri, t, size = 52 }: { uri: string | null; t: Theme; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: t.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      {uri
        ? <ExpoImage source={{ uri }} contentFit="contain" cachePolicy="disk" style={{ width: '100%', height: '100%' }} />
        : <Icon name="dumbbell" size={Math.round(size * 0.42)} color={t.ink3} />}
    </View>
  );
}
