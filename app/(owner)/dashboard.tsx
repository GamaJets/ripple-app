// Owner · Overview — the platform operating console. Real roll-ups (MRR + MoM
// delta, ARR, trainers, clients), an at-risk-MRR churn callout, a trainer-health
// board (score + risk, tap for detail), and an accumulating MRR trend.
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Icon } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { PLANS } from '../../src/lib/ownerMock';
import { platformRollup, trainerHealth, type TrainerLike } from '../../src/lib/ownerAnalytics';
import { Sparkline, DeltaBadge, HealthPill } from '../../src/ui/charts';
import { useMrrHistory } from '../../src/ui/useMrrHistory';
import { cohorts } from '../../src/lib/ownerAnalytics';
import { ownerReportDoc, shareDoc } from '../../src/lib/exportShare';
import { fetchFailedInvoices, money, type Invoice } from '../../src/lib/billing';
import { Linking } from 'react-native';

function Big({ t, label, value, sub, tint, extra }: { t: Theme; label: string; value: string; sub: string; tint?: boolean; extra?: React.ReactNode }) {
  return (<View style={{ flex: 1, backgroundColor: tint ? t.brand : t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
    <Text style={{ color: tint ? t.brandInk : t.ink3, fontSize: 12, fontWeight: '700', opacity: tint ? 0.85 : 1 }}>{label}</Text>
    <Text style={{ color: tint ? t.brandInk : t.ink, fontSize: 26, fontWeight: '800', textTransform: 'capitalize', marginTop: 6 }}>{value}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
      <Text style={{ color: tint ? t.brandInk : t.ink3, fontSize: 11, opacity: tint ? 0.85 : 1 }}>{sub}</Text>
      {extra}
    </View>
  </View>);
}

const RISK_LABEL: Record<string, string> = { high: 'Churn risk', watch: 'Watch', ok: 'Healthy', suspended: 'Suspended' };

export default function OwnerOverview() {
  const t = useTheme(); const router = useRouter();
  const { trainers, activeMrr } = usePlatformTrainers();
  const roll = platformRollup(trainers as TrainerLike[]);
  const { series, delta } = useMrrHistory(activeMrr);
  const [sel, setSel] = useState<TrainerLike | null>(null);

  const byPlan = PLANS.map((p) => ({ name: p.name, revenue: trainers.filter((x) => x.plan === p.name && x.status !== 'suspended').reduce((a, x) => a + x.mrr, 0), clients: trainers.filter((x) => x.plan === p.name).reduce((a, x) => a + x.clients, 0) }));
  const maxPlan = Math.max(1, ...byPlan.map((p) => p.revenue));
  // Trainers sorted worst-health first so problems surface at the top.
  const ranked = [...(trainers as TrainerLike[])].map((tr) => ({ tr, h: trainerHealth(tr) })).sort((a, b) => a.h.score - b.h.score);
  const selHealth = sel ? trainerHealth(sel) : null;
  const [dunning, setDunning] = useState<Invoice[]>([]);
  useEffect(() => { let c = false; fetchFailedInvoices().then((r) => { if (!c) setDunning(r); }); return () => { c = true; }; }, []);
  const dunningTotal = dunning.reduce((a, i) => a + (i.amount_due || 0), 0);
  const exportReport = async () => {
    const doc = ownerReportDoc({
      mrr: roll.mrr, arr: roll.arr, trainers: roll.trainers, paying: roll.paying, trial: roll.trial,
      clients: roll.clients, atRiskMrr: roll.atRiskMrr, trialConversionPct: roll.trialConversionPct,
      cohorts: cohorts(trainers as TrainerLike[]),
      generatedOn: new Date().toLocaleDateString(),
    });
    const how = await shareDoc(doc.html, doc.text, 'Platform report');
    if (how === 'text') Alert.alert('Report shared', 'Shared as text — branded PDF export turns on after the next native build.');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <View><Text style={{ color: t.ink3, fontSize: 14 }}>Platform</Text><Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia', textTransform: 'capitalize' }}>Repple HQ</Text></View>
          <View style={{ flexDirection: 'row', gap: 8 }}><Pressable onPress={() => router.push('/(owner)/explore')} accessibilityLabel="Search" style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 }}><Icon name="search" size={14} color={t.ink2} /></Pressable><Pressable onPress={exportReport} accessibilityLabel="Export report" style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 }}><Icon name="share" size={14} color={t.ink2} /></Pressable><Pressable onPress={() => router.push('/')} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 12 }}>Switch role</Text></Pressable></View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
          {([["people","Trainers","/(owner)/trainers"],["palette","Brand","/(owner)/brand"],["trending","Growth","/(owner)/growth"],["wrench","Ops","/(owner)/ops"]] as const).map(([ic, label, route]) => (
            <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Icon name={ic} size={14} color={t.brand} /><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <Big t={t} label="Platform MRR" value={'$' + roll.mrr.toLocaleString()} sub="trainer fees" tint extra={delta !== 0 ? <DeltaBadge value={delta} suffix="mo" /> : undefined} />
          <Big t={t} label="Trainers" value={String(roll.trainers)} sub={`${roll.paying} paying · ${roll.trial} trial`} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <Big t={t} label="End clients" value={String(roll.clients)} sub={`${roll.avgClientsPerTrainer} avg / trainer`} />
          <Big t={t} label="ARR" value={'$' + roll.arr.toLocaleString()} sub={roll.trialConversionPct != null ? `${roll.trialConversionPct}% paying` : 'annualised'} />
        </View>

        {/* At-risk MRR churn callout */}
        {roll.atRiskCount > 0 ? (
          <Pressable onPress={() => { const first = ranked.find((r) => r.h.risk === 'high' || r.h.risk === 'watch'); if (first) setSel(first.tr); }} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.warn, padding: 15, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(250,178,25,0.16)', alignItems: 'center', justifyContent: 'center' }}><Icon name="target" size={20} color={t.warn} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>${roll.atRiskMrr.toLocaleString()}/mo at risk</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{roll.atRiskCount} trainer{roll.atRiskCount > 1 ? 's' : ''} flagged — tap to review the most urgent.</Text>
            </View>
            <Icon name="chevron" size={18} color={t.ink3} />
          </Pressable>
        ) : null}

        {dunning.length > 0 ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.crit, padding: 15, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(208,59,59,0.14)', alignItems: 'center', justifyContent: 'center' }}><Icon name="target" size={19} color={t.crit} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{money(dunningTotal)} in failed payments</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{dunning.length} unpaid invoice{dunning.length > 1 ? 's' : ''} — retry or chase before they churn.</Text>
              </View>
            </View>
            {dunning.slice(0, 4).map((inv) => (
              <Pressable key={inv.id} onPress={() => inv.hosted_invoice_url && Linking.openURL(inv.hosted_invoice_url)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.ring }}>
                <Text style={{ color: t.ink2, fontSize: 13, flex: 1 }} numberOfLines={1}>Invoice {inv.id.slice(-8)} · {inv.attempt_count || 0} attempt{(inv.attempt_count || 0) === 1 ? '' : 's'}</Text>
                <Text style={{ color: t.crit, fontSize: 13, fontWeight: '800', marginRight: 8 }}>{money(inv.amount_due, inv.currency)}</Text>
                {inv.hosted_invoice_url ? <Icon name="chevron" size={16} color={t.ink3} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* MRR trend (real, accumulating) */}
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16 }}>MRR trend</Text>
            {delta !== 0 ? <DeltaBadge value={delta} suffix="vs last mo" /> : <Text style={{ color: t.ink3, fontSize: 11 }}>tracking started</Text>}
          </View>
          <Sparkline data={series} w={300} h={64} />
        </View>

        <Pressable onPress={() => router.push('/(owner)/revenue')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 16 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="trending" size={19} color={t.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Revenue analytics</Text>
            <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>Forecast, plan mix, LTV & revenue at risk</Text>
          </View>
          <Icon name="chevron" size={18} color={t.ink3} />
        </Pressable>

        {/* Trainer health board */}
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 4 }}>Trainer health</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12 }}>Worst first — where retention effort pays off.</Text>
          {ranked.map(({ tr, h }) => (
            <Pressable key={tr.id} onPress={() => setSel(tr)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.ring }}>
              <HealthPill score={h.score} tone={h.tone} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, textTransform: 'capitalize' }}>{tr.name}</Text>
                <Text style={{ color: h.risk === 'high' ? t.crit : h.risk === 'watch' ? t.warn : t.ink3, fontSize: 11, marginTop: 1 }}>{RISK_LABEL[h.risk]} · {tr.clients} client{tr.clients === 1 ? '' : 's'} · {tr.plan}</Text>
              </View>
              <Text style={{ color: t.ink3, fontSize: 12 }}>${tr.status === 'suspended' ? 0 : tr.mrr}/mo</Text>
            </Pressable>
          ))}
        </View>

        {/* Revenue by plan */}
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 14 }}>Revenue by plan</Text>
          {byPlan.map((p) => (
            <View key={p.name} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}><Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{p.name} · {p.clients} clients</Text><Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>${p.revenue}/mo</Text></View>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: t.surface3, overflow: 'hidden' }}><View style={{ height: 10, borderRadius: 5, backgroundColor: t.brand, width: `${Math.round((p.revenue / maxPlan) * 100)}%` }} /></View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Trainer drill-down */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          {sel && selHealth && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <HealthPill score={selHealth.score} tone={selHealth.tone} />
                <Text style={{ color: t.ink, fontSize: 21, fontWeight: '800', textTransform: 'capitalize' }}>{sel.name}</Text>
              </View>
              <Text style={{ color: selHealth.risk === 'high' ? t.crit : selHealth.risk === 'watch' ? t.warn : t.ink3, fontSize: 13, marginBottom: 16 }}>{selHealth.reason}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                {[['Plan', sel.plan], ['Clients', String(sel.clients)], ['Revenue', `$${sel.status === 'suspended' ? 0 : sel.mrr}/mo`], ['Since', sel.since || '—']].map(([l, v]) => (
                  <View key={l} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, paddingVertical: 10, alignItems: 'center' }}>
                    <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>{v}</Text>
                    <Text style={{ color: t.ink3, fontSize: 10, marginTop: 2 }}>{l}</Text>
                  </View>
                ))}
              </View>
              <Pressable onPress={() => { setSel(null); router.push('/(owner)/trainers'); }} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>Manage {sel.name.split(' ')[0]}</Text>
              </Pressable>
              <Pressable onPress={() => setSel(null)} style={{ paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Close</Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
