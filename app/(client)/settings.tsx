// Client · Settings & About. Notification prefs, unit preference, legal, and a
// what's-new changelog. Profile hub.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useSettings } from '../../src/ui/settings';

const CHANGELOG = [
  { v: '2.2', notes: ['Coach program builder', 'Coach feedback & meal-plan adjustments', 'Body measurements, weekly report & goal tracker', 'Lifting tools + recovery screen'] },
  { v: '2.1', notes: ['Live white-label branding', 'Owner trainer management & promo codes'] },
  { v: '2.0', notes: ['Real accounts & sign-in', 'Three portals: client, trainer, owner'] },
];

function Toggle({ t, on, onPress }: { t: Theme; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: on ? t.brand : t.surface3, justifyContent: 'center', padding: 3 }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignSelf: on ? 'flex-end' : 'flex-start' }} />
    </Pressable>
  );
}

function Row({ t, label, sub, right }: { t: Theme; label: string; sub?: string; right: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.ring }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: t.ink, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        {sub ? <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const st = useSettings();
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Settings</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Preferences, legal & version</Text>

        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Notifications</Text>
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, paddingHorizontal: 14, marginBottom: 18 }}>
          <Row t={t} label="Push notifications" sub="Session reminders, PRs, coach messages" right={<Toggle t={t} on={st.notifPush} onPress={() => st.set({ notifPush: !st.notifPush })} />} />
          <Row t={t} label="Email updates" sub="Weekly summary & tips" right={<Toggle t={t} on={st.notifEmail} onPress={() => st.set({ notifEmail: !st.notifEmail })} />} />
        </View>

        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Units</Text>
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, paddingHorizontal: 14, marginBottom: 18 }}>
          <Row t={t} label="Body weight" right={
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['kg', 'lb'] as const).map((u) => (
                <Pressable key={u} onPress={() => st.set({ weightUnit: u })} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9, backgroundColor: st.weightUnit === u ? t.brand : t.surface2, borderWidth: 1, borderColor: st.weightUnit === u ? t.brand : t.ring }}>
                  <Text style={{ color: st.weightUnit === u ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 13 }}>{u}</Text>
                </Pressable>
              ))}
            </View>
          } />
        </View>

        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Appearance</Text>
        <Pressable onPress={() => router.push('/(client)/appearance')} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 18, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: t.ink, fontSize: 15, fontWeight: '600' }}>Theme & accent colour</Text>
          <Text style={{ color: t.ink3, fontSize: 18 }}>›</Text>
        </Pressable>

        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Legal</Text>
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, paddingHorizontal: 14, marginBottom: 18 }}>
          <Pressable onPress={() => setLegal(legal === 'privacy' ? null : 'privacy')}><Row t={t} label="Privacy Policy" right={<Text style={{ color: t.ink3, fontSize: 16 }}>{legal === 'privacy' ? '▾' : '›'}</Text>} /></Pressable>
          {legal === 'privacy' ? <Text style={{ color: t.ink3, fontSize: 13, lineHeight: 19, paddingVertical: 10 }}>We store your training, nutrition and body data to power your plan. Health data is never sold or shared with advertisers. You can export or delete your data at any time from your account. Photos and scans are stored securely and visible only to you and your coach.</Text> : null}
          <Pressable onPress={() => setLegal(legal === 'terms' ? null : 'terms')}><Row t={t} label="Terms of Service" right={<Text style={{ color: t.ink3, fontSize: 16 }}>{legal === 'terms' ? '▾' : '›'}</Text>} /></Pressable>
          {legal === 'terms' ? <Text style={{ color: t.ink3, fontSize: 13, lineHeight: 19, paddingVertical: 10 }}>Repple provides fitness and nutrition guidance for general wellness and is not a substitute for medical advice. Consult a physician before starting any program. Coaching is delivered by independent trainers on the platform; billing terms are shown at checkout.</Text> : null}
        </View>

        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>What's new</Text>
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 18 }}>
          {CHANGELOG.map((c) => (
            <View key={c.v} style={{ marginBottom: 12 }}>
              <Text style={{ color: t.brand, fontWeight: '800', fontSize: 14, marginBottom: 4 }}>v{c.v}</Text>
              {c.notes.map((n) => <Text key={n} style={{ color: t.ink3, fontSize: 13, marginTop: 2 }}>· {n}</Text>)}
            </View>
          ))}
        </View>

        <Text style={{ color: t.ink3, fontSize: 12, textAlign: 'center' }}>Repple · v2.2 · made for coaches & their clients</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
