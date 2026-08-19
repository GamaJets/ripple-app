// Appearance — pick one of 10 palettes. Applies live app-wide and persists.
// Available to clients and trainers.
//
// Re-skinned onto the kit (`src/ui/kit`) + scale (`src/theme/scale`): ten
// bordered boxes became ten hairline-separated rows, so the swatches — the
// only thing on this screen carrying information — are what you see.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme, useThemeControls } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';

export default function Appearance() {
  const t = useTheme();
  const router = useRouter();
  const { palette, setPalette, palettes } = useThemeControls();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Account</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Appearance</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Pick a colour theme — applies instantly across the app.</Text>

        <Rule />

        <Section>
          <SectionHead title="Palette" note={String(palettes.length)} />
          {palettes.map((p, i) => {
            const on = p.key === palette;
            const th = p.theme;
            return (
              <Pressable key={p.key} onPress={() => setPalette(p.key)} accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.light ? 'light' : 'dark'} theme`} accessibilityState={{ selected: on }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                {/* mini theme swatch */}
                <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: th.bg, borderWidth: hairline, borderColor: th.ring, overflow: 'hidden', flexDirection: 'row', alignItems: 'flex-end' }}>
                  <View style={{ flex: 1, height: '55%', backgroundColor: th.surface }} />
                  <View style={{ width: 16, height: 16, borderRadius: radius.pill, backgroundColor: th.brand, margin: 5 }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: on ? '600' : '500', color: t.ink }}>{p.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 1 }}>{p.light ? 'Light theme' : 'Dark theme'}</Text>
                </View>
                {on ? <Icon name="check" size={19} color={t.brand} /> : null}
              </Pressable>
            );
          })}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
