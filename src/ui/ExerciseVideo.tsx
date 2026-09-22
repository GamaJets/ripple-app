// The exercise demo, playing where the person is rather than somewhere else.
//
// Every play affordance in this app used to be Linking.openURL: the clip opened
// in the system browser and the client left mid-session. That is not a small
// inconvenience here — workouts.tsx carries a member's own words about it,
// "it wipes out as u go back", which is the regression that draft-persistence
// was written to fix. Someone checking their form should not have to gamble
// with the sets they have already typed.
//
// Two honest states this deliberately keeps apart, because the old UI showed
// one box for all of them:
//
//   · resolving — we are minting a signed URL. Not "no video".
//   · unavailable — there is a clip, and this viewer may not watch it, or it
//     could not be reached. Not "your coach hasn't recorded one" either; that
//     case is the caller's, because only the caller knows there is no clip.
import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { HAS_NATIVE_VIDEO, UPDATE_REQUIRED_NOTE } from './nativeModules';
import { useTheme } from './components';
import { sp, radius, type as ty } from '../theme/scale';
import { playbackUrl, type VideoItem } from './exerciseVideos';

type Phase = 'resolving' | 'ready' | 'unavailable' | 'no-player';

/** The player itself. Split out so the hook receives a settled source — the URL
 *  arrives asynchronously and a hook cannot wait for it. */
function Player({ uri, label }: { uri: string; label: string }) {
  const t = useTheme();
  // Loops, because a form demo is watched several times over, and does not
  // autoplay — nothing here calls play(). Audio is left on: a coach talking
  // through the cue is half of what makes their clip worth more than a stock one.
  const player = useVideoPlayer(uri, (p) => { p.loop = true; });
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      accessibilityLabel={label}
      style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: t.surface2 }}
    />
  );
}

export function ExerciseVideo({
  video,
  exerciseName,
  onUnavailable,
}: {
  video: VideoItem | null;
  exerciseName: string;
  /** Called when a clip exists but cannot be played, so the screen can offer
   *  whatever it offers when there is nothing — a search, usually. */
  onUnavailable?: () => void;
}) {
  const t = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('resolving');

  useEffect(() => {
    let live = true;
    if (!video) { setPhase('unavailable'); return; }
    // Before spending a signed URL on a clip this binary cannot open. An
    // install made before expo-video was added has these screens and not the
    // player, and the old behaviour was to resolve the URL, mount the player
    // and show a black rectangle with nothing to read.
    if (!HAS_NATIVE_VIDEO) { setPhase('no-player'); onUnavailable?.(); return; }
    setPhase('resolving');
    (async () => {
      const u = await playbackUrl(video);
      if (!live) return;
      if (u) { setUri(u); setPhase('ready'); }
      else { setPhase('unavailable'); onUnavailable?.(); }
    })();
    return () => { live = false; };
    // onUnavailable is intentionally not a dependency: callers pass an inline
    // closure and re-resolving a signed URL on every render would burn requests
    // and restart the clip under someone mid-rep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, video?.url, video?.path]);

  if (phase === 'ready' && uri) {
    return <Player uri={uri} label={`Demonstration of ${exerciseName}`} />;
  }

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={
        phase === 'resolving' ? `Loading the demonstration of ${exerciseName}`
          : phase === 'no-player' ? `This app version cannot play the demonstration of ${exerciseName}`
          : `No demonstration of ${exerciseName} available`
      }
      style={{
        width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md,
        backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ ...ty.label, color: t.ink3, paddingHorizontal: sp.lg, textAlign: 'center' }}>
        {phase === 'resolving' ? 'Loading…'
          : phase === 'no-player' ? UPDATE_REQUIRED_NOTE
          : 'This clip could not be played.'}
      </Text>
    </View>
  );
}
