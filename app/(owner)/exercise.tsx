// Owner · One exercise, explained.
//
// Deliberately the same screen as app/(client)/exercise.tsx: same illustration
// renderer (src/ui/ExerciseDemo), same chips, same "Muscles worked" and "How to
// do it" sections, same words for a movement we have no picture of. An owner
// checking what their members will be shown should be looking at what their
// members will be shown, and a second visual language for the same rows would
// make that check worthless.
//
// ── What is different, and why ─────────────────────────────────────────────
//
// The client screen prefers their OWN coach's clip over the catalogue artwork,
// because a member should see the person who actually trains them. An owner has
// no coach, and there is no clip that is theirs — so this screen shows the
// bought animation where the licence allows it and the catalogue frames
// otherwise, which is the platform's own material and the thing being assessed.
//
// The description leads. It is the field the RepDB catalogue was adopted for:
// it says what a movement IS, where `instructions` say how to perform it, and an
// owner deciding whether the app covers their classes is asking the first
// question. Rows imported before RepDB carry no description, and those show
// nothing — never a filler sentence, because a fabricated description of a lift
// is a fabricated fact about a product somebody is buying.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useExerciseDetail } from '../../src/ui/exerciseDetail';
import { DemoAnimation, FrameLoop } from '../../src/ui/ExerciseDemo';
import { FRAMES_ARE_UNHOSTED, demoCaption } from '../../src/lib/exerciseMedia';
import { useExerciseMedia } from '../../src/ui/useExerciseMedia';
import { catalogueValue as cap } from '../../src/lib/format';
import { supabase } from '../../src/lib/supabase';
import { RepdbInlineCredit } from '../../src/ui/Attribution';


export default function OwnerExercise() {
  const t = useTheme();
  const router = useRouter();
  const { name: raw } = useLocalSearchParams<{ name?: string }>();
  const name = (raw || '').trim();
  const { detail, status } = useExerciseDetail(name);

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
                one visible credit and the Credits card in settings is it; this
                costs a line and is worth more where somebody is looking. */}
            {detail?.source === 'repdb' ? <RepdbInlineCredit /> : null}
          </>
        ) : (
          // No animation and no frames. Said plainly, rather than a grey
          // silhouette implying a demonstration we do not have — which on this
          // screen would misrepresent the product to the person buying it.
          <Notice tone={t.ink3} kicker="Demonstration"
            title={detail ? 'No illustration for this one' : 'Not in Our Catalogue'}
            note={detail
              ? 'This movement has no artwork, so members see its name, its muscles and the written steps. Your coaches can film their own clip for it from the trainer app.'
              : 'This movement is not in our catalogue, so there is no guide for it — nothing here is missing because of an error.'} />
        )}

        {FRAMES_ARE_UNHOSTED && frames.length ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.warn}>Illustrations are served from the source dataset — not for release.</Flag>
          </View>
        ) : null}

        {detail ? (
          <>
            {/* ── what it is ───────────────────────────────────────────── */}
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
              {/* The owner's question, answered on the row that answers it: is
                  this movement one our floor can actually support. An absent
                  equipment column is a gap in the catalogue and says so — it is
                  not a claim that the exercise needs nothing. */}
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
                      forgot to render, not as a gap we know about. */}
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    No written steps for this one yet, so members see the illustration and the muscle list.
                  </Text>
                </Section>
              </>
            ) : null}
          </>
        ) : null}

        <Rule />
        <Section>
          <Ghost label="Exercise Library" icon="dumbbell" onPress={() => router.push('/(owner)/library')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
