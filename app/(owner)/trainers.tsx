import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { TRAINERS, PLANS } from '../../src/lib/ownerMock';
export default function OwnerTrainers() {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Trainers &amp; billing</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Everyone paying to run Repple</Text>
        {TRAINERS.map((tr) => (
          <View key={tr.id} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.brand, fontWeight: '800' }}>{tr.name.split(' ').map((x) => x[0]).join('')}</Text></View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{tr.name}</Text>{tr.status === 'trial' && <View style={{ backgroundColor: 'rgba(250,178,25,0.18)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ color: t.warn, fontSize: 10, fontWeight: '800' }}>TRIAL</Text></View>}</View>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{tr.plan} · {tr.clients} clients · since {tr.since}</Text>
            </View>
            <Text style={{ color: t.brand, fontWeight: '800', fontSize: 15 }}>${tr.mrr}<Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}>/mo</Text></Text>
          </View>
        ))}
        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginTop: 8, marginBottom: 10 }}>Plans</Text>
        {PLANS.map((p) => (
          <View key={p.name} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>{p.name}</Text><Text style={{ color: t.brand, fontWeight: '800', fontSize: 16 }}>${p.price}<Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}>/mo</Text></Text></View>
            {p.feats.map((f) => <Text key={f} style={{ color: t.ink3, fontSize: 13, marginTop: 3 }}>· {f}</Text>)}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
