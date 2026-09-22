// Client · Resources. One screen for what a member reads or watches rather
// than logs: their coach's documents, the exercise library (which is also
// where a coach's how-to clips play; there is no separate client video
// screen), and the full directory. Every row is an existing screen; this
// reads nothing, so there is no loading or failed state to draw.
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, ListRow, PageHead } from '../../src/ui/kit';
import { layout } from '../../src/theme/scale';

export default function Resources() {
  const t = useTheme();
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <PageHead title="Resources" subtitle="What to read and watch" />

        <Section>
          <SectionHead title="From Your Coach" />
          <ListRow icon="pencil" tone="teal" title="Documents From Your Coach" note="Waivers and forms your coach asks you to read"
            onPress={() => router.push({ pathname: '/(client)/coach-documents', params: { kind: 'paperwork' } })} />
          <ListRow icon="video" tone="blue" title="Exercise Library" note="How-to videos from your coach"
            onPress={() => router.push('/(client)/library')} />
        </Section>

        {/* Guides are coach documents of their own kind (part 3290): the
            same screen, opened on that kind only. */}
        <Section>
          <SectionHead title="Guides" />
          <ListRow icon="meals" tone="orange" title="Nutrition Guides" note="Meal guides and advice from your coach"
            onPress={() => router.push({ pathname: '/(client)/coach-documents', params: { kind: 'nutrition' } })} />
          <ListRow icon="sparkle" tone="purple" title="Learn" note="Reading your coach has shared with you"
            onPress={() => router.push({ pathname: '/(client)/coach-documents', params: { kind: 'education' } })} />
        </Section>

        <Section>
          <SectionHead title="Everything Else" />
          <ListRow icon="search" tone="neutral" title="Explore" note="Every screen in the app, searchable"
            onPress={() => router.push('/(client)/explore')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
