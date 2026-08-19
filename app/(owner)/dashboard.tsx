// Owner · Overview — the platform operating console. Real roll-ups (MRR + MoM
// delta, ARR, trainers, clients), an at-risk-MRR churn callout, a trainer-health
// board (score + risk, tap for detail), and an accumulating MRR trend.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same numbers, same routes, same modal — the four tinted
// stat boxes and eleven bordered cards became one hero figure plus
// hairline-separated sections, and the Georgia serif header is gone.
import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Icon } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import {
  Rule, Section, SectionHead, Hero, KpiRow, ListRow, Card, Cta, Ghost, QuickRow, Spark, Notice,
} from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { PLANS } from '../../src/lib/ownerMock';
import { platformRollup, trainerHealth, type TrainerLike } from '../../src/lib/ownerAnalytics';
import { HealthPill } from '../../src/ui/charts';
import { useMrrHistory } from '../../src/ui/useMrrHistory';
import { cohorts } from '../../src/lib/ownerAnalytics';
import { ownerReportDoc, shareDoc } from '../../src/lib/exportShare';
import { fetchFailedInvoices, money, type Invoice } from '../../src/lib/billing';
import { Linking } from 'react-native';

const RISK_LABEL: Record<string, string> = { high: 'Churn risk', watch: 'Watch', ok: 'Healthy', suspended: 'Suspended' };

export default function OwnerOverview() {
  const t = useTheme(); const router = useRouter();
  const { trainers, activeMrr } = usePlatformTrainers();
  const roll = platformRollup(trainers as TrainerLike[]);
  const { series, labels, delta } = useMrrHistory(activeMrr);
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
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Platform</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Repple HQ</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: 2 }}>
            <Ghost icon="search" onPress={() => router.push('/(owner)/explore')} />
            <Ghost icon="share" onPress={exportReport} />
            <Ghost label="Switch role" onPress={() => router.push('/')} />
          </View>
        </View>

        {/* ── shortcuts ──────────────────────────────────────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          <QuickRow items={[
            { icon: 'people', label: 'Trainers', onPress: () => router.push('/(owner)/trainers') },
            { icon: 'palette', label: 'Brand', onPress: () => router.push('/(owner)/brand') },
            { icon: 'trending', label: 'Growth', onPress: () => router.push('/(owner)/growth') },
            { icon: 'wrench', label: 'Ops', onPress: () => router.push('/(owner)/ops') },
          ]} />
        </View>

        {/* ── interrupts: things that need a decision now ─────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          {roll.atRiskCount > 0 ? (
            <Notice tone={t.warn} kicker="Revenue at risk"
              title={`$${roll.atRiskMrr.toLocaleString()}/mo at risk`}
              note={`${roll.atRiskCount} trainer${roll.atRiskCount > 1 ? 's' : ''} flagged — review the most urgent.`}>
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Review" wide
                  onPress={() => { const first = ranked.find((r) => r.h.risk === 'high' || r.h.risk === 'watch'); if (first) setSel(first.tr); }} />
              </View>
            </Notice>
          ) : null}

          {dunning.length > 0 ? (
            <Notice tone={t.crit} kicker="Failed payments"
              title={`${money(dunningTotal)} in failed payments`}
              note={`${dunning.length} unpaid invoice${dunning.length > 1 ? 's' : ''} — retry or chase before they churn.`}>
              <View style={{ marginTop: sp.md }}>
                {dunning.slice(0, 4).map((inv) => (
                  <Pressable key={inv.id} onPress={() => inv.hosted_invoice_url && Linking.openURL(inv.hosted_invoice_url)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: sp.sm, borderTopWidth: hairline, borderTopColor: t.ring }}>
                    <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }} numberOfLines={1}>
                      Invoice {inv.id.slice(-8)} · {inv.attempt_count || 0} attempt{(inv.attempt_count || 0) === 1 ? '' : 's'}
                    </Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink }}>{money(inv.amount_due, inv.currency)}</Text>
                    {inv.hosted_invoice_url ? <Icon name="chevron" size={14} color={t.ink3} /> : null}
                  </Pressable>
                ))}
              </View>
            </Notice>
          ) : null}
        </View>

        {roll.trainers === 0 ? (
          <Card style={{ marginTop: sp.sm }}>
            <Text style={{ ...ty.label, color: t.ink2 }}>
              No trainers on the platform yet — MRR, clients and trainer health populate as trainers sign up.
            </Text>
          </Card>
        ) : null}

        {/* ── the hero ───────────────────────────────────────────────────── */}
        <Hero
          label="Platform MRR"
          figure={'$' + roll.mrr.toLocaleString()}
          note={delta !== 0
            ? `${delta > 0 ? '+' : '−'}$${Math.abs(delta).toLocaleString()} vs last mo · trainer subscription fees`
            : 'Trainer subscription fees · tracking started'}
          onPress={() => router.push('/(owner)/revenue')}
        />

        <Rule />

        {/* ── the shape of the platform ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Platform" note="Trainers" onPress={() => router.push('/(owner)/trainers')} />
          <KpiRow items={[
            { label: 'Trainers', value: String(roll.trainers), delta: `${roll.paying} paying · ${roll.trial} trial` },
            { label: 'End clients', value: String(roll.clients), delta: `${roll.avgClientsPerTrainer} avg / trainer` },
            { label: 'ARR', value: '$' + roll.arr.toLocaleString(), delta: roll.trialConversionPct != null ? `${roll.trialConversionPct}% paying` : 'annualised' },
          ]} />
        </Section>

        <Rule />

        {/* ── MRR trend (real, accumulating) ─────────────────────────────── */}
        <Section>
          <SectionHead title="MRR trend"
            note={delta !== 0 ? `${delta > 0 ? '+' : '−'}$${Math.abs(delta).toLocaleString()} vs last mo` : 'Tracking started'}
            onPress={() => router.push('/(owner)/revenue')} />
          <Spark data={series} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
            {labels.map((l, i) => (
              <Text key={i} style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3 }}>{l}</Text>
            ))}
          </View>
        </Section>

        <Rule />

        {/* ── trainer health board ───────────────────────────────────────── */}
        <Section>
          <SectionHead title="Trainer health" note="Worst first" />
          {ranked.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No trainers to score yet.</Text>
          ) : ranked.map(({ tr, h }, i) => (
            <Pressable key={tr.id} onPress={() => setSel(tr)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                       borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
              <HealthPill score={h.score} tone={h.tone} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{tr.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: h.risk === 'high' ? t.crit : h.risk === 'watch' ? t.warn : t.brand }} />
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{RISK_LABEL[h.risk]} · {tr.clients} client{tr.clients === 1 ? '' : 's'} · {tr.plan}</Text>
                </View>
              </View>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>${tr.status === 'suspended' ? 0 : tr.mrr}/mo</Text>
            </Pressable>
          ))}
        </Section>

        <Rule />

        {/* ── revenue by plan ────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Revenue by plan" note="Revenue" onPress={() => router.push('/(owner)/revenue')} />
          {byPlan.map((p) => (
            <View key={p.name} style={{ marginBottom: sp.lg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ ...ty.caption, color: t.ink2 }}>{p.name} · {p.clients} clients</Text>
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>${p.revenue}/mo</Text>
              </View>
              <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
                <View style={{ height: 3, borderRadius: 2, width: `${Math.round((p.revenue / maxPlan) * 100)}%`, backgroundColor: t.brand, opacity: p.revenue > 0 ? 1 : 0.55 }} />
              </View>
            </View>
          ))}
        </Section>

        <Rule />

        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          <ListRow icon="trending" title="Revenue analytics" note="Forecast, plan mix, LTV & revenue at risk"
            onPress={() => router.push('/(owner)/revenue')} />
          <ListRow icon="sparkle" title="Financial health · AI review" note="KPIs, retention & where to improve · connect accounting"
            onPress={() => router.push('/(owner)/financials')} />
          <ListRow icon="share" title="Promotions" note="Create an offer & push it to members"
            onPress={() => router.push('/(owner)/promotions')} />
          <ListRow icon="calendar" title="Classes & payroll" note="Attendance, fill rates & trainer pay per check-in"
            onPress={() => router.push('/(owner)/class-analytics')} />
        </Section>
      </ScrollView>

      {/* Trainer drill-down */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 }}>
          {sel && selHealth && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: 6 }}>
                <HealthPill score={selHealth.score} tone={selHealth.tone} />
                <Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize' }}>{sel.name}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.lg }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: selHealth.risk === 'high' ? t.crit : selHealth.risk === 'watch' ? t.warn : t.brand }} />
                <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{selHealth.reason}</Text>
              </View>
              <View style={{ flexDirection: 'row', marginBottom: sp.xl }}>
                {[['Plan', sel.plan], ['Clients', String(sel.clients)], ['Revenue', `$${sel.status === 'suspended' ? 0 : sel.mrr}/mo`], ['Since', sel.since || '—']].map(([l, v], i) => (
                  <View key={l} style={{ flex: 1, paddingRight: sp.sm, paddingLeft: i === 0 ? 0 : sp.md, borderLeftWidth: i === 0 ? 0 : hairline, borderLeftColor: t.ring }}>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>{l}</Text>
                    <Text style={{ ...value(15), color: t.ink, marginTop: 3 }} numberOfLines={1}>{v}</Text>
                  </View>
                ))}
              </View>
              <Cta label={`Manage ${sel.name.split(' ')[0]}`} wide onPress={() => { setSel(null); router.push('/(owner)/trainers'); }} />
              <View style={{ height: sp.sm }} />
              <Ghost label="Close" onPress={() => setSel(null)} />
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
