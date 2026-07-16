// Owner · Financial health. KPIs, retention and an AI-style review of the gym's
// numbers with concrete improvement recommendations. Reads a financial snapshot
// (illustrative until accounting is connected) and analyses it live.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { sampleFinances, reviewFinances, type FinFlag } from '../../src/lib/financialAI';

const money = (n: number) => 'AED ' + Math.round(n).toLocaleString();

export default function Financials() {
  const t = useTheme();
  const router = useRouter();
  const [connected] = useState(false);
  const fin = useMemo(() => sampleFinances(), []);
  const r = useMemo(() => reviewFinances(fin), [fin]);
  const toneColor = (tone: FinFlag['tone']) => (tone === 'good' ? t.good : tone === 'watch' ? t.warn : t.crit);

  const kpis: [string, string, string?][] = [
    ['Revenue / mo', money(fin.revenue)],
    ['Net profit', money(r.netProfit)],
    ['Margin', r.marginPct.toFixed(0) + '%'],
    ['MRR', money(fin.mrr)],
    ['Members', fin.members.toLocaleString()],
    ['Churn', r.churnPct.toFixed(1) + '%'],
    ['Net growth', (r.growthPct >= 0 ? '+' : '') + r.growthPct.toFixed(1) + '%'],
    ['PT + classes', money(fin.ptRevenue + fin.classRevenue)],
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Financial health</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>How the gym is doing — with an AI review of where to improve.</Text>

        {/* Connect accounting */}
        <Pressable onPress={() => Alert.alert('Connect accounting', 'Link Xero or QuickBooks to pull real revenue, expenses and P&L automatically. Setup uses your accounting login — ask us to enable it for your account.')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface, borderColor: connected ? t.good : t.brand, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="chart" size={19} color={t.brand} /></View>
            <View><Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>{connected ? 'Accounting connected' : 'Connect accounting'}</Text><Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{connected ? 'Syncing from Xero' : 'Xero · QuickBooks — pull real P&L'}</Text></View>
          </View>
          <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}>{connected ? 'Manage' : 'Connect'}</Text>
        </Pressable>

        {/* AI review card */}
        <View style={{ backgroundColor: t.surface, borderColor: t.brand, borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 66, height: 66, borderRadius: 33, borderWidth: 4, borderColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: t.ink, fontSize: 26, fontWeight: '900' }}>{r.grade}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                <Icon name="sparkle" size={14} color={t.brand} /><Text style={{ color: t.brand, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>AI financial review</Text>
              </View>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16 }}>Health score {r.score}/100</Text>
            </View>
          </View>
          <Text style={{ color: t.ink2, fontSize: 13.5, lineHeight: 20, marginTop: 12 }}>{r.summary}</Text>
        </View>

        {/* KPI grid */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
          {kpis.map(([l, v]) => (
            <View key={l} style={{ width: '47.5%', backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, padding: 14 }}>
              <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{v}</Text>
              <Text style={{ color: t.ink3, fontSize: 11, marginTop: 2 }}>{l}</Text>
            </View>
          ))}
        </View>

        {r.strengths.length > 0 ? (<>
          <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>What's working</Text>
          {r.strengths.map((f, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 11, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderLeftWidth: 3, borderLeftColor: toneColor(f.tone), borderRadius: 12, padding: 13, marginBottom: 8 }}>
              <View style={{ flex: 1 }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 13.5 }}>{f.title}</Text><Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>{f.detail}</Text></View>
            </View>
          ))}
        </>) : null}

        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8, marginBottom: 10 }}>Where to improve</Text>
        {r.improvements.map((f, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 11, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderLeftWidth: 3, borderLeftColor: toneColor(f.tone), borderRadius: 12, padding: 13, marginBottom: 8 }}>
            <View style={{ flex: 1 }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 13.5 }}>{f.title}</Text><Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>{f.detail}</Text></View>
          </View>
        ))}

        <Pressable onPress={() => router.push('/(owner)/promotions')} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 10 }}>
          <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Create a promotion →</Text>
        </Pressable>
        <Text style={{ color: t.ink3, fontSize: 11, textAlign: 'center', marginTop: 12, lineHeight: 16 }}>Figures are illustrative until accounting is connected. Review is generated from your numbers — not financial advice.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
