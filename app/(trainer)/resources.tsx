// Coach · Resources. One screen that gathers the coach's reusable material:
// the programs they build once, the clips they have filmed, the forms clients
// accept, and the catalogue of movements. Every row is a screen that already
// existed and was reached from four different places; this adds none of its
// own data and reads nothing, so there is no loading or failed state to draw.
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
        <PageHead title="Resources" subtitle="What you build once and use with every client" />

        <Section>
          <SectionHead title="Training" />
          <ListRow icon="grid" tone="brand" title="Program Templates" note="Build once, assign to many clients"
            onPress={() => router.push('/(trainer)/templates')} />
          <ListRow icon="dumbbell" tone="blue" title="Exercise Library" note="What you can program, and what you have filmed"
            onPress={() => router.push('/(trainer)/library')} />
          <ListRow icon="video" tone="purple" title="Video Library" note="The exercise clips you have uploaded"
            onPress={() => router.push('/(trainer)/videos')} />
        </Section>

        <Section>
          <SectionHead title="Paperwork" />
          <ListRow icon="pencil" tone="teal" title="Forms & Documents" note="Your waivers and forms, and who accepted them"
            onPress={() => router.push('/(trainer)/documents')} />
        </Section>

        {/* Guides upload through the same Documents screen with their own
            kind (part 3290), and clients find them under Resources. */}
        <Section>
          <SectionHead title="Guides for Clients" />
          <ListRow icon="meals" tone="orange" title="Nutrition Guides" note="Upload a meal guide; clients find it under Nutrition Guides"
            onPress={() => router.push('/(trainer)/documents')} />
          <ListRow icon="sparkle" tone="purple" title="Client Education" note="Reading you want clients to have"
            onPress={() => router.push('/(trainer)/documents')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
