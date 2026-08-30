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
//   3. the bought animation for this movement;
//   4. the catalogue's reference frames, cross-faded;
//   5. a sentence saying there is nothing, and offering to ask their coach.
//
// Rules 1 and 2 come from videoForExercise(), which already refuses to fall
// back to a stranger's clip. Rule 3 is what this screen adds. Rule 4 is the one
// that must never be dressed up as rule 3: a placeholder silhouette shown where
// we have no picture is a lie a client acts on under load.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useExerciseDetail } from '../../src/ui/exerciseDetail';
import { useExerciseVideos } from '../../src/ui/exerciseVideos';
import { ExerciseVideo } from '../../src/ui/ExerciseVideo';
// The demonstration renderers moved to src/ui/ExerciseDemo when the owner app
// gained an exercise screen of its own: one implementation, imported twice, so
// two members of the same gym looking at the same lift on two apps cannot end
// up seeing two different pieces of artwork.
import { DemoAnimation, FrameLoop } from '../../src/ui/ExerciseDemo';
import { videoForExercise } from '../../src/lib/exerciseId';
import { frameUrls, FRAMES_ARE_UNHOSTED, demoCaption, demoIsShippable, DEMO_BUCKET, evalAnimationUrl } from '../../src/lib/exerciseMedia';
import { supabase } from '../../src/lib/supabase';
import { useClientData } from '../../src/ui/clientData';
import { RepdbInlineCredit } from '../../src/ui/Attribution';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  // The bought animation, signed like a coach's own clip.
  //
  // Gated on the licence recorded against the row, not on anything this screen
  // knows: an evaluation asset from a CC BY-NC preview bundle renders while
  // somebody is deciding whether to buy the pack, and never in a build that
  // reaches a real person. __DEV__ is the only thing that distinguishes them,
  // and it is the one flag that cannot be wrong in a release binary.
  const mayShowAnimation = demoIsShippable(detail?.demoLicence, !__DEV__);
  const [animUrl, setAnimUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const path = detail?.animationPath;
    if (!path || !mayShowAnimation) { setAnimUrl(null); return; }
    // An evaluation pack is a folder on whoever's machine is judging it, not
    // something in our bucket — putting it there would be the first step of
    // forgetting which assets we are licensed to ship. Resolved synchronously
    // and returned before the signing call, which has nothing to sign.
    const evalUrl = evalAnimationUrl(path, detail?.demoLicence);
    if (evalUrl) { setAnimUrl(evalUrl); return; }
    (async () => {
      try {
        const { data, error } = await supabase.storage.from(DEMO_BUCKET).createSignedUrl(path, 60 * 60);
        if (!cancelled) setAnimUrl(error ? null : (data?.signedUrl ?? null));
      } catch {
        // no-error-ok: a clip we could not sign falls through to the reference
        // frames below, which is a worse demonstration rather than none.
        if (!cancelled) setAnimUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [detail?.animationPath, detail?.demoLicence, mayShowAnimation]);

  const frames = useMemo(() => frameUrls(detail?.imagePaths, detail?.source), [detail?.imagePaths, detail?.source]);
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
        ) : animUrl ? (
          <>
            <DemoAnimation uri={animUrl} label={detail?.name || name} />
            {detail?.demoLicence !== 'commercial' ? (
              <View style={{ marginTop: sp.sm }}>
                <Flag tone={t.warn}>Evaluation asset — licensed for review only, never for release.</Flag>
              </View>
            ) : null}
          </>
        ) : frames.length ? (
          <>
            <FrameLoop urls={frames} label={detail?.name || name} />
            {caption ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{caption}</Text>
            ) : null}
            {/* Beside the artwork, not two screens away. The licence asks for
                one visible credit and the Credits card in settings is it; this
                costs a line and is worth more where somebody is looking. */}
            {detail?.source === 'repdb' ? <RepdbInlineCredit /> : null}
          </>
        ) : (
          // No clip and no frames. Said plainly, with the one action that
          // actually changes it, rather than a grey silhouette implying a
          // demonstration we do not have.
          <Notice tone={t.ink3} kicker="Demonstration"
            title={detail ? 'No Demonstration Yet' : 'Not in Our Catalogue'}
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
            {/* The description leads, above the attribute chips. Somebody who
                does not know a movement needs to be told what it is before
                being told that it is compound and intermediate — and this was
                the one thing the original request asked for that the previous
                dataset had no field for at all. */}
            {detail.description ? (
              <>
                <Rule />
                <Section>
                  <Text style={{ ...ty.body, color: t.ink }}>{detail.description}</Text>
                </Section>
              </>
            ) : null}
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
                  <SectionHead title="Muscles Worked" />
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
                  <SectionHead title="How to Do It" note={`${detail.instructions.length} steps`} />
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

        {/* ── coaching cues ──────────────────────────────────────────────
            Kept apart from the numbered steps rather than appended to them. A
            client following the sequence needs it in order; a client who
            already knows the movement wants the cue, and a cue buried at step
            six is a cue they have stopped reading before they reach. */}
        {detail && detail.tips.length ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Tips" note={`${detail.tips.length}`} />
              {detail.tips.map((tip, n) => (
                <View key={n} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.sm }}>
                  <Text style={{ ...ty.body, color: t.brand }}>·</Text>
                  <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{tip}</Text>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        {/* What the movement is FOR, and how it is filed. Last, because it is
            the least useful thing to somebody standing in front of the bar. */}
        {detail && (detail.goals.length || detail.tags.length) ? (
          <>
            <Rule />
            <Section>
              {detail.goals.length ? (
                <>
                  <SectionHead title="Good For" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: detail.tags.length ? sp.lg : 0 }}>
                    {detail.goals.map((g) => (
                      <View key={g} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                        <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>{cap(g.replace(/_/g, ' '))}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
              {detail.tags.length ? (
                <>
                  <SectionHead title="Tags" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {detail.tags.map((g) => (
                      <View key={g} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                        <Text style={{ ...ty.caption, color: t.ink3 }}>{g.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
            </Section>
          </>
        ) : null}

        <Rule />
        <Section>
          <Ghost label="Exercise Library" icon="video" onPress={() => router.push('/(client)/library')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
