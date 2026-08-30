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
import { Section, SectionHead, Cta, Ghost } from '../src/ui/kit';
import { sp, layout, radius, type as ty } from '../src/theme/scale';
import { VARIANT, VARIANT_LABEL, HOME_ROUTE, type AppVariant } from '../src/lib/variant';
import { guideFor, GUIDE_INTRO } from '../src/lib/guide';

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
        <Text style={{ ...ty.micro, color: t.ink3 }}>GETTING STARTED</Text>
        <Text style={{ ...ty.title, color: t.ink, marginTop: 2 }}>{VARIANT_LABEL[VARIANT]}</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>{GUIDE_INTRO[VARIANT]}</Text>

        {/* progress — which of the tabs we are on */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: sp.xl }}>
          {sections.map((_, n) => (
            <View key={n} style={{ height: 3, flex: 1, borderRadius: 2, backgroundColor: n <= i ? t.brand : t.surface2 }} />
          ))}
        </View>

        <Section>
          <SectionHead title={s.tab} note={`${i + 1} of ${sections.length}`} />
          <Text style={{ ...ty.body, color: t.ink, marginBottom: sp.lg }}>{s.summary}</Text>
          {s.points.map((p, n) => (
            <View key={n} style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
              <Text style={{ ...ty.body, color: t.brand }}>•</Text>
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
