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
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Card, Cta, Ghost, QuickRow, Spark, Notice, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { useTenant, gymMoney } from '../../src/ui/tenant';
import { num } from '../../src/lib/format';
import { usePlatformTrainers } from '../../src/ui/trainers';
import { gymRollup, trainerHealth, type TrainerLike } from '../../src/lib/ownerAnalytics';
import { riskLabel } from '../../src/lib/status';
import { HealthPill } from '../../src/ui/charts';
import { useSessionsHistory } from '../../src/ui/useMrrHistory';
import { cohorts } from '../../src/lib/ownerAnalytics';
import { ownerReportDoc, shareDoc } from '../../src/lib/exportShare';
import { reportError } from '../../src/lib/reportError';
import { Linking } from 'react-native';

// Labels come from the one settled scale now — see src/lib/status.ts for why
// "Not delivering" is gone and what "Idle" does and does not mean.

export default function OwnerOverview() {
  const t = useTheme(); const router = useRouter();
  // `loading` is destructured because the provider exposes it for exactly one
  // reason: until the roster read returns, every roll-up below is computed over
  // an empty array. Ignoring it put "Sessions delivered · 30 days · 0" and "No
  // trainers yet" on the console's biggest figure while the query was still in
  // flight — an owner opening the app first thing was told their gym delivered
  // nothing last month, in the same confident type used when it is true.
  const { trainers, loading, status: trainersStatus, sessions30, payroll30 } = usePlatformTrainers();
  // `loading` covered the in-flight case. It does not cover the read having
  // FAILED — that also leaves `trainers` empty, and every roll-up below then
  // computes a confident 0 over it. Same wrong sentence, arrived at a second
  // later: an owner told their gym delivered nothing last month.
  const trainersUnread = trainersStatus === 'error';
  const trainersUnknown = loading || trainersUnread;
  const { tenant } = useTenant();
  // The gym's own currency (`tenants.currency`, part 99). Null until the tenant
  // read returns, and gymMoney falls back to GYM_CURRENCY for that window.
  const cur = tenant?.currency ?? null;
  const roll = gymRollup(trainers as TrainerLike[], tenant?.sessionFee ?? null);
  // This hook PERSISTS what it is handed, so a figure we are unsure of is not
  // wrong for a second — it is saved as this month's history and nothing later
  // can tell it from a month that really was quiet. `sessions30` is already null
  // under a failed read; the `loading` half is added here because a sum over a
  // roster still in flight is a zero for the same reason and keeps for as long.
  const { series, labels, delta, months } = useSessionsHistory(trainersUnknown ? null : sessions30);
  const [sel, setSel] = useState<TrainerLike | null>(null);

  // Client load per trainer. The old version split revenue by Repple plan,
  // which is what a trainer pays us, not anything the gym earns.
  const byTrainer = [...trainers].sort((a, b) => b.clients - a.clients).slice(0, 5);
  const maxLoad = Math.max(1, ...byTrainer.map((x) => x.clients));
  // Trainers sorted worst-health first so problems surface at the top.
  const ranked = [...(trainers as TrainerLike[])].map((tr) => ({ tr, h: trainerHealth(tr) })).sort((a, b) => a.h.score - b.h.score);
  const selHealth = sel ? trainerHealth(sel) : null;
  // ── The failed-payments callout is gone, and it should never have been here.
  //
  // It read `invoices`, which is the Stripe ledger for a TRAINER paying REPPLE
  // (part 20) — not gym money. It is a survivor of the subscription console
  // this app used to be. So a gym owner was shown "AED X in failed payments,
  // retry or chase before they churn" over other people's platform bills, in a
  // currency it hardcoded, and the money their own members owe them was never
  // on this screen at all.
  //
  // The Trainers screen states the principle in its own header: what a trainer
  // pays Repple is "not a number a gym owner has any business seeing on their
  // own dashboard".
  //
  // It was also reading across every gym in the project. `invoices` has no
  // tenant column, and the policy's second arm was an unscoped
  // `role = 'owner'`, so the query returned every trainer's invoices
  // everywhere. Part 106 removes that arm; this removes the reader.
  //
  // The gym's own receivables are `gym_invoices` (part 29) and its payments are
  // `gym_payments`, read by the Members screen. A callout over those would be
  // the right feature — it is not this one.
  const exportReport = async () => {
    // The one artefact on this screen that leaves the app. Every figure in it
    // is a roll-up of `trainers`, and ownerReportDoc prints each one as a bare
    // String(...) with no way to render an unknown — so a refused roster read
    // produced a document headed with the gym's name reading "Trainers: 0 /
    // Clients: 0 / Sessions · 30d: 0", which the owner then sent to a bank, a
    // landlord or a board. On screen a wrong figure is corrected by the next
    // refresh; in somebody else's inbox it is permanent, and nothing in the
    // document says where the zeroes came from. So the share is refused rather
    // than dashed: there is no honest version of this report to send yet.
    if (trainersUnknown) {
      Alert.alert(
        loading ? 'Still reading your roster' : 'Roster could not be read',
        loading
          ? 'Your trainers have not come back yet, so every figure in the report would be a zero this app has not confirmed. Try again in a moment.'
          : 'Your trainers could not be read, so a report built now would state that your gym has no trainers, no clients and no sessions — none of which this app found out. Reload the roster and share it then.',
      );
      return;
    }
    const doc = ownerReportDoc({
      trainers: roll.trainers, clients: roll.clients, sessions30: roll.sessions30,
      payroll30: roll.payroll30, atRiskCount: roll.atRiskCount, atRiskClients: roll.atRiskClients,
      avgClientsPerTrainer: roll.avgClientsPerTrainer,
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
            {/* The owner's own gym, not "Repple HQ · Platform" — this app is
                one gym's console, and the previous wording read like an
                internal admin tool belonging to somebody else. */}
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }} numberOfLines={1}>
              {/* Said "in Ops". Ops gained the session FEE; the gym's NAME is
                  in Brand. Sending an owner to the wrong screen for the one
                  thing the hero is asking them to do. */}
              {tenant?.name?.trim() || 'Name your gym in Brand'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: 2 }}>
            <Ghost icon="search" onPress={() => router.push('/(owner)/explore')} />
            <Ghost icon="share" onPress={exportReport} />
          </View>
        </View>

        {/* ── shortcuts ──────────────────────────────────────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          <QuickRow items={[
            { icon: 'people', label: 'Trainers', onPress: () => router.push('/(owner)/trainers') },
            { icon: 'me', label: 'Members', onPress: () => router.push('/(owner)/members') },
            { icon: 'palette', label: 'Brand', onPress: () => router.push('/(owner)/brand') },
            { icon: 'trending', label: 'Growth', onPress: () => router.push('/(owner)/growth') },
            { icon: 'wrench', label: 'Ops', onPress: () => router.push('/(owner)/ops') },
          ]} />
        </View>

        {/* ── interrupts: things that need a decision now ─────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          {roll.atRiskCount > 0 ? (
            <Notice tone={t.warn} kicker="Needs a look"
              title={`${roll.atRiskCount} trainer${roll.atRiskCount > 1 ? 's' : ''} flagged`}
              note={`${roll.atRiskClients} client${roll.atRiskClients === 1 ? '' : 's'} are with them — review the most urgent.`}>
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Review" wide
                  onPress={() => { const first = ranked.find((r) => r.h.risk === 'high' || r.h.risk === 'watch'); if (first) setSel(first.tr); }} />
              </View>
            </Notice>
          ) : null}

        </View>

        {!loading && roll.trainers === 0 ? (
          <Card style={{ marginTop: sp.sm }}>
            <Text style={{ ...ty.label, color: t.ink2 }}>
              {trainersUnread
                ? 'Your trainers could not be read, so this is not "no trainers" — pull down to try again.'
                : 'No trainers yet — clients, delivered sessions and trainer health fill in as they join your gym.'}
            </Text>
          </Card>
        ) : null}

        {/* ── the hero ───────────────────────────────────────────────────── */}
        <Hero
          label="Sessions Delivered · 30 Days"
          figure={trainersUnknown ? '—' : num(roll.sessions30)}
          note={loading
            ? 'Reading your roster…'
            : trainersUnread
            ? 'Your trainers could not be read'
            : delta !== 0
            ? `${delta > 0 ? '+' : '−'}${num(Math.abs(delta))} vs last month`
            : roll.payroll30 == null
              ? 'Set a session fee in Ops to value these'
              // Null here also covers "the gym has not set a currency", and an
              // unguarded ${} would say "Worth null at your session fee".
              : gymMoney(roll.payroll30, cur) == null
              ? "Set your gym's currency in Ops to value these"
              : `Worth ${gymMoney(roll.payroll30, cur)} at your session fee`}
          onPress={() => router.push('/(owner)/revenue')}
        />

        <Rule />

        {/* ── the shape of the platform ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Your Gym" note="Trainers" onPress={() => router.push('/(owner)/trainers')} />
          <KpiRow items={[
            { label: 'Trainers', value: trainersUnknown ? '—' : fig(roll.trainers), delta: loading ? 'not read yet' : trainersUnread ? 'could not be read' : roll.avgSessionsPerTrainer == null ? 'no trainers yet' : `${roll.avgSessionsPerTrainer} sessions avg` },
            { label: 'Clients', value: trainersUnknown ? '—' : fig(num(roll.clients)), delta: loading ? 'not read yet' : trainersUnread ? 'could not be read' : roll.avgClientsPerTrainer == null ? 'no trainers yet' : `${roll.avgClientsPerTrainer} avg / trainer` },
            { label: 'Payroll · 30d', value: trainersUnknown ? '—' : fig(gymMoney(roll.payroll30, cur)), delta: loading ? 'not read yet' : trainersUnread ? 'could not be read' : roll.payroll30 == null ? 'no session fee set' : 'at your session fee' },
          ]} />
        </Section>

        <Rule />

        {/* ── MRR trend (real, accumulating) ─────────────────────────────── */}
        <Section>
          {/* `delta` is a count of SESSIONS — useSessionsHistory keeps its own
              key precisely so session counts and the old dollar history cannot
              be drawn as one line. It was printed with a dollar sign in front
              of it, so a month up twelve sessions read "+$12 vs last mo". */}
          <SectionHead title="Sessions Trend"
            note={delta !== 0 ? `${delta > 0 ? '+' : '−'}${num(Math.abs(delta))} session${Math.abs(delta) === 1 ? '' : 's'} vs last mo` : 'Tracking started'}
            onPress={() => router.push('/(owner)/revenue')} />
          {months >= 2 ? (
            /* The series goes in WITH its holes, and the months go in with it.
               This was `series.filter((v) => v != null)` over a hand-rolled
               label row, which drew four points across the width while
               printing six evenly spaced months underneath — so every point
               sat above the wrong one. <Spark> now places each point and its
               own label from the same index, and breaks the line across a
               month nobody recorded instead of closing over it. */
            <Spark data={series} labels={labels} />
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>Not enough history yet — a snapshot is recorded each month, and the trend appears from the second one.</Text>
          )}
        </Section>

        <Rule />

        {/* ── trainer health board ───────────────────────────────────────── */}
        <Section>
          <SectionHead title="Trainer Health" note="Worst first" />
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : trainersUnread ? (
            // Ahead of the empty branch: an unread roster scores nobody, which
            // is not the same as there being nobody to score.
            <Text style={{ ...ty.label, color: t.ink3 }}>Your trainers could not be read, so none of them were scored — nobody here has been cleared.</Text>
          ) : ranked.length === 0 ? (
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
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{riskLabel(h.risk)} · {tr.clients} client{tr.clients === 1 ? '' : 's'} · {tr.sessions30} session{tr.sessions30 === 1 ? '' : 's'}</Text>
                </View>
              </View>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{tr.sessions30} in 30d</Text>
            </Pressable>
          ))}
        </Section>

        <Rule />

        {/* ── revenue by plan ────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Client Load" note="Revenue" onPress={() => router.push('/(owner)/revenue')} />
          {byTrainer.map((p) => (
            <View key={p.id} style={{ marginBottom: sp.lg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ ...ty.caption, color: t.ink2 }}>{p.name}</Text>
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{p.clients} client{p.clients === 1 ? '' : 's'}</Text>
              </View>
              <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
                <View style={{ height: 3, borderRadius: 2, width: `${Math.round((p.clients / maxLoad) * 100)}%`, backgroundColor: t.brand, opacity: p.clients > 0 ? 1 : 0.55 }} />
              </View>
            </View>
          ))}
        </Section>

        <Rule />

        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          <ListRow icon="trending" title="Revenue Analytics" note="Forecast, plan mix, LTV & revenue at risk"
            onPress={() => router.push('/(owner)/revenue')} />
          <ListRow icon="sparkle" title="Financial Health · AI Review" note="KPIs, retention & where to improve · connect accounting"
            onPress={() => router.push('/(owner)/financials')} />
          <ListRow icon="share" title="Promotions" note="Create an offer & push it to members"
            onPress={() => router.push('/(owner)/promotions')} />
          <ListRow icon="calendar" title="Classes & Payroll" note="Attendance, fill rates & trainer pay per check-in"
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
                {[['Clients', String(sel.clients)], ['Sessions · 30d', String(sel.sessions30)], ['Health', String(trainerHealth(sel).score)]].map(([l, v], i) => (
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
