// Post-login router / role chooser. Redirects to the welcome screen when
// signed out; otherwise lets you enter a portal.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useTheme } from '../src/ui/components';
import type { Theme } from '../src/theme/tokens';
import { useAuth } from '../src/ui/auth';

function Ripple({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color, opacity: 0.35 }} />
      <View style={{ position: 'absolute', width: size * 0.6, height: size * 0.6, borderRadius: size, borderWidth: 2.5, borderColor: color, opacity: 0.65 }} />
      <View style={{ width: size * 0.24, height: size * 0.24, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

function Portal({ t, icon, title, sub, onPress }: { t: Theme; icon: string; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24 }}>{icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>{title}</Text>
        <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2 }}>{sub}</Text>
      </View>
      <Text style={{ color: t.ink3, fontSize: 22 }}>›</Text>
    </Pressable>
  );
}

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const { authed, user, signOut } = useAuth();

  if (!authed) return <Redirect href="/welcome" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}><Ripple size={28} color={t.brandInk} /></View>
          <Text style={{ color: t.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 }}>Repple</Text>
        </View>
        <Text style={{ color: t.ink3, fontSize: 14, marginBottom: 30 }}>Signed in as {user?.email} · demo data</Text>
        <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Choose a portal</Text>
        <Portal t={t} icon="🏃" title="Client App" sub="Program, meals, progress, booking" onPress={() => router.push('/(client)/dashboard')} />
        <Portal t={t} icon="🧑‍🏫" title="Trainer Portal" sub="Clients, schedule, videos, analytics" onPress={() => router.push('/(trainer)/dashboard')} />
        <Portal t={t} icon="👑" title="Platform Owner" sub="Trainers, billing, white-label, growth" onPress={() => router.push('/(owner)/dashboard')} />

        <Pressable onPress={signOut} accessibilityRole="button" accessibilityLabel="Sign out" style={{ marginTop: 18, alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 18 }}>
          <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
