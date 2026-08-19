// Owner · Revenue analytics (track A). Deepens the money view: MRR/ARR, an
// accumulating trend, a trend-based forecast, revenue by plan, revenue at risk,
// and trainer LTV. Computed from the live roster + persisted MRR history.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): four bordered stat boxes and five stacked cards became
// one hero figure plus hairline-separated sections, and the Georgia serif
// header is gone.
//
// Also removed: the hardcoded 24-month trainer lifespan that was substituted
// whenever no churn had been observed. It rendered as "Trainer LTV $X · ~24 mo
// lifespan" — a measured-looking unit economic derived from a magic number.
// With no churn signal there is no lifespan and no LTV; the screen says so.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import {
  Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, Spark, Notice,
} from '../../src/ui/kit';
import { sp, layout, type as ty, numeric } from '../../src/theme/scale';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { PLANS } from '../../src/lib/ownerMock';
import { platformRollup, type TrainerLike } from '../../src/lib/ownerAnalytics';
import { useMrrHistory } from '../../src/ui/useMrrHistory';

const usd = (n: number) => '$' + Math.round(n).toLocaleString();

export default function OwnerRevenue() {
  const t = useTheme();
  const router = useRouter();
  const { trainers } = usePlatformTrainers();
  const roll = platformRollup(trainers as TrainerLike[]);
  const { series, labels, delta } = useMrrHistory(roll.mrr);

  // Monthly growth rate from the accumulating history (geometric, clamped).
  const first = series.find((v) => v > 0) ?? roll.mrr;
  const n = series.length;
  let growth = n >= 2 && first > 0 ? Math.pow(roll.mrr / first, 1 / (n - 1)) - 1 : 0;
  growth = Math.max(-0.5, Math.min(0.5, growth));
  const forecast = Array.from({ length: 6 }, (_, i) => Math.round(roll.mrr * Math.pow(1 + growth, i + 1)));

  // Revenue by plan (active trainers only).
  const byPlan = PLANS.map((p) => ({
    name: p.name,
    revenue: trainers.filter((x) => x.plan === p.name && x.status !== 'suspended').reduce((a, x) => a + x.mrr, 0),
  })).filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const planTotal = byPlan.reduce((a, p) => a + p.revenue, 0) || 1;

  // Trainer LTV: avg revenue per paying trainer × observed lifespan (1 / churn).
  // No churn observed yet → no lifespan to divide by, so no LTV. It is not 24.
  const payingMrr = trainers.filter((x) => x.status === 'active').reduce((a, x) => a + x.mrr, 0);
  const avgMrr = roll.paying > 0 ? payingMrr / roll.paying : 0;
  const churnRate = roll.trainers > 0 ? roll.suspended / roll.trainers : 0;
  const lifespanMo = churnRate > 0 ? Math.min(48, Math.round(1 / churnRate)) : null;
  const ltv = lifespanMo != null ? Math.round(avgMrr * lifespanMo) : null;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg }}>Platform revenue, forecast &amp; unit economics</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Revenue</Text>
        </View>

        {/* ── the hero ───────────────────────────────────────────────────── */}
        <Hero
          label="MRR"
          figure={usd(roll.mrr)}
          note={delta !== 0
            ? `${delta > 0 ? '+' : '−'}${usd(Math.abs(delta))} vs last mo · ${usd(roll.arr)} annualised`
            : `${usd(roll.arr)} annualised · trainer fees`}
        />

        <Rule />

        {/* ── unit economics ─────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Unit economics" note="Per paying trainer" />
          <KpiRow items={[
            { label: 'ARR', value: usd(roll.arr), delta: 'annualised' },
            { label: 'Avg / trainer', value: usd(avgMrr), delta: `${roll.paying} paying` },
            { label: 'Trainer LTV', value: ltv != null ? usd(ltv) : '—', delta: lifespanMo != null ? `~${lifespanMo} mo lifespan` : 'No churn history yet' },
          ]} />
        </Section>

        <Rule />

        {/* ── trend ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="MRR trend"
            note={delta !== 0 ? `${delta > 0 ? '+' : '−'}${usd(Math.abs(delta))} vs last mo` : 'Tracking started'} />
          <Spark data={series} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
            {labels.map((l, i) => (
              <Text key={i} style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3 }}>{l}</Text>
            ))}
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Accumulates a real monthly snapshot.</Text>
        </Section>

        <Rule />

        {/* ── forecast ───────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="6-month forecast" note={`${growth >= 0 ? '+' : ''}${Math.round(growth * 100)}%/mo`} />
          <Spark data={[roll.mrr, ...forecast]} h={58} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
            <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>Now {usd(roll.mrr)}</Text>
            <Text style={{ ...ty.caption, ...numeric, color: t.ink }}>6 mo → {usd(forecast[5])}</Text>
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Projected from your recent growth rate — a guide, not a guarantee.
          </Text>
        </Section>

        <Rule />

        {/* ── revenue by plan ────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Revenue by plan" note={byPlan.length > 0 ? usd(planTotal) + '/mo' : undefined} />
          {byPlan.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No plan revenue yet.</Text>
          ) : byPlan.map((p) => {
            const pct = Math.round((p.revenue / planTotal) * 100);
            return (
              <View key={p.name} style={{ marginBottom: sp.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{p.name}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{usd(p.revenue)}/mo · {pct}%</Text>
                </View>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
                  <View style={{ height: 3, borderRadius: 2, width: `${pct}%`, backgroundColor: t.brand }} />
                </View>
              </View>
            );
          })}
        </Section>

        <Rule />

        {/* ── revenue at risk ────────────────────────────────────────────── */}
        <Section>
          {roll.atRiskMrr > 0 ? (
            <Notice tone={t.warn} kicker="Revenue at risk" title={`${usd(roll.atRiskMrr)}/mo`}
              note={`${roll.atRiskCount} trainer${roll.atRiskCount === 1 ? '' : 's'} flagged watch/high — that's ${usd(roll.atRiskMrr * 12)} of ARR to defend.`}>
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Review trainers" wide onPress={() => router.push('/(owner)/trainers')} />
              </View>
            </Notice>
          ) : (<>
            <SectionHead title="Revenue at risk" note="Trainers" onPress={() => router.push('/(owner)/trainers')} />
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {roll.trainers === 0 ? 'No trainers on the platform yet.' : 'No trainers flagged watch or high risk.'}
            </Text>
          </>)}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
