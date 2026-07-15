// Owner · Revenue analytics (track A). Deepens the money view: MRR/ARR, an
// accumulating trend, a trend-based forecast, revenue by plan, revenue at risk,
// and trainer LTV. Computed from the live roster + persisted MRR history.
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { PLANS } from '../../src/lib/ownerMock';
import { platformRollup, type TrainerLike } from '../../src/lib/ownerAnalytics';
import { useMrrHistory } from '../../src/ui/useMrrHistory';
import { Sparkline, DeltaBadge } from '../../src/ui/charts';

const usd = (n: number) => '$' + Math.round(n).toLocaleString();

export default function OwnerRevenue() {
  const t = useTheme();
  const router = useRouter();
  const { trainers } = usePlatformTrainers();
  const roll = platformRollup(trainers as TrainerLike[]);
  const { series, delta } = useMrrHistory(roll.mrr);

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

  // Trainer LTV: avg revenue per paying trainer × estimated lifespan.
  const payingMrr = trainers.filter((x) => x.status === 'active').reduce((a, x) => a + x.mrr, 0);
  const avgMrr = roll.paying > 0 ? payingMrr / roll.paying : 0;
  const churnRate = roll.trainers > 0 ? roll.suspended / roll.trainers : 0;
  const lifespanMo = churnRate > 0 ? Math.min(48, Math.round(1 / churnRate)) : 24;
  const ltv = Math.round(avgMrr * lifespanMo);

  const Big = ({ label, value, sub, extra }: { label: string; value: string; sub?: string; extra?: any }) => (
    <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}>
      <Text style={{ color: t.ink3, fontSize: 11.5, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color: t.ink, fontSize: 21, fontWeight: '900', marginTop: 3 }}>{value}</Text>
      {extra ? <View style={{ marginTop: 4 }}>{extra}</View> : sub ? <Text style={{ color: t.ink3, fontSize: 11, marginTop: 3 }}>{sub}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.back()} style={{ marginBottom: 8 }}><Icon name="back" size={22} color={t.ink2} /></Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Revenue</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Platform revenue, forecast &amp; unit economics</Text>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <Big label="MRR" value={usd(roll.mrr)} extra={delta !== 0 ? <DeltaBadge value={delta} suffix="mo" /> : <Text style={{ color: t.ink3, fontSize: 11 }}>trainer fees</Text>} />
          <Big label="ARR" value={usd(roll.arr)} sub="annualised" />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <Big label="Avg / trainer" value={usd(avgMrr)} sub="per paying" />
          <Big label="Trainer LTV" value={usd(ltv)} sub={`~${lifespanMo} mo lifespan`} />
        </View>

        {/* Trend */}
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 2 }}>MRR trend</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12 }}>Accumulates a real monthly snapshot</Text>
          <Sparkline data={series} w={300} h={64} />
        </View>

        {/* Forecast */}
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16 }}>6-month forecast</Text>
            <Text style={{ color: growth >= 0 ? t.brand : t.crit, fontWeight: '800', fontSize: 13 }}>{growth >= 0 ? '+' : ''}{Math.round(growth * 100)}%/mo</Text>
          </View>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 14 }}>Projected from your recent growth rate — a guide, not a guarantee.</Text>
          <Sparkline data={[roll.mrr, ...forecast]} w={300} h={56} color={t.s5} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={{ color: t.ink3, fontSize: 12 }}>Now {usd(roll.mrr)}</Text>
            <Text style={{ color: t.ink, fontSize: 13, fontWeight: '800' }}>6 mo → {usd(forecast[5])}</Text>
          </View>
        </View>

        {/* Revenue by plan */}
        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 14 }}>Revenue by plan</Text>
          {byPlan.map((p) => {
            const pct = Math.round((p.revenue / planTotal) * 100);
            return (
              <View key={p.name} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}><Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{p.name}</Text><Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>{usd(p.revenue)}/mo · {pct}%</Text></View>
                <View style={{ height: 10, borderRadius: 5, backgroundColor: t.surface3, overflow: 'hidden' }}><View style={{ height: 10, borderRadius: 5, backgroundColor: t.brand, width: `${pct}%` }} /></View>
              </View>
            );
          })}
        </View>

        {/* Revenue at risk */}
        <Pressable onPress={() => router.push('/(owner)/trainers')} style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: roll.atRiskMrr > 0 ? t.warn : t.ring, padding: 18 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 6 }}>Revenue at risk</Text>
          <Text style={{ color: roll.atRiskMrr > 0 ? t.s3 : t.ink, fontSize: 24, fontWeight: '900' }}>{usd(roll.atRiskMrr)}<Text style={{ color: t.ink3, fontSize: 13, fontWeight: '600' }}>/mo</Text></Text>
          <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 4 }}>{roll.atRiskCount} trainer{roll.atRiskCount === 1 ? '' : 's'} flagged watch/high — that's {usd(roll.atRiskMrr * 12)} of ARR to defend.</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
