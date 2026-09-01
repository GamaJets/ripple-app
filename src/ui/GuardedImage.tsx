// expo-image, or React Native's own <Image> on a binary that has never heard of
// it.
//
// ── Why this file exists ───────────────────────────────────────────────────
//
// expo-image's entry point resolves to `requireNativeModule('ExpoImage')`,
// which THROWS rather than returning null. A bare `import { Image } from
// 'expo-image'` is therefore evaluated at module scope and takes the whole
// importing screen down on any install that predates the dependency — not the
// picture, the screen, before any component renders and before any `if`
// anybody writes inside one can run. This is the same trap already documented
// at length in src/ui/nativeModules.ts for expo-audio, expo-clipboard and
// expo-document-picker.
//
// It was live, not hypothetical. expo-image entered package.json on 30 Aug; the
// version was last moved to 1.1.0 on 27 Aug and runtimeVersion follows the
// version, so every binary built 27-29 Aug accepts today's over-the-air bundle
// and contains no ExpoImage. Five screens imported it directly — the client's
// workout player and exercise library among them — and src/ui/ExerciseDemo.tsx
// made it nine across all three apps, the stretch runner included.
//
// ── Why the fallback is honest rather than an error ────────────────────────
//
// React Native's <Image> is in every binary ever built. On Android it animates
// WebP and GIF anyway; on iOS it holds the first frame, which reads as a still
// photograph of the movement rather than as a fault. A still of the right
// exercise is a far better answer than a screen that does not open, and unlike
// the clipboard or the file picker there is nothing here a person needs telling
// — nobody acts on an animation the way they act on "Copied".
import { Image } from 'react-native';
import type { ImageStyle, StyleProp } from 'react-native';
import { HAS_NATIVE_IMAGE, NativeExpoImage } from './nativeModules';

/**
 * The props every call site in this app actually passes.
 *
 * Deliberately not expo-image's full surface: a prop that only expo-image
 * understands has to be dropped on the fallback path, and the list of what gets
 * dropped should be short enough to read. `cachePolicy` and `autoplay` are the
 * two that vanish, and neither changes what is on screen — one is where the
 * bytes come from and the other is whether they move.
 */
export interface GuardedImageProps {
  source: { uri: string; cacheKey?: string };
  /** expo-image's name for it. Mapped to `resizeMode` on the fallback. */
  contentFit?: 'contain' | 'cover';
  /** Ignored without expo-image: RN's <Image> has its own cache and no say. */
  cachePolicy?: 'disk' | 'memory' | 'memory-disk' | 'none';
  /** Ignored without expo-image: RN's <Image> plays or holds by platform. */
  autoplay?: boolean;
  onLoad?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ImageStyle>;
}

export function GuardedImage({ source, contentFit, cachePolicy, autoplay, onLoad, accessibilityLabel, style }: GuardedImageProps) {
  if (HAS_NATIVE_IMAGE) {
    return (
      <NativeExpoImage
        source={source}
        contentFit={contentFit}
        cachePolicy={cachePolicy}
        autoplay={autoplay}
        onLoad={onLoad}
        accessibilityLabel={accessibilityLabel}
        style={style}
      />
    );
  }
  return (
    <Image
      // `cacheKey` is expo-image's own; RN keys on the URL and has no equivalent.
      source={{ uri: source.uri }}
      resizeMode={contentFit === 'cover' ? 'cover' : 'contain'}
      onLoad={onLoad}
      accessibilityLabel={accessibilityLabel}
      style={style}
    />
  );
}
