import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
export default function OwnerGrowth() {
  const t = useTheme();
  const funnel = [['Visited site', 100], ['Started trial', 38], ['Activated', 24], ['Paying', 18]] as const;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>Growth</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Acquisition &amp; retention</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}><Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>New this month</Text><Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 }}>+2</Text></View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}><Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Churn</Text><Text style={{ color: t.brand, fontSize: 22, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 }}>0%</Text></View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}><Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Trial→paid</Text><Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 }}>47%</Text></View>
        </View>
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginBottom: 14 }}>Trainer acquisition funnel</Text>
          {funnel.map(([label, pct]) => (
            <View key={label} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}><Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{label}</Text><Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>{pct}%</Text></View>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: t.surface3, overflow: 'hidden' }}><View style={{ height: 10, borderRadius: 5, backgroundColor: t.brand, width: pct + '%' }} /></View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
