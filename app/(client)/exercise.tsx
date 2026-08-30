// One exercise, explained.
//
// Reported by a trainer: "when an instructor has not provided a video for the
// exercise there should be an automation of the exercise being demo'd." Until
// now a movement with no coach clip was a dead end — the library said "No clips
// yet" and that was the whole of it, for every exercise, because the video
// table has never held a single row.
//
// ── What wins, in order ────────────────────────────────────────────────────
//
//   1. the client's OWN coach's clip — a member should see the person who
//      actually trains them demonstrating the lift;
//   2. the platform Academy clip;
//   3. the catalogue's reference frames, looped;
//   4. a sentence saying there is nothing, and offering to ask their coach.
//
// Rules 1 and 2 come from videoForExercise(), which already refuses to fall
// back to a stranger's clip. Rule 3 is what this screen adds. Rule 4 is the one
// that must never be dressed up as rule 3: a placeholder silhouette shown where
// we have no picture is a lie a client acts on under load.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Image, Pressable, ActivityIndicator, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useExerciseDetail } from '../../src/ui/exerciseDetail';
import { useExerciseVideos } from '../../src/ui/exerciseVideos';
import { ExerciseVideo } from '../../src/ui/ExerciseVideo';
import { videoForExercise } from '../../src/lib/exerciseId';
import { frameUrls, FRAME_MS, FRAMES_ARE_UNHOSTED, demoCaption } from '../../src/lib/exerciseMedia';
import { useClientData } from '../../src/ui/clientData';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

function FrameLoop({ urls, label }: { urls: string[]; label: string }) {
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

export default function ExerciseScreen() {
  const t = useTheme();
  const router = useRouter();
  const { name: raw } = useLocalSearchParams<{ name?: string }>();
  const name = (raw || '').trim();
  const { detail, status } = useExerciseDetail(name);
  const { videos } = useExerciseVideos();
  const cd = useClientData();

  // The client's own coach first. cd.trainerId is who actually trains them, so
  // passing it is what stops a stranger's clip being offered as theirs.
  const clip = useMemo(
    () => videoForExercise(name, videos, (cd as any).trainerId ?? null),
    [name, videos, cd],
  );
  const frames = useMemo(() => frameUrls(detail?.imagePaths), [detail?.imagePaths]);
  const caption = demoCaption(detail?.source, frames.length);

  const G = layout.gutter;
  const chips = [detail?.equipment, detail?.level, detail?.mechanic, detail?.force]
    .filter((x): x is string => !!x)
    .map(cap);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, marginBottom: sp.lg }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
            <Icon name="back" size={20} color={t.ink} />
          </Pressable>
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }} numberOfLines={2}>{detail?.name || name || 'Exercise'}</Text>
        </View>

        {/* ── the demonstration ─────────────────────────────────────────── */}
        {status === 'loading' ? (
          <View style={{ paddingVertical: sp.xl, alignItems: 'center' }}>
            <ActivityIndicator />
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>Looking this movement up…</Text>
          </View>
        ) : status === 'error' ? (
          <Notice tone={t.warn} kicker="Exercise" title="This could not be read"
            note="Nothing below is missing because it does not exist — we could not reach the catalogue. Try again once you have signal." />
        ) : clip ? (
          <ExerciseVideo video={clip} exerciseName={detail?.name || name} />
        ) : frames.length ? (
          <>
            <FrameLoop urls={frames} label={detail?.name || name} />
            {caption ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{caption}</Text>
            ) : null}
          </>
        ) : (
          // No clip and no frames. Said plainly, with the one action that
          // actually changes it, rather than a grey silhouette implying a
          // demonstration we do not have.
          <Notice tone={t.ink3} kicker="Demonstration"
            title={detail ? 'No demonstration yet' : 'Not in our catalogue'}
            note={detail
              ? 'Nobody has filmed this movement and the catalogue has no reference frames for it. Your coach can add a clip from their app.'
              : 'This movement is not in our catalogue, so there is no guide for it. If your coach wrote it into your program, ask them how they want it done.'} />
        )}

        {FRAMES_ARE_UNHOSTED && frames.length ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.warn}>Reference frames are served from the source dataset — not for release.</Flag>
          </View>
        ) : null}

        {/* ── what it is ────────────────────────────────────────────────── */}
        {detail ? (
          <>
            <Rule />
            <Section>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {detail.group ? (
                  <View style={{ backgroundColor: t.brand, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                    <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>{detail.group}</Text>
                  </View>
                ) : null}
                {chips.map((c) => (
                  <View key={c} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                    <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{c}</Text>
                  </View>
                ))}
              </View>
            </Section>

            {detail.primaryMuscles.length || detail.secondaryMuscles.length ? (
              <>
                <Rule />
                <Section>
                  <SectionHead title="Muscles worked" />
                  {detail.primaryMuscles.length ? (
                    <Text style={{ ...ty.body, color: t.ink, marginBottom: 4 }}>
                      <Text style={{ fontWeight: '600' }}>Primary: </Text>{detail.primaryMuscles.map(cap).join(', ')}
                    </Text>
                  ) : null}
                  {detail.secondaryMuscles.length ? (
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      <Text style={{ fontWeight: '600' }}>Also: </Text>{detail.secondaryMuscles.map(cap).join(', ')}
                    </Text>
                  ) : null}
                </Section>
              </>
            ) : null}

            {detail.instructions.length ? (
              <>
                <Rule />
                <Section>
                  <SectionHead title="How to do it" note={`${detail.instructions.length} steps`} />
                  {detail.instructions.map((step, n) => (
                    <View key={n} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
                      <Text style={{ ...ty.label, fontWeight: '700', color: t.ink3, minWidth: 18 }}>{n + 1}</Text>
                      <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{step}</Text>
                    </View>
                  ))}
                </Section>
              </>
            ) : status === 'ready' && detail ? (
              <>
                <Rule />
                <Section>
                  {/* 41 of the original rows carry no instructions because nobody
                      has confirmed which catalogue movement they are. Saying so
                      is the point — an empty section would read as an app that
                      forgot to render, not as a gap we know about. */}
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    No written steps for this one yet.
                  </Text>
                </Section>
              </>
            ) : null}
          </>
        ) : null}

        <Rule />
        <Section>
          <Ghost label="Exercise library" icon="video" onPress={() => router.push('/(client)/library')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
