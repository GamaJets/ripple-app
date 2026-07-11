// Trainer · Analytics — revenue, clients, retention, platform fee.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { MOCK_TRAINER } from '../../src/lib/mockData';
import { ROSTER } from '../../src/lib/trainerMock';

function Big({ t, label, value, sub, tint }: { t: Theme; label: string; value: string; sub: string; tint?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: tint ? t.brand : t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
      <Text style={{ color: tint ? t.brandInk : t.ink3, fontSize: 12, fontWeight: '700', opacity: tint ? 0.85 : 1 }}>{label}</Text>
      <Text style={{ color: tint ? t.brandInk : t.ink, fontSize: 26, fontWeight: '800', textTransform: 'capitalize', marginTop: 6 }}>{value}</Text>
      <Text style={{ color: tint ? t.brandInk : t.ink3, fontSize: 11, marginTop: 2, opacity: tint ? 0.85 : 1 }}>{sub}</Text>
    </View>
  );
}

export default function TrainerAnalytics() {
  const t = useTheme();
  const clients = ROSTER.length;
  const sessionsMo = clients * 4;
  const revenue = sessionsMo * MOCK_TRAINER.sessionFee;
  const platformFee = 99;
  const net = revenue - platformFee;
  const avgAdh = Math.round(ROSTER.reduce((a, c) => a + c.adherence, 0) / clients);
  const months = [['Feb', 0.55], ['Mar', 0.62], ['Apr', 0.7], ['May', 0.82], ['Jun', 0.9], ['Jul', 1]] as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>Analytics</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Your coaching business at a glance</Text>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <Big t={t} label="Monthly revenue" value={'$' + revenue.toLocaleString()} sub={`${sessionsMo} sessions × $${MOCK_TRAINER.sessionFee}`} tint />
          <Big t={t} label="Net after fee" value={'$' + net.toLocaleString()} sub={`− $${platformFee} platform`} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <Big t={t} label="Active clients" value={String(clients)} sub="all retained" />
          <Big t={t} label="Avg adherence" value={avgAdh + '%'} sub="across clients" />
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginBottom: 14 }}>Revenue trend</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 90 }}>
            {months.map(([mo, f]) => (
              <View key={mo} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                <View style={{ width: '62%', height: 18 + (f as number) * 60, borderRadius: 6, backgroundColor: mo === 'Jul' ? t.brand : t.surface3 }} />
                <Text style={{ color: t.ink3, fontSize: 11 }}>{mo}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ backgroundColor: t.surface2, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
          <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 20 }}>
            You’re on the <Text style={{ color: t.brand, fontWeight: '800' }}>Pro</Text> plan (${platformFee}/mo to Repple). Add clients or session packages to grow — every new client at ${MOCK_TRAINER.sessionFee}/session adds about ${MOCK_TRAINER.sessionFee * 4}/mo.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
