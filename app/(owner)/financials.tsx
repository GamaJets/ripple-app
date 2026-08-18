// Owner · Financial health. KPIs, retention and an AI-style review of the gym's
// numbers with concrete improvement recommendations.
//
// The review runs ONLY on figures the owner has entered. This screen previously
// rendered `sampleFinances()` — an invented AED 214,000/mo, 1,940-member gym —
// behind a one-line footnote, so a real owner opened it and was told, with a
// grade and an AI verdict, that their business was in strong financial health.
// Until figures are entered (or accounting is connected) it now shows an entry
// form and no analysis at all.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { emptyFinances, hasFigures, reviewFinances, type FinInputs, type FinFlag } from '../../src/lib/financialAI';

const KEY = 'repple.owner.financials';
const money = (n: number) => 'AED ' + Math.round(n).toLocaleString();

const FIELDS: { key: keyof FinInputs; label: string; hint: string }[] = [
  { key: 'revenue', label: 'Total revenue / mo', hint: 'AED' },
  { key: 'expenses', label: 'Total expenses / mo', hint: 'AED' },
  { key: 'mrr', label: 'Recurring membership revenue', hint: 'AED' },
  { key: 'members', label: 'Active members', hint: 'count' },
  { key: 'newMembers', label: 'Joined this month', hint: 'count' },
  { key: 'churnedMembers', label: 'Left this month', hint: 'count' },
  { key: 'ptRevenue', label: 'Personal-training revenue', hint: 'AED' },
  { key: 'classRevenue', label: 'Class revenue', hint: 'AED' },
];

export default function Financials() {
  const t = useTheme();
  const router = useRouter();
  const [connected] = useState(false);
  const [fin, setFin] = useState<FinInputs>(emptyFinances);
  const [hydrated, setHydrated] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const next = emptyFinances();
          for (const f of FIELDS) if (typeof parsed?.[f.key] === 'number') next[f.key] = parsed[f.key];
          setFin(next);
        }
      } catch { /* ignore */ }
      setHydrated(true);
    })();
  }, []);

  const openEditor = useCallback(() => {
    const d: Record<string, string> = {};
    for (const f of FIELDS) d[f.key] = fin[f.key] ? String(fin[f.key]) : '';
    setDraft(d);
    setEditing(true);
  }, [fin]);

  const save = useCallback(async () => {
    const next = emptyFinances();
    for (const f of FIELDS) {
      const n = Number(String(draft[f.key] ?? '').replace(/[^0-9.]/g, ''));
      next[f.key] = Number.isFinite(n) ? n : 0;
    }
    setFin(next);
    setEditing(false);
    try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [draft]);

  const ready = hasFigures(fin);
  const r = useMemo(() => (ready ? reviewFinances(fin) : null), [fin, ready]);
  const toneColor = (tone: FinFlag['tone']) => (tone === 'good' ? t.good : tone === 'watch' ? t.warn : t.crit);

  const kpis: [string, string][] = r ? [
    ['Revenue / mo', money(fin.revenue)],
    ['Net profit', money(r.netProfit)],
    ['Margin', r.marginPct.toFixed(0) + '%'],
    ['MRR', money(fin.mrr)],
    ['Members', fin.members.toLocaleString()],
    ['Churn', r.churnPct.toFixed(1) + '%'],
    ['Net growth', (r.growthPct >= 0 ? '+' : '') + r.growthPct.toFixed(1) + '%'],
    ['PT + classes', money(fin.ptRevenue + fin.classRevenue)],
  ] : [];

  const connectCard = (
    <Pressable onPress={() => Alert.alert('Connect accounting', 'Link Xero or QuickBooks to pull real revenue, expenses and P&L automatically. Setup uses your accounting login — ask us to enable it for your account.')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface, borderColor: connected ? t.good : t.brand, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="chart" size={19} color={t.brand} /></View>
        <View><Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>{connected ? 'Accounting connected' : 'Connect accounting'}</Text><Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{connected ? 'Syncing from Xero' : 'Xero · QuickBooks — pull real P&L'}</Text></View>
      </View>
      <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}>{connected ? 'Manage' : 'Connect'}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Financial health</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>How the gym is doing — with an AI review of where to improve.</Text>

        {connectCard}

        {!hydrated ? null : editing ? (
          <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 16 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, marginBottom: 2 }}>Your monthly figures</Text>
            <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 14 }}>Leave a field blank if you don't track it. Stored on this device only.</Text>
            {FIELDS.map((f) => (
              <View key={f.key} style={{ marginBottom: 10 }}>
                <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>{f.label} <Text style={{ color: t.ink3, fontWeight: '500' }}>({f.hint})</Text></Text>
                <TextInput
                  value={draft[f.key] ?? ''}
                  onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={t.ink3}
                  style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontWeight: '700' }}
                />
              </View>
            ))}
            <Pressable onPress={save} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 }}>
              <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Save &amp; review</Text>
            </Pressable>
            <Pressable onPress={() => setEditing(false)} style={{ paddingVertical: 10, alignItems: 'center' }}>
              <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
            </Pressable>
          </View>
        ) : !ready ? (
          <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 18, padding: 20, marginBottom: 16, alignItems: 'center' }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><Icon name="chart" size={24} color={t.ink3} /></View>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>No figures yet</Text>
            <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>Connect your accounting, or enter this month's revenue, expenses and membership numbers. Nothing is shown until it comes from you.</Text>
            <Pressable onPress={openEditor} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22, marginTop: 16 }}>
              <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Enter my figures</Text>
            </Pressable>
          </View>
        ) : r ? (
          <>
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

            <Pressable onPress={openEditor} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 10 }}>
              <Text style={{ color: t.ink2, fontWeight: '800', fontSize: 13 }}>Update my figures</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/(owner)/promotions')} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 10 }}>
              <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Create a promotion →</Text>
            </Pressable>
            <Text style={{ color: t.ink3, fontSize: 11, textAlign: 'center', marginTop: 12, lineHeight: 16 }}>Review is generated from the figures you entered — not financial advice.</Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
