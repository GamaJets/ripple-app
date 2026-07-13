// Owner · Growth. Acquisition/retention snapshot + an interactive promo-code
// tool: create referral/discount codes, toggle them on/off, track redemptions.
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { usePromos } from '../../src/ui/promos';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { platformRollup, cohorts, clientAnalytics, type TrainerLike } from '../../src/lib/ownerAnalytics';

const DISCOUNTS = [10, 20, 30, 50];

export default function OwnerGrowth() {
  const t = useTheme();
  const { promos, addPromo, toggleActive, removePromo } = usePromos();
  const { trainers } = usePlatformTrainers();
  const roll = platformRollup(trainers as TrainerLike[]);
  const coh = cohorts(trainers as TrainerLike[]);
  const ca = clientAnalytics(trainers as TrainerLike[]);
  const thisMonth = new Date().toLocaleString(undefined, { month: 'short' }) + ' ' + new Date().getFullYear();
  const newThisMonth = trainers.filter((x) => x.since === thisMonth).length;
  const churnPct = trainers.length ? Math.round((roll.suspended / trainers.length) * 100) : 0;
  const [code, setCode] = useState('');
  const [disc, setDisc] = useState(20);
  const funnel = [['Visited site', 100], ['Started trial', 38], ['Activated', 24], ['Paying', 18]] as const;

  const create = () => {
    const r = addPromo(code, disc);
    if (!r.ok) { Alert.alert('Cannot create', r.reason ?? 'Try a different code.'); return; }
    setCode('');
    Alert.alert('Code created', `${code.trim().toUpperCase()} · ${disc}% off is now live.`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', textTransform: 'capitalize' }}>Growth</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Acquisition &amp; retention</Text>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}><Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>New this month</Text><Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', marginTop: 4 }}>+{newThisMonth}</Text></View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}><Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Churn</Text><Text style={{ color: churnPct > 0 ? t.crit : t.brand, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{churnPct}%</Text></View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}><Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Trial→paid</Text><Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{roll.trialConversionPct != null ? roll.trialConversionPct + '%' : '—'}</Text></View>
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 4 }}>Platform client analytics</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 14 }}>End-clients across every trainer</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            {[['Active clients', String(ca.total)], ['Engaged', ca.engagementPct + '%'], ['Avg / trainer', String(ca.avgPerTrainer)]].map(([l, v]) => (
              <View key={l} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 18 }}>{v}</Text>
                <Text style={{ color: t.ink3, fontSize: 10.5, marginTop: 2 }}>{l}</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: t.surface3, overflow: 'hidden', flexDirection: 'row' }}>
              <View style={{ height: 10, backgroundColor: t.brand, width: ca.engagementPct + '%' }} />
              <View style={{ height: 10, backgroundColor: t.warn, width: (100 - ca.engagementPct) + '%' }} />
            </View>
            <Text style={{ color: t.ink3, fontSize: 11 }}>{ca.engaged} engaged · {ca.atRisk} at-risk</Text>
          </View>
          <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Clients by plan</Text>
          {ca.byPlan.map((bp) => (
            <View key={bp.plan} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}><Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{bp.plan}</Text><Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>{bp.clients} · {bp.pct}%</Text></View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surface3, overflow: 'hidden' }}><View style={{ height: 8, borderRadius: 4, backgroundColor: t.brand, width: bp.pct + '%' }} /></View>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 4 }}>Cohort retention</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 14 }}>Trainers by signup month · % still active</Text>
          {coh.map((c) => (
            <View key={c.label} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{c.label}</Text>
                <Text style={{ color: c.pct === 100 ? t.brand : c.pct >= 60 ? t.ink : t.crit, fontSize: 13, fontWeight: '700' }}>{c.pct}% · {c.active}/{c.total}</Text>
              </View>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: t.surface3, overflow: 'hidden' }}><View style={{ height: 10, borderRadius: 5, backgroundColor: c.pct >= 60 ? t.brand : t.warn, width: c.pct + '%' }} /></View>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginBottom: 14 }}>Trainer acquisition funnel</Text>
          {funnel.map(([label, pct]) => (
            <View key={label} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}><Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{label}</Text><Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>{pct}%</Text></View>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: t.surface3, overflow: 'hidden' }}><View style={{ height: 10, borderRadius: 5, backgroundColor: t.brand, width: pct + '%' }} /></View>
            </View>
          ))}
        </View>

        {/* Promo / referral codes */}
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginBottom: 4 }}>Promo &amp; referral codes</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 14 }}>Discounts on trainer subscriptions to drive signups</Text>

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <TextInput value={code} onChangeText={setCode} placeholder="CODE" placeholderTextColor={t.ink3} autoCapitalize="characters" autoCorrect={false} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontWeight: '700', letterSpacing: 1 }} />
            <Pressable onPress={create} style={{ backgroundColor: t.brand, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Create</Text></Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {DISCOUNTS.map((d) => { const on = disc === d; return (
              <Pressable key={d} onPress={() => setDisc(d)} style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 12 }}>{d}%</Text>
              </Pressable>); })}
          </View>

          {promos.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, letterSpacing: 1 }}>{p.code}</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{p.discountPct}% off · {p.redeemed} redeemed</Text>
              </View>
              <Pressable onPress={() => toggleActive(p.id)} style={{ backgroundColor: p.active ? 'rgba(45,212,191,0.15)' : t.surface3, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ color: p.active ? t.brand : t.ink3, fontWeight: '800', fontSize: 11 }}>{p.active ? 'ACTIVE' : 'OFF'}</Text>
              </Pressable>
              <Pressable onPress={() => removePromo(p.id)} accessibilityLabel="Delete code" style={{ paddingHorizontal: 4, paddingVertical: 4 }}><Text style={{ color: t.ink3, fontWeight: '800', fontSize: 15 }}>×</Text></Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
