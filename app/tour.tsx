// First-run tour — the thing two testers asked for in the same week.
//
//   "I found out that this is too complicated and scary to be used - my first
//    instance is to delete the application as there is no instructions nor
//    guidance on how this is working!"
//   "Need to create a tutorial about the app once u download it quickly takes u
//    through the pages / features offered"
//
// One card per tab, in tab order, from the same sections the user guide uses.
// Skippable on every card — a tour you cannot escape is its own complaint — and
// shown once per app, then never again unless opened from the guide.
import { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../src/ui/components';
import { Section, Cta, Ghost, HeroCard, IconPlate, type Tone } from '../src/ui/kit';
import { sp, layout, type as ty } from '../src/theme/scale';
import { VARIANT, VARIANT_LABEL, HOME_ROUTE, type AppVariant } from '../src/lib/variant';
import { guideFor, GUIDE_INTRO } from '../src/lib/guide';

const STEP_TONES: Tone[] = ['brand', 'blue', 'purple', 'orange', 'teal', 'pink'];

/** Per app, so installing the coach app still gets its own tour. */
export const tourKey = (v: AppVariant) => `repple.tour.seen.${v}`;

export async function markTourSeen(v: AppVariant): Promise<void> {
  try { await AsyncStorage.setItem(tourKey(v), '1'); } catch { /* a tour we cannot remember is better than a crash */ }
}

export async function hasSeenTour(v: AppVariant): Promise<boolean> {
  try { return (await AsyncStorage.getItem(tourKey(v))) === '1'; } catch { return true; }
}

export default function Tour() {
  const t = useTheme();
  const router = useRouter();
  const sections = guideFor(VARIANT);
  const [i, setI] = useState(0);
  const last = i >= sections.length - 1;
  const s = sections[i];

  const leave = async () => {
    await markTourSeen(VARIANT);
    const home = HOME_ROUTE[VARIANT];
    router.replace(home as any);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: 32, flexGrow: 1 }}>
        {/* The step's night head: which app and how far through, the tab's
            name in Sora, its one-line summary, and the pips — bright for the
            steps reached, the night's own tile for the ones ahead. Said once,
            as the hero's spoken line; the pips are its picture. */}
        <HeroCard eyebrow={`${VARIANT_LABEL[VARIANT]} · ${i + 1} of ${sections.length}`.toUpperCase()} title={s.tab} meta={s.summary}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={{ flexDirection: 'row', gap: 6, marginTop: sp.lg }}>
            {sections.map((_, n) => (
              <View key={n} style={{ height: 6, flex: 1, borderRadius: 3, backgroundColor: n <= i ? t.brandBright : t.night2 }} />
            ))}
          </View>
        </HeroCard>
        {/* The app's own introduction, once, on the first step — it is about
            the whole app and was being repeated over every tab. */}
        {i === 0 ? <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>{GUIDE_INTRO[VARIANT]}</Text> : null}

        <Section>
          {s.points.map((p, n) => (
            <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: n === s.points.length - 1 ? 0 : sp.md }}>
              {/* One hue per step, so moving on is visibly a new page. */}
              <IconPlate icon="check" tone={STEP_TONES[i % STEP_TONES.length]} size={32} />
              <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{p}</Text>
            </View>
          ))}
        </Section>

        <View style={{ flex: 1 }} />

        <View style={{ gap: sp.sm, marginTop: sp.xl }}>
          <Cta label={last ? 'Start Using the App' : 'Next'} onPress={() => (last ? leave() : setI(i + 1))} />
          {/* Back and Skip take the row; the hint sits under them on its own
              line. It used to share the row and had nowhere to wrap, so it ran
              off the right edge and lost its last word. */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: sp.sm }}>
            <View style={{ minWidth: 64 }}>
              {i > 0 ? <Ghost label="Back" onPress={() => setI(i - 1)} /> : null}
            </View>
            <View style={{ minWidth: 64, alignItems: 'flex-end' }}>
              <Ghost label="Skip" onPress={leave} />
            </View>
          </View>
          {/* ty.caption, not ty.micro: micro is uppercase with wide tracking,
              which is right for a label like GETTING STARTED and wrong for a
              sentence — it was what made this too wide to fit in the first place. */}
          <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', paddingHorizontal: sp.lg }}>
            You can reopen this any time from the user guide.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
