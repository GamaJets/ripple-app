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
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, Spark, Notice, fig } from '../../src/ui/kit';
import { sp, layout, type as ty, numeric } from '../../src/theme/scale';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { useTenant } from '../../src/ui/tenant';
import { gymRollup, type TrainerLike } from '../../src/lib/ownerAnalytics';
import { useSessionsHistory } from '../../src/ui/useMrrHistory';

const usd = (n: number) => '$' + Math.round(n).toLocaleString();

export default function OwnerRevenue() {
  const t = useTheme();
  const router = useRouter();
  const { trainers } = usePlatformTrainers();
  const { tenant } = useTenant();
  const roll = gymRollup(trainers as TrainerLike[], tenant?.sessionFee ?? null);
  const { series, labels, delta, months } = useSessionsHistory(roll.sessions30);

  // Monthly growth rate from the accumulating history (geometric, clamped).
  // `n` is the number of months ACTUALLY recorded, not the window length. It
  // used to be series.length, a constant 6, so two real snapshots were divided
  // over a five-month base and four of the six inputs were back-filled copies
  // of today's figure. With fewer than two real months there is no growth rate
  // and no forecast — the screen says so instead of projecting a flat line.
  const recorded = series.filter((v): v is number => v != null);
  const first = recorded.find((v) => v > 0) ?? roll.sessions30;
  const n = months;
  const canForecast = n >= 2 && first > 0;
  let growth = canForecast ? Math.pow(roll.sessions30 / first, 1 / (n - 1)) - 1 : 0;
  growth = Math.max(-0.5, Math.min(0.5, growth));
  const forecast = Array.from({ length: 6 }, (_, i) => Math.round(roll.sessions30 * Math.pow(1 + growth, i + 1)));

  // Sessions delivered per trainer. The old split was by Repple plan, which is
  // what a trainer pays us — never a figure in the gym's own revenue.
  const byTrainer = [...trainers]
    .map((x) => ({ id: x.id, name: x.name, sessions: x.sessions30 }))
    .filter((x) => x.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
  const trainerTotal = byTrainer.reduce((a, x) => a + x.sessions, 0) || 1;

  // Value per client, from what the gym actually collects. `client_purchases`
  // is empty until payments are switched on, so this stays null rather than
  // dividing by a number nobody has earned.
  const fee = tenant?.sessionFee ?? null;
  const revenue30 = roll.payroll30;
  const valuePerClient = revenue30 != null && roll.clients > 0 ? Math.round(revenue30 / roll.clients) : null;

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
          label="Sessions delivered · 30 days"
          figure={fig(roll.sessions30)}
          note={delta !== 0
            ? `${delta > 0 ? '+' : '−'}${Math.abs(delta)} vs last month${revenue30 != null ? ` · ${usd(revenue30)} at your fee` : ''}`
            : revenue30 != null
              ? `${usd(revenue30)} at your session fee`
              : 'Set a session fee in Ops to value these'}
        />

        <Rule />

        {/* ── unit economics ─────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Unit economics" note="Per client" />
          <KpiRow items={[
            { label: 'Session fee', value: fee == null ? '—' : usd(fee), delta: fee == null ? 'not set' : 'per delivered session' },
            { label: 'Value / client', value: valuePerClient == null ? '—' : usd(valuePerClient), delta: valuePerClient == null ? 'needs a session fee' : 'last 30 days' },
            { label: 'Clients', value: fig(roll.clients), delta: `${roll.avgClientsPerTrainer} avg / trainer` },
          ]} />
        </Section>

        <Rule />

        {/* ── trend ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Sessions trend"
            note={delta !== 0 ? `${delta > 0 ? '+' : '−'}${usd(Math.abs(delta))} vs last mo` : 'Tracking started'} />
          {months >= 2 ? (
            <>
              <Spark data={series.filter((v): v is number => v != null)} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
                {labels.map((l, i) => (
                  <Text key={i} style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3 }}>{series[i] != null ? l : ''}</Text>
                ))}
              </View>
            </>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>Not enough history yet — a snapshot is recorded each month, and the trend appears from the second one.</Text>
          )}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>One real snapshot per month — months before you started are left blank.</Text>
        </Section>

        <Rule />

        {/* ── forecast ───────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="6-month forecast" note={canForecast ? `${growth >= 0 ? '+' : ''}${Math.round(growth * 100)}%/mo` : undefined} />
          {canForecast ? (<>
            <Spark data={[roll.sessions30, ...forecast]} h={58} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>Now {roll.sessions30}</Text>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink }}>6 mo → {forecast[5]}</Text>
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Projected from {n} months of your own history — a guide, not a guarantee.
            </Text>
          </>) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>A forecast needs at least two months of recorded sessions. Come back next month.</Text>
          )}
        </Section>

        <Rule />

        {/* ── revenue by plan ────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Sessions by trainer" note={byTrainer.length > 0 ? `${trainerTotal} in 30d` : undefined} />
          {byTrainer.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No sessions delivered in the last 30 days.</Text>
          ) : byTrainer.map((p) => {
            const pct = Math.round((p.sessions / trainerTotal) * 100);
            return (
              <View key={p.id} style={{ marginBottom: sp.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{p.name}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{p.sessions} · {pct}%</Text>
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
          {roll.atRiskCount > 0 ? (
            <Notice tone={t.warn} kicker="Needs a look" title={`${roll.atRiskCount} trainer${roll.atRiskCount === 1 ? '' : 's'} flagged`}
              note={`${roll.atRiskClients} client${roll.atRiskClients === 1 ? '' : 's'} are with them.`}>
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
