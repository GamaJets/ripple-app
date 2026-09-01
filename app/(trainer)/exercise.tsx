// Trainer · One exercise, exactly as the client will see it.
//
// A coach picking exercises in the builder had no way to look at one. 601
// catalogue movements, most of them illustrated and every RepDB row carrying a
// description, and the only surfaces that rendered any of it were the client
// app and the owner's. So the person CHOOSING the lift was the one person who
// could not see it, and the realistic failure is not exotic: a coach writes
// "Zottman Curl" into a beginner's Thursday because the name sounded like a
// curl, and finds out what it actually is when the client asks.
//
// Deliberately the same screen as app/(client)/exercise.tsx: same illustration
// renderer (src/ui/ExerciseDemo), same precedence, same chips, same "Muscles
// worked" and "How to do it", same words for a movement we have no picture of.
// The whole value of this screen is that it is a preview, and a preview built
// from a second visual language is a preview of a page that does not exist.
//
// ── What is different, and why ─────────────────────────────────────────────
//
// The clip preference. The client screen prefers their OWN coach's clip; here
// the coach's own id is what is preferred, because on this app the signed-in
// user IS the trainer. That matters at a gym: the video read is not filtered by
// trainer — RLS decides what this person may see, which includes colleagues'
// clips — so without an explicit preference a coach previewing what THEIR
// client sees could be shown another coach's demonstration as though it were
// the one that will play.
//
// And the closing action. A client with no demonstration is told to ask their
// coach; the coach is the person who can fix it, so they are sent to Videos.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useBackTo } from '../../src/ui/backTo';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useExerciseDetail } from '../../src/ui/exerciseDetail';
import { useExerciseVideos } from '../../src/ui/exerciseVideos';
import { ExerciseVideo } from '../../src/ui/ExerciseVideo';
import { DemoAnimation, FrameLoop } from '../../src/ui/ExerciseDemo';
import { videoForExercise } from '../../src/lib/exerciseId';
import { catalogueValue as cap } from '../../src/lib/format';
import { FRAMES_ARE_UNHOSTED, demoCaption } from '../../src/lib/exerciseMedia';
import { useExerciseMedia } from '../../src/ui/useExerciseMedia';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/ui/auth';
import { RepdbInlineCredit } from '../../src/ui/Attribution';


export default function TrainerExercise() {
  const t = useTheme();
  const router = useRouter();
  const { name: raw, from } = useLocalSearchParams<{ name?: string; from?: string }>();
  const goBack = useBackTo(from);
  const name = (raw || '').trim();
  const { detail, status, signedOut } = useExerciseDetail(name);
  const { videos } = useExerciseVideos();
  const { user } = useAuth();

  // `trainers.id` references `profiles.id`, so on the coach app the signed-in
  // user's auth id IS their trainer id. Passing it is what makes this a preview
  // of their own client's screen rather than of somebody else's.
  const clip = useMemo(
    () => videoForExercise(name, videos, user?.id ?? null),
    [name, videos, user?.id],
  );

  // Gated on the licence recorded against the row, not on anything this screen
  // knows: an evaluation asset from a CC BY-NC preview bundle renders while
  // somebody is deciding whether to buy the pack, and never in a build that
  // reaches a real person. __DEV__ is the only thing that distinguishes them,
  // and it is the one flag that cannot be wrong in a release binary.
  // The same hook the client screen uses. Three apps showing the same
  // movement must resolve its pictures the same way, and a picture that fails
  // to resolve is a silent empty box rather than an error anybody sees.
  const { frames, animUrl } = useExerciseMedia(detail);
  const caption = demoCaption(detail?.source, frames.length);

  const chips = [detail?.equipment, detail?.level, detail?.mechanic, detail?.force]
    .filter((x): x is string => !!x)
    .map(cap);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, marginBottom: sp.lg }}>
          <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
            <Icon name="back" size={20} color={t.ink} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>What your client sees</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }} numberOfLines={2}>{detail?.name || name || 'Exercise'}</Text>
          </View>
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
            {caption ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{caption}</Text> : null}
            {/* Beside the artwork, not two screens away. The licence asks for
                one visible credit and the Credits card on Profile is it; this
                costs a line and is worth more where somebody is looking. */}
            {detail?.source === 'repdb' ? <RepdbInlineCredit /> : null}
          </>
        ) : (
          // No clip, no animation and no frames. Said plainly, with the action
          // that actually changes it — this reader is the person who can film
          // one — rather than a grey silhouette implying a demonstration we do
          // not have.
          <Notice tone={t.ink3} kicker="Demonstration"
            title={detail ? 'No Demonstration Yet' : signedOut ? 'Sign In to See This' : 'Not in the Catalogue'}
            note={detail
              ? 'Nobody has filmed this movement and the catalogue has no illustration for it, so your client sees its name, its muscles and the written steps. Record a clip from Videos and it appears here for them.'
              // See the matching note on the client screen. Saying "no
              // catalogue entry" while signed out told a coach exploring the
              // demo that Back Squat is not in a catalogue that contains it.
              : signedOut
                ? 'The exercise catalogue is only available once you are signed in, so this screen could not look this movement up. Sign in and its illustration, muscles and steps appear here.'
                : 'This movement has no catalogue entry, so there is no illustration, description or muscle data for it. You can still put it in a program — your client sees the name you typed and whatever you write in the note.'} />
        )}

        {FRAMES_ARE_UNHOSTED && frames.length ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.warn}>Illustrations are served from the source dataset — not for release.</Flag>
          </View>
        ) : null}

        {detail ? (
          <>
            {/* ── what it is ───────────────────────────────────────────── */}
            {/* The field the RepDB catalogue was adopted for: it says what a
                movement IS, where `instructions` say how to perform it, and a
                coach deciding whether to assign it is asking the first
                question. Rows imported before RepDB carry no description and
                show nothing here — never a filler sentence, because an invented
                description is an invented fact about somebody's training. */}
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
              {/* A coach programming for somebody training at home needs to know
                  what the lift is performed on. An absent equipment column is a
                  gap in the catalogue and says so — it is not a claim that the
                  exercise needs no kit, which is the reading that puts a cable
                  fly in a bodyweight program. */}
              {!detail.equipment ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  The catalogue does not record what this one is performed on.
                </Text>
              ) : null}
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
            ) : status === 'ready' ? (
              <>
                <Rule />
                <Section>
                  {/* Some rows carry no instructions because nobody has
                      confirmed which catalogue movement they are. Saying so is
                      the point — an empty section would read as an app that
                      forgot to render, not as a gap we know about. Gated on the
                      read having finished, so a row still arriving is never
                      described as having no steps. */}
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    No written steps for this one yet — your client sees no instructions, so put the cue in the program note.
                  </Text>
                </Section>
              </>
            ) : null}
          </>
        ) : null}

        {/* ── Tips, which this screen was rendering nowhere ──────────────────
            The catalogue carries them — 597 of 604 rows have at least one —
            and the client's own exercise screen has shown them all along. A
            coach opening the same movement got the description and the steps
            and then nothing, so the cues they might pass on in a session were
            visible to everybody except the person doing the coaching. */}
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

        {/* What the movement is for and how it is filed — the same block the
            client screen ends on, and useful to a coach deciding whether it
            belongs in somebody's week. */}
        {detail && (detail.goals.length || detail.tags.length) ? (
          <>
            <Rule />
            <Section>
              {detail.goals.length ? (
                <>
                  <SectionHead title="Good For" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: detail.tags.length ? sp.lg : 0 }}>
                    {detail.goals.map((g) => (
                      <View key={g} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ ...ty.caption, color: t.ink2 }}>{g}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
              {detail.tags.length ? (
                <>
                  <SectionHead title="Filed Under" />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {detail.tags.map((g) => (
                      <View key={g} style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ ...ty.caption, color: t.ink2 }}>{g}</Text>
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
          <Ghost label={clip ? 'Your Clip Library' : 'Record a clip for this movement'} icon="video"
            onPress={() => router.push('/(trainer)/videos')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
