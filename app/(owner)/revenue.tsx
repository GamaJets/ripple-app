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
import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { num } from '../../src/lib/format';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, Spark, Notice, fig } from '../../src/ui/kit';
import { sp, layout, type as ty, numeric } from '../../src/theme/scale';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { useTenant, gymMoney } from '../../src/ui/tenant';
import { gymRollup, type TrainerLike } from '../../src/lib/ownerAnalytics';
import { useSessionsHistory } from '../../src/ui/useMrrHistory';

export default function OwnerRevenue() {
  const t = useTheme();
  const router = useRouter();
  // Every figure below is a roll-up of `trainers`, so until the roster read
  // returns they are all roll-ups of an empty array. Rendered without this flag
  // the screen opened on "Sessions delivered · 30 days · 0" and a value per
  // client of a dash — a revenue console reporting no revenue, which is the one
  // thing an owner would act on and the one thing it had not yet asked.
  const { trainers, loading, status: trainersStatus, sessions30, refresh } = usePlatformTrainers();
  // `loading` was only half of it. A REFUSED roster read also leaves `trainers`
  // empty with `loading` false, and every roll-up below then computes a
  // confident 0 over it: "Sessions Delivered · 30 Days — 0", "Clients 0", a
  // forecast drawn from nothing. That is the same wrong screen the loading flag
  // was added to prevent, arriving a second later and staying. Overview already
  // tells the two apart; this is that check, here.
  const trainersUnread = trainersStatus === 'error';
  const trainersUnknown = loading || trainersUnread;
  const { tenant } = useTenant();
  // The gym's own currency (`tenants.currency`, part 99). Null until the tenant
  // read returns, and gymMoney falls back to GYM_CURRENCY for that window.
  const cur = tenant?.currency ?? null;
  const roll = gymRollup(trainers as TrainerLike[], tenant?.sessionFee ?? null);
  // The history hook PERSISTS what it is given, so this month's snapshot has to
  // be null rather than a zero we cannot vouch for — once "0 sessions" is in
  // AsyncStorage nothing afterwards can tell it from a month that really was
  // quiet, and the trend carries it forever. `sessions30` off the provider is
  // already null under a failed read; the `loading` half is ours, because a read
  // still in flight is no more a zero than a refused one is.
  const { series, labels, delta, months } = useSessionsHistory(trainersUnknown ? null : sessions30);

  // Monthly growth rate from the accumulating history (geometric, clamped).
  // `n` is the number of months ACTUALLY recorded, not the window length. It
  // used to be series.length, a constant 6, so two real snapshots were divided
  // over a five-month base and four of the six inputs were back-filled copies
  // of today's figure. With fewer than two real months there is no growth rate
  // and no forecast — the screen says so instead of projecting a flat line.
  const recorded = series.filter((v): v is number => v != null);
  const first = recorded.find((v) => v > 0) ?? roll.sessions30;
  const n = months;
  // Stored history survives a failed read, so `months` can still be 2 while
  // today's figure is unknown — and the growth rate divides by today's figure.
  // Forecasting from an unread month projects the gym to zero and puts a
  // confident "−50%/mo" on the screen.
  const canForecast = !trainersUnknown && n >= 2 && first > 0;
  let growth = canForecast ? Math.pow(roll.sessions30 / first, 1 / (n - 1)) - 1 : 0;
  growth = Math.max(-0.5, Math.min(0.5, growth));
  const forecast = Array.from({ length: 6 }, (_, i) => Math.round(roll.sessions30 * Math.pow(1 + growth, i + 1)));
  // The months the forecast lands in, so the chart can say WHICH six. It read
  // "Now" at one end and "6 mo →" at the other, which is a duration and not a
  // date — an owner could not tell whether the far end was February or March.
  //
  // Built with the Date constructor's own month rollover and read back through
  // local getters, the same way monthlyHistory.monthKey does it: `new Date(y,
  // m + k, 1)` normalises December + 1 into January of the next year, and
  // nothing here is ever parsed from a string, so a coach in Auckland gets
  // their own months and not UTC's.
  const forecastLabels = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 7 }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }, []);

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
  // `roll.payroll30` is delivered × fee over an empty roster, which is a real 0
  // when the gym delivered nothing and an unknown when we could not ask.
  const revenue30 = trainersUnknown ? null : roll.payroll30;
  const valuePerClient = revenue30 != null && roll.clients > 0 ? Math.round(revenue30 / roll.clients) : null;
  // Said the same way wherever a figure is missing for the same reason, so an
  // owner reading three dashes is told once what they mean.
  const unreadNote = 'Your trainers could not be read';

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
          label="Sessions Delivered · 30 Days"
          figure={trainersUnknown ? '—' : num(roll.sessions30)}
          note={loading
            ? 'Reading your roster…'
            : trainersUnread
            ? unreadNote
            // gymMoney is null when the fee is unset OR the gym has not set a
            // currency, and both have to be branched on before the value is
            // interpolated — `${null}` puts the word "null" in the sentence.
            : delta !== 0
            ? `${delta > 0 ? '+' : '−'}${num(Math.abs(delta))} vs last month${gymMoney(revenue30, cur) != null ? ` · ${gymMoney(revenue30, cur)} at your fee` : ''}`
            : gymMoney(revenue30, cur) != null
              ? `${gymMoney(revenue30, cur)} at your session fee`
              : revenue30 != null
                ? "Set your gym's currency in Ops to value these"
                : 'Set a session fee in Ops to value these'}
        />

        {/* Said once, at the top, rather than left for an owner to infer from a
            screen of dashes: the dashes are unknowns, not a quiet month. The
            retry is the provider's own `refresh` — this screen has no
            pull-to-refresh, so without a button there is nothing an owner can
            actually do about it. */}
        {trainersUnread ? (
          <Notice tone={t.warn} kicker="Nothing here is your gym's"
            title="Your roster could not be read"
            note="Every figure on this screen is a roll-up of your trainers, so none of them can be stated.">
            <View style={{ marginTop: sp.lg }}>
              <Cta label="Try Again" wide onPress={refresh} />
            </View>
          </Notice>
        ) : null}

        <Rule />

        {/* ── unit economics ─────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Unit Economics" note="Per client" />
          {/* The session fee is the tenant's own row, not a roll-up, so it
              survives a failed roster read and is still worth stating. */}
          <KpiRow items={[
            { label: 'Session Fee', value: fig(gymMoney(fee, cur)), delta: fee == null ? 'not set' : 'per delivered session' },
            { label: 'Value / Client', value: trainersUnknown ? '—' : fig(gymMoney(valuePerClient, cur)),
              delta: loading ? 'not read yet' : trainersUnread ? unreadNote : valuePerClient == null ? 'needs a session fee' : 'last 30 days' },
            { label: 'Clients', value: trainersUnknown ? '—' : fig(roll.clients),
              delta: loading ? 'not read yet' : trainersUnread ? unreadNote : roll.avgClientsPerTrainer == null ? 'no trainers yet' : `${roll.avgClientsPerTrainer} avg / trainer` },
          ]} />
        </Section>

        <Rule />

        {/* ── trend ──────────────────────────────────────────────────────── */}
        <Section>
          {/* `delta` counts SESSIONS — it comes out of useSessionsHistory,
              whose whole point is that it is a different unit from the MRR
              history it sits next to. It was printed through a dollar
              formatter, so a month that gained twelve sessions read "+$12 vs
              last mo" under a heading saying Sessions, and an owner had no way
              to know which of the two the screen meant. */}
          <SectionHead title="Sessions Trend"
            note={delta !== 0 ? `${delta > 0 ? '+' : '−'}${num(Math.abs(delta))} session${Math.abs(delta) === 1 ? '' : 's'} vs last mo` : 'Tracking started'} />
          {months >= 2 ? (
            /* With the holes, and with the months. See the same note on the
               owner dashboard: filtering the nulls out drew the line over four
               points and the labels over six, so each point was reported under
               a month it did not belong to. */
            <Spark data={series} labels={labels} />
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
            <Spark data={[roll.sessions30, ...forecast]} labels={forecastLabels} h={58} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>Now {num(roll.sessions30)}</Text>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink }}>6 mo → {num(forecast[5])}</Text>
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Projected from {n} months of your own history — a guide, not a guarantee.
            </Text>
          </>) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {trainersUnknown
                ? 'A forecast is drawn from this month against the months before it, and this month is not known yet.'
                : 'A forecast needs at least two months of recorded sessions. Come back next month.'}
            </Text>
          )}
        </Section>

        <Rule />

        {/* ── revenue by plan ────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Sessions by Trainer" note={byTrainer.length > 0 ? `${num(trainerTotal)} in 30d` : undefined} />
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : trainersUnread ? (
            // Before this branch an empty `byTrainer` — which is what a refused
            // read leaves behind — printed a flat statement about the gym's
            // last thirty days.
            <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read, so what they delivered is not known — this is not a month with no sessions in it.</Text>
          ) : byTrainer.length === 0 ? (
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
                <Cta label="Review Trainers" wide onPress={() => router.push('/(owner)/trainers')} />
              </View>
            </Notice>
          ) : (<>
            <SectionHead title="Revenue at Risk" note="Trainers" onPress={() => router.push('/(owner)/trainers')} />
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {loading ? 'Reading your roster…'
                : trainersUnread ? 'Your trainers could not be read, so none of them could be scored — nobody has been cleared here.'
                : roll.trainers === 0 ? 'No trainers on the platform yet.'
                : 'No trainers flagged watch or high risk.'}
            </Text>
          </>)}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
