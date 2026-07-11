import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { PLANS } from '../../src/lib/ownerMock';
function Big({ t, label, value, sub, tint }: { t: Theme; label: string; value: string; sub: string; tint?: boolean }) {
  return (<View style={{ flex: 1, backgroundColor: tint ? t.brand : t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
    <Text style={{ color: tint ? t.brandInk : t.ink3, fontSize: 12, fontWeight: '700', opacity: tint ? 0.85 : 1 }}>{label}</Text>
    <Text style={{ color: tint ? t.brandInk : t.ink, fontSize: 26, fontWeight: '800', textTransform: 'capitalize', marginTop: 6 }}>{value}</Text>
    <Text style={{ color: tint ? t.brandInk : t.ink3, fontSize: 11, marginTop: 2, opacity: tint ? 0.85 : 1 }}>{sub}</Text></View>);
}
export default function OwnerOverview() {
  const t = useTheme(); const router = useRouter();
  const { trainers, activeMrr } = usePlatformTrainers();
  const mrr = activeMrr;
  const clients = trainers.reduce((a, x) => a + x.clients, 0);
  const byPlan = PLANS.map((p) => ({ name: p.name, revenue: trainers.filter((x) => x.plan === p.name && x.status !== 'suspended').reduce((a, x) => a + x.mrr, 0) }));
  const maxPlan = Math.max(1, ...byPlan.map((p) => p.revenue));
  const months = [['Feb', 0.3], ['Mar', 0.42], ['Apr', 0.55], ['May', 0.7], ['Jun', 0.85], ['Jul', 1]] as const;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <View><Text style={{ color: t.ink3, fontSize: 14 }}>Platform</Text><Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>Repple HQ</Text></View>
          <Pressable onPress={() => router.push('/')} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 12 }}>Switch role</Text></Pressable>
        </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
          {([["🧑‍🏫","Trainers","/(owner)/trainers"],["🎨","Brand","/(owner)/brand"],["📈","Growth","/(owner)/growth"],["🛠️","Ops","/(owner)/ops"]] as const).map(([ic, label, route]) => (
            <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Text style={{ fontSize: 14 }}>{ic}</Text><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
<View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <Big t={t} label="Platform MRR" value={'$' + mrr.toLocaleString()} sub="from trainer fees" tint />
          <Big t={t} label="Trainers" value={String(trainers.length)} sub={trainers.filter((x) => x.status === 'trial').length + ' on trial'} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <Big t={t} label="End clients" value={String(clients)} sub="across all trainers" />
          <Big t={t} label="ARR" value={'$' + (mrr * 12).toLocaleString()} sub="annualised" />
        </View>
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginBottom: 14 }}>Revenue by plan</Text>
          {byPlan.map((p) => (
            <View key={p.name} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}><Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{p.name}</Text><Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>${p.revenue}/mo</Text></View>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: t.surface3, overflow: 'hidden' }}><View style={{ height: 10, borderRadius: 5, backgroundColor: t.brand, width: `${Math.round((p.revenue / maxPlan) * 100)}%` }} /></View>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginBottom: 14 }}>MRR growth</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 90 }}>
            {months.map(([m, f]) => (<View key={m} style={{ flex: 1, alignItems: 'center', gap: 6 }}><View style={{ width: '62%', height: 18 + (f as number) * 60, borderRadius: 6, backgroundColor: m === 'Jul' ? t.brand : t.surface3 }} /><Text style={{ color: t.ink3, fontSize: 11 }}>{m}</Text></View>))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
