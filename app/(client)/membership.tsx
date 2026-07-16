// Client · Membership. The gym-member home: card (number, plan, validity), this
// month's visits, and quick actions — entry barcode, classes, personal training,
// offers, refer a friend. Positions the app as the member's daily gym companion.
import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useBrand } from '../../src/ui/brand';
import { defaultMembership } from '../../src/lib/membership';

export default function Membership() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log } = useWorkoutLog();
  const { appName } = useBrand();
  const m = defaultMembership(c.name, c.id);

  const { visits, last } = useMemo(() => {
    const now = new Date();
    const days = new Set<string>();
    let latest = 0;
    for (const e of log) {
      const d = new Date(e.t);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) days.add(d.toDateString());
      const ts = Date.parse(e.t); if (ts > latest) latest = ts;
    }
    const lastLabel = latest ? new Date(latest).toLocaleDateString() : '—';
    return { visits: days.size, last: lastLabel };
  }, [log]);

  const actions: { label: string; icon: any; route: string; hero?: boolean }[] = [
    { label: 'Entry barcode', icon: 'grid', route: '/(client)/access', hero: true },
    { label: 'Classes', icon: 'calendar', route: '/(client)/classes' },
    { label: 'Personal training', icon: 'people', route: '/(client)/calendar' },
    { label: 'My bookings', icon: 'check', route: '/(client)/calendar' },
    { label: 'Offers', icon: 'sparkle', route: '/(client)/explore' },
    { label: 'Refer a friend', icon: 'share', route: '/(client)/referral' },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Membership</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>Your {appName} membership, entry pass and quick actions.</Text>

        {/* Membership card */}
        <View style={{ backgroundColor: t.brand, borderRadius: 18, padding: 20, marginBottom: 14 }}>
          <Text style={{ color: t.brandInk, fontSize: 20, fontWeight: '800' }}>{c.name || 'Member'}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
            {[['Member No.', m.memberNo], ['Plan', m.plan], ['Valid until', m.validUntil]].map(([l, v]) => (
              <View key={l} style={{ flex: 1 }}>
                <Text style={{ color: t.brandInk, opacity: 0.7, fontSize: 10.5, fontWeight: '700' }}>{l}</Text>
                <Text style={{ color: t.brandInk, fontSize: 13.5, fontWeight: '800', marginTop: 2 }}>{v}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Visits */}
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Visits this month</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', marginTop: 4 }}>{visits}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Last visit</Text>
            <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800', marginTop: 6 }}>{last}</Text>
          </View>
        </View>

        {/* Entry barcode hero */}
        <Pressable onPress={() => router.push('/(client)/access')} accessibilityRole="button" accessibilityLabel="Show entry barcode" style={{ backgroundColor: t.ink, borderRadius: 16, padding: 18, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="grid" size={22} color={t.bg} />
            <View><Text style={{ color: t.bg, fontWeight: '800', fontSize: 15 }}>Show entry barcode</Text><Text style={{ color: t.bg, opacity: 0.6, fontSize: 12, marginTop: 1 }}>Scan at the gym entrance</Text></View>
          </View>
          <Text style={{ color: t.bg, fontWeight: '800', fontSize: 18 }}>›</Text>
        </Pressable>

        {/* Quick actions */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 11 }}>
          {actions.filter((a) => !a.hero).map((a) => (
            <Pressable key={a.label} onPress={() => router.push(a.route as any)} accessibilityRole="button" accessibilityLabel={a.label} style={{ width: '47.5%', backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 }}>
              <Icon name={a.icon} size={22} color={t.brand} />
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
