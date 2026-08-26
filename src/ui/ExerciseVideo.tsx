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
import { View, Text, Pressable } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from './components';
import { sp, radius, type as ty } from '../theme/scale';
import { playbackUrl, type VideoItem } from './exerciseVideos';

type Phase = 'resolving' | 'ready' | 'unavailable';

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
        phase === 'resolving' ? `Loading the demonstration of ${exerciseName}` : `No demonstration of ${exerciseName} available`
      }
      style={{
        width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md,
        backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ ...ty.label, color: t.ink3, paddingHorizontal: sp.lg, textAlign: 'center' }}>
        {phase === 'resolving' ? 'Loading…' : 'This clip could not be played.'}
      </Text>
    </View>
  );
}

/**
 * The whole block a screen drops next to an exercise: the clip when there is
 * one, and a straight answer when there is not.
 *
 * `status` comes from useExerciseVideos and is the difference between "your
 * coach has not recorded this one" and "we could not read the library" — which
 * the client app has been rendering identically, always as the first one.
 */
export function ExerciseVideoBlock({
  video,
  exerciseName,
  status,
  onSearch,
}: {
  video: VideoItem | null;
  exerciseName: string;
  status: 'loading' | 'ready' | 'error';
  onSearch?: () => void;
}) {
  const t = useTheme();

  if (status === 'error') {
    return (
      <View style={{ paddingVertical: sp.md }}>
        <Text style={{ ...ty.label, color: t.ink3 }}>
          The video library could not be loaded, so we cannot tell you whether your coach has a clip for this.
        </Text>
      </View>
    );
  }

  if (!video) {
    return (
      <View style={{ paddingVertical: sp.md }}>
        <Text style={{ ...ty.label, color: t.ink3 }}>
          {status === 'loading' ? 'Looking for a demonstration…' : 'No demonstration for this exercise yet.'}
        </Text>
        {status === 'ready' && onSearch ? (
          <Pressable
            onPress={onSearch}
            accessibilityRole="button"
            accessibilityLabel={`Search the web for ${exerciseName} technique`}
            style={{ paddingVertical: sp.sm }}
          >
            <Text style={{ ...ty.label, color: t.brand }}>Look one up on the web</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ paddingVertical: sp.sm }}>
      <ExerciseVideo video={video} exerciseName={exerciseName} />
      <Text style={{ ...ty.caption, color: t.ink3, paddingTop: sp.xs }}>
        {video.trainerId ? 'Recorded by your coach' : 'From the Repple library'}
      </Text>
    </View>
  );
}
