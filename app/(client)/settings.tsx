// Client · Settings & About. Notification prefs, unit preference, legal, your
// data (GDPR export / erasure), and the build this phone is actually running.
// Profile hub.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): hairline-separated sections instead of six stacked
// bordered boxes, three weights, no raw type sizes. Every route, hook,
// conditional and handler is unchanged.
//
// Removed in the migration: a hardcoded "What's new" changelog claiming
// v2.2 / v2.1 / v2.0 and a footer reading "v2.2". The app's real version is
// 1.0.0 (app.json) — those numbers came from nowhere and sat directly above
// <BuildInfo/>, which prints the true version. A false version defeats the
// whole point of the Build section.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { BuildInfo } from '../../src/ui/BuildInfo';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, ListRow, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { useSettings } from '../../src/ui/settings';
import { useAuth } from '../../src/ui/auth';
import { exportMyData, requestAccountDeletion } from '../../src/lib/gdpr';
import { shareTextFile } from '../../src/lib/exportShare';

function Toggle({ t, on, onPress }: { t: Theme; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface3, justifyContent: 'center', padding: 3 }}>
      <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: on ? 'flex-end' : 'flex-start' }} />
    </Pressable>
  );
}

function Row({ t, label, sub, right, first }: { t: Theme; label: string; sub?: string; right: React.ReactNode; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <View style={{ flex: 1, paddingRight: sp.md }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{label}</Text>
        {sub ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const st = useSettings();
  const auth = useAuth();
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const exportData = async () => {
    if (dataBusy) return; setDataBusy(true);
    try { const json = await exportMyData(); await shareTextFile(json, 'repple-my-data.json', 'application/json', 'Export my data'); } finally { setDataBusy(false); }
  };
  const deleteAccount = () => {
    Alert.alert('Delete your account?', 'This requests permanent deletion of your account and all your data. This cannot be undone.', [
      { text: 'Keep my account', style: 'cancel' },
      { text: 'Request deletion', style: 'destructive', onPress: async () => { const ok = await requestAccountDeletion(); Alert.alert(ok ? 'Deletion requested' : 'Request noted', ok ? 'Your account is scheduled for deletion and your data will be erased. You have been signed out.' : "We've recorded your request. If anything remains, contact support.", [{ text: 'OK', onPress: () => { try { auth.signOut(); } catch { /* ignore */ } } }]); } },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Account</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Settings</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Preferences, legal & version</Text>

        <Rule />

        <Section>
          <SectionHead title="Notifications" />
          <Row t={t} first label="Push notifications" sub="Session reminders, PRs, coach messages" right={<Toggle t={t} on={st.notifPush} onPress={() => st.set({ notifPush: !st.notifPush })} />} />
          <Row t={t} label="Email updates" sub="Weekly summary & tips" right={<Toggle t={t} on={st.notifEmail} onPress={() => st.set({ notifEmail: !st.notifEmail })} />} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Units" />
          <Row t={t} first label="Body weight" right={
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['kg', 'lb'] as const).map((u) => (
                <Pressable key={u} onPress={() => st.set({ weightUnit: u })} style={{ paddingHorizontal: sp.lg, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: st.weightUnit === u ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: st.weightUnit === u ? '600' : '500', color: st.weightUnit === u ? t.brandInk : t.ink2 }}>{u}</Text>
                </Pressable>
              ))}
            </View>
          } />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Appearance" />
          <ListRow icon="palette" title="Theme & accent colour" note="10 palettes, applied live"
            onPress={() => router.push('/(client)/appearance')} />
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Your data" />
          <Pressable onPress={exportData} accessibilityRole="button" accessibilityLabel="Export my data">
            <Row t={t} first label={dataBusy ? 'Preparing export…' : 'Export my data'} sub="Download everything we store about you (JSON)"
              right={<Text style={{ ...ty.head, color: t.brand }}>{'⤓'}</Text>} />
          </Pressable>
          <Pressable onPress={deleteAccount} accessibilityRole="button" accessibilityLabel="Delete my account">
            <Row t={t} label="Delete my account" sub="Request permanent erasure of your account and data" right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                <Icon name="chevron" size={15} color={t.ink3} />
              </View>
            } />
          </Pressable>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Legal" />
          <Pressable onPress={() => setLegal(legal === 'privacy' ? null : 'privacy')}>
            <Row t={t} first label="Privacy Policy" right={<Text style={{ ...ty.body, color: t.ink3 }}>{legal === 'privacy' ? '▾' : '›'}</Text>} />
          </Pressable>
          {legal === 'privacy' ? <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.sm }}>We store your training, nutrition and body data to power your plan. Health data is never sold or shared with advertisers. You can export or delete your data at any time from your account. Photos and scans are stored securely and visible only to you and your coach.</Text> : null}
          <Pressable onPress={() => setLegal(legal === 'terms' ? null : 'terms')}>
            <Row t={t} label="Terms of Service" right={<Text style={{ ...ty.body, color: t.ink3 }}>{legal === 'terms' ? '▾' : '›'}</Text>} />
          </Pressable>
          {legal === 'terms' ? <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.sm }}>Repple provides fitness and nutrition guidance for general wellness and is not a substitute for medical advice. Consult a physician before starting any program. Coaching is delivered by independent trainers on the platform; billing terms are shown at checkout.</Text> : null}
        </Section>

        <Rule />

        {/* Build — the diagnostic for whether an OTA actually landed on this phone. */}
        <Section>
          <SectionHead title="Build" />
          <BuildInfo />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Which bundle this phone is running. If a fix was published but isn't here, compare Channel and Update against the EAS dashboard before assuming it's a code bug.
          </Text>
        </Section>

        <Rule />

        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.xl }}>Repple · made for coaches & their clients</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
