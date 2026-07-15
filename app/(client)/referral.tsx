// Client · Invite Friends. Share a personal referral code to bring friends onto
// the app. Uses the core React Native Share sheet (OTA-safe, no native module).
// The code is derived deterministically from the user so it's stable and can be
// credited once reward attribution is wired on the backend.
import { View, Text, Pressable, ScrollView, Share } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useBrand } from '../../src/ui/brand';

function codeFrom(name: string, id: string): string {
  const first = (name.trim().split(' ')[0] || 'REP').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'REP';
  let h = 0;
  const seed = id || name || 'repple';
  for (let i = 0; i < seed.length; i++) { h = (h * 31 + seed.charCodeAt(i)) >>> 0; }
  const tag = h.toString(36).toUpperCase().slice(0, 4).padStart(4, '0');
  return first + '-' + tag;
}

export default function Referral() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { appName } = useBrand();
  const code = codeFrom(c.name, c.id);
  const shareMsg = `Join me on ${appName} — the app I use to plan workouts, track progress and dial in my nutrition. Use my code ${code} when you sign up.`;

  const steps = [
    { n: '1', label: 'Share your code', note: 'Send it to a friend or training partner.' },
    { n: '2', label: 'They join ' + appName, note: 'They enter your code when they sign up.' },
    { n: '3', label: 'Train together', note: 'Keep each other consistent and accountable.' },
  ];

  const invite = async () => {
    try { await Share.share({ message: shareMsg }); } catch { /* user cancelled */ }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Invite friends</Text>
        <Text style={{ color: t.ink3, marginTop: 4, marginBottom: 20, fontSize: 14, lineHeight: 20 }}>Training is easier with company. Share {appName} with a friend using your personal code.</Text>

        <View style={{ backgroundColor: t.surface, borderColor: t.brand, borderWidth: 1, borderRadius: 18, padding: 20, alignItems: 'center', marginBottom: 22 }}>
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }}>Your code</Text>
          <Text style={{ color: t.brand, fontSize: 30, fontWeight: '800', letterSpacing: 2, marginTop: 6, fontFamily: 'Georgia' }}>{code}</Text>
        </View>

        {steps.map((s) => (
          <View key={s.n} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 14 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: t.brand, fontWeight: '800', fontSize: 15 }}>{s.n}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{s.label}</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 1 }}>{s.note}</Text>
            </View>
          </View>
        ))}

        <Pressable onPress={invite} accessibilityRole="button" accessibilityLabel="Share my invite" style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 10, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          <Icon name="share" size={17} color={t.brandInk} />
          <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Share my invite</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
