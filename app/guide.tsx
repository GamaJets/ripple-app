// In-app user guide — the reference version of the first-run tour.
//
// Testers asked for two different things and this is the second: "a user guide
// built so it is in the app so users can reference it in the future." The tour
// runs once; this stays. Both read the same sections from src/lib/guide.ts, so
// the guide can never describe the app differently from the tour.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { Rule, Section, SectionHead, Ghost } from '../src/ui/kit';
import { sp, layout, type as ty } from '../src/theme/scale';
import { VARIANT, VARIANT_LABEL } from '../src/lib/variant';
import { guideFor, GUIDE_INTRO } from '../src/lib/guide';

export default function Guide() {
  const t = useTheme();
  const router = useRouter();
  const sections = guideFor(VARIANT);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: 48 }}>
        <Text style={{ ...ty.micro, color: t.ink3 }}>USER GUIDE</Text>
        <Text style={{ ...ty.title, color: t.ink, marginTop: 2 }}>{VARIANT_LABEL[VARIANT]}</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{GUIDE_INTRO[VARIANT]}</Text>

        <Rule />

        {sections.map((s) => (
          <View key={s.tab}>
            <Section>
              <SectionHead title={s.tab} />
              <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.md }}>{s.summary}</Text>
              {s.points.map((p, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.sm }}>
                  <Text style={{ ...ty.body, color: t.brand }}>•</Text>
                  <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{p}</Text>
                </View>
              ))}
            </Section>
            <Rule />
          </View>
        ))}

        <Section style={{ alignItems: 'center' }}>
          <Ghost label="Done" onPress={() => router.back()} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
