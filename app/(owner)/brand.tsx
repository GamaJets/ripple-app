// Owner · White-label Studio. Set the app name and pick the primary palette
// (one of 10). Applies live app-wide and persists. Optional custom accent too.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero: this is a settings screen — there is no live
// metric to lead with, so it leads with the thing you change. The colour
// swatches stay: on a white-label screen the colours *are* the content.
//
// Removed: the live preview used to show a "Daily target · 1,980 kcal" tile.
// That number belonged to nobody — no provider, no prop, no computation — and
// the preview demonstrates the palette just as well without inventing a figure.
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useThemeControls } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useBrand } from '../../src/ui/brand';
import { Icon } from '../../src/ui/Icon';

export default function OwnerBrand() {
  const t = useTheme();
  const { palette, setPalette, palettes, setAccent } = useThemeControls();
  const { appName, setAppName } = useBrand();
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md } as const;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Owner</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>White-label Studio</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Rebrand the whole app — applies live and persists</Text>
        </View>

        <Section>
          <SectionHead title="App name" />
          <TextInput value={appName} onChangeText={setAppName} placeholder="Your brand" placeholderTextColor={t.ink3} style={inp} />
        </Section>

        <Rule />

        {/* ── the colours are the content, not decoration ────────────────── */}
        <Section>
          <SectionHead title="Primary palette" note={palettes.find((p) => p.key === palette)?.name} />
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>Tap a colour — the whole app rethemes instantly.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md }}>
            {palettes.map((p) => {
              const on = p.key === palette;
              return (
                <Pressable key={p.key} onPress={() => { setAccent(null); setPalette(p.key); }} accessibilityRole="button" accessibilityLabel={p.name}
                  style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: p.theme.bg, borderWidth: on ? 2 : hairline, borderColor: on ? t.brand : t.ring, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: p.theme.brand }} />
                  {on ? <View style={{ position: 'absolute', bottom: 3, right: 3 }}><Icon name="check" size={13} color={t.brand} /></View> : null}
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Rule />

        {/* ── live preview: chrome and the primary action, no invented data ─ */}
        <Section>
          <SectionHead title="Live preview" />
          <View style={{ backgroundColor: t.surface, borderRadius: radius.md, overflow: 'hidden', ...elevation.e1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg, backgroundColor: t.surface2 }}>
              <View style={{ width: 32, height: 32, borderRadius: radius.sm, backgroundColor: t.brand }} />
              <Text style={{ ...ty.head, color: t.ink }}>{appName}</Text>
            </View>
            <View style={{ padding: sp.lg }}>
              <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>Body copy, headings and the primary action, in your colours.</Text>
              <View style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Start today's workout</Text>
              </View>
            </View>
          </View>
        </Section>

        <Rule />

        <Section>
          <View style={{ alignSelf: 'flex-start' }}>
            <Ghost label="Reset to default branding"
              onPress={() => { setAccent(null); setPalette('teal'); setAppName('Repple'); Alert.alert('Reset', 'Branding restored to Repple defaults.'); }} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
            On Studio plans each trainer gets this panel for their own client app — their logo, colours, and domain. You keep the platform fee.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
