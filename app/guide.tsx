// In-app user guide — the reference version of the first-run tour.
//
// Testers asked for two different things and this is the second: "a user guide
// built so it is in the app so users can reference it in the future." The tour
// runs once; this stays.
//
// Both still read from one source (src/lib/guideContent.ts), so the guide can
// never describe the app differently from the tour. What differs is how much of
// it each one shows: the tour takes the tabs, trimmed; this screen shows every
// point of every tab and then the sections that are not a tab at all — the ones
// somebody actually opens a guide to look up.
//
// The two lists are separated by a heading rather than run together, because a
// section headed "Injuries" sitting in a list of tab names reads as a tab that
// has gone missing from the bar.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import { Rule, Section, SectionHead, Ghost } from '../src/ui/kit';
import { sp, layout, type as ty } from '../src/theme/scale';
import { VARIANT, VARIANT_LABEL } from '../src/lib/variant';
import { tabsFor, topicsFor, GUIDE_INTRO, type GuideSection } from '../src/lib/guideContent';

export default function Guide() {
  const t = useTheme();
  const router = useRouter();
  const tabs = tabsFor(VARIANT);
  const topics = topicsFor(VARIANT);

  // One section, whichever list it came from. The two are rendered identically
  // on purpose — the difference between them is where they sit and what the
  // kicker above them says, not how important they are.
  const Block = ({ s }: { s: GuideSection }) => (
    <View>
      <Section>
        <SectionHead title={s.title} />
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
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: 48 }}>
        <Text style={{ ...ty.micro, color: t.ink3 }}>USER GUIDE</Text>
        <Text style={{ ...ty.title, color: t.ink, marginTop: 2 }}>{VARIANT_LABEL[VARIANT]}</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>{GUIDE_INTRO[VARIANT]}</Text>

        <Rule />

        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>THE TABS</Text>
        {tabs.map((s) => <Block key={s.title} s={s} />)}

        {topics.length ? (
          <>
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>ACROSS THE APP</Text>
            {topics.map((s) => <Block key={s.title} s={s} />)}
          </>
        ) : null}

        <Section style={{ alignItems: 'center' }}>
          <Ghost label="Done" onPress={() => router.back()} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
