// Trainer · Analytics — revenue, clients, retention, platform fee.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same numbers, same routes, same AI digest — the ten
// stacked bordered cards became hairline-separated sections, revenue became the
// screen's one hero figure, and the Georgia serif header is gone.
//
// Also removed: a `months` array of hardcoded growth fractions (Feb 0.55 …
// Jul 1) that was dead but still shipping in the bundle.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import {
  Rule, Section, SectionHead, Hero, KpiRow, ListRow, Card, Cta, Ghost, Spark,
} from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { useCoachProfile } from '../../src/ui/coachProfile';
import { atRiskClient } from '../../src/lib/trainerMock';
import { useRoster } from '../../src/ui/roster';
import { DistBar } from '../../src/ui/charts';
import { askCoach } from '../../src/lib/coach';
import { useTrainerGoals, goalPct } from '../../src/ui/trainerGoals';
import { useMonthlyHistory } from '../../src/ui/useMrrHistory';

export default function TrainerAnalytics() {
  const t = useTheme();
  const router = useRouter();
  const { roster } = useRoster();
  const { sessionFee } = useCoachProfile();
  const atRisk = roster.filter(atRiskClient);
  const clients = roster.length;
  const sessionsMo = clients * 4;
  const revenue = sessionsMo * sessionFee;
  const platformFee = 99;
  const net = revenue - platformFee;
  const valuePerClient = clients ? Math.round(revenue / clients) : 0;
  const avgAdh = clients ? Math.round(roster.reduce((a, c) => a + c.adherence, 0) / clients) : 0;
  const estTenureMonths = Math.max(3, Math.min(24, Math.round(6 + (avgAdh - 70) / 10 * 3)));
  const estLtv = valuePerClient * estTenureMonths;
  const onTrack = roster.filter((c) => c.adherence >= 85).length;
  const watch = roster.filter((c) => c.adherence >= 70 && c.adherence < 85).length;
  const riskCount = roster.filter((c) => c.adherence < 70).length;
  const atRiskRevenue = atRisk.length * sessionFee * 4;
  const { goals, setGoals } = useTrainerGoals();
  const [goalOpen, setGoalOpen] = useState(false);
  const [gRev, setGRev] = useState('');
  const [gCli, setGCli] = useState('');
  const [digest, setDigest] = useState('');
  const [digestBusy, setDigestBusy] = useState(false);
  const genDigest = async () => {
    setDigestBusy(true); setDigest('');
    const ctx = { revenueUsd: revenue, netUsd: net, clients, avgAdherence: avgAdh + '%', atRiskClients: atRisk.length, onTrack, watch, atRiskLow: riskCount };
    const reply = await askCoach([{ role: 'user', content: 'You are my fitness-coaching business assistant. Write a short Monday digest (3-4 sentences) from these numbers (revenueUsd/netUsd are US dollars/month): one line on revenue and clients, one on roster health (on-track vs at-risk), and one concrete action to grow or retain. Encouraging and specific.' }], ctx);
    setDigestBusy(false);
    setDigest(reply || 'Could not generate the digest right now — the AI backend may be unavailable.');
  };
  const revHist = useMonthlyHistory('repple.trainer.revHistory', revenue);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your coaching business</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Analytics</Text>
        </View>

        {clients === 0 ? (
          <Card style={{ marginTop: sp.lg }}>
            <Text style={{ ...ty.label, color: t.ink2 }}>
              No clients yet — revenue, adherence and roster health populate as you add clients and run sessions.
            </Text>
          </Card>
        ) : null}

        {/* ── the hero ───────────────────────────────────────────────────── */}
        <Hero
          label="Monthly revenue"
          figure={'$' + revenue.toLocaleString()}
          note={clients ? `${sessionsMo} sessions × $${sessionFee} · $${net.toLocaleString()} net after the $${platformFee} platform fee` : 'Set your session rate and add clients to start tracking.'}
          arc={goals.revenue ? goalPct(revenue, goals.revenue) : undefined}
          onPress={() => router.push('/(trainer)/payments')}
        />

        <Rule />

        {/* ── the shape of the business ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Roster" note="Leaderboard" onPress={() => router.push('/(trainer)/leaderboard')} />
          <KpiRow items={[
            { label: 'Clients', value: String(clients) },
            { label: 'Avg adherence', value: String(avgAdh), unit: '%' },
            { label: 'Value / client', value: '$' + valuePerClient.toLocaleString(), unit: '/mo' },
          ]} />
        </Section>

        <Rule />

        {/* ── goals ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your goals" note="Edit"
            onPress={() => { setGRev(String(goals.revenue)); setGCli(String(goals.clients)); setGoalOpen(true); }} />
          {[
            { label: 'Monthly revenue', cur: revenue, goal: goals.revenue, money: true },
            { label: 'Active clients', cur: clients, goal: goals.clients, money: false },
          ].map((g) => {
            const pc = goalPct(g.cur, g.goal);
            const hit = pc >= 1;
            return (
              <View key={g.label} style={{ marginBottom: sp.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{g.label}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
                    {g.money ? '$' + g.cur.toLocaleString() : g.cur} / {g.money ? '$' + g.goal.toLocaleString() : g.goal}
                  </Text>
                </View>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
                  <View style={{ height: 3, borderRadius: 2, width: `${pc * 100}%`, backgroundColor: t.brand, opacity: hit ? 1 : 0.55 }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                  {hit ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.brand }} /> : null}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{hit ? 'Goal reached' : Math.round(pc * 100) + '% there'}</Text>
                </View>
              </View>
            );
          })}
        </Section>

        {/* ── at-risk revenue: the one thing to act on ────────────────────── */}
        {atRisk.length > 0 ? (<>
          <Rule />
          <Section>
            <Card tone={t.warn}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.sm }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                <Text style={{ ...ty.micro, color: t.ink3 }}>Revenue at risk</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...value(26), color: t.ink }}>~${atRiskRevenue.toLocaleString()}<Text style={{ ...ty.caption, color: t.ink3 }}>/mo</Text></Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                    {atRisk.length} client{atRisk.length > 1 ? 's' : ''} slipping — check in before they churn.
                  </Text>
                </View>
                <Cta label="Review" onPress={() => router.push('/(trainer)/dashboard')} />
              </View>
            </Card>
          </Section>
        </>) : null}

        <Rule />

        {/* ── roster health ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Roster health" note={`${avgAdh}% avg adherence`} onPress={() => router.push('/(trainer)/leaderboard')} />
          <DistBar segments={[
            { label: 'On track', value: onTrack, color: t.brand },
            { label: 'Watch', value: watch, color: t.warn },
            { label: 'At risk', value: riskCount, color: t.crit },
          ]} />
          <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.md }}>
            {([['On track', onTrack, t.brand], ['Watch', watch, t.warn], ['At risk', riskCount, t.crit]] as const).map(([l, v, col]) => (
              <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: col }} />
                <Text style={{ ...ty.caption, color: t.ink2 }}>{l} {v}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Rule />

        {/* ── revenue trend ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Revenue trend"
            note={revHist.delta !== 0 ? `${revHist.delta > 0 ? '+' : '−'}$${Math.abs(revHist.delta).toLocaleString()} vs last mo` : 'Tracking started'}
            onPress={() => router.push('/(trainer)/payments')} />
          <Spark data={revHist.series} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
            {revHist.labels.map((l, i) => (
              <Text key={i} style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3 }}>{l}</Text>
            ))}
          </View>
        </Section>

        <Rule />

        {/* ── client value ───────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Client value" note="Estimated" />
          <KpiRow items={[
            { label: 'Value / client', value: '$' + valuePerClient.toLocaleString(), unit: '/mo' },
            { label: 'Est. tenure', value: String(estTenureMonths), unit: 'mo' },
            { label: 'Est. LTV', value: '$' + estLtv.toLocaleString() },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Estimated from revenue and adherence-based retention — higher adherence lifts estimated tenure.
            Real per-client tenure tracks once clients link accounts.
          </Text>
        </Section>

        <Rule />

        {/* ── at-risk clients ────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="At-risk clients" note="Low adherence or inactive 2+ days" />
          {atRisk.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Everyone is on track.</Text>
          ) : atRisk.map((c, i) => (
            <View key={c.id} style={{
              flexDirection: 'row', alignItems: 'center', paddingVertical: sp.md,
              borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, marginRight: sp.md, backgroundColor: c.adherence < 82 ? t.crit : t.warn }} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {c.adherence < 82 ? 'Low adherence' : 'Inactive'} · {c.adherence}% · last active {c.lastActive}
                </Text>
              </View>
            </View>
          ))}
        </Section>

        <Rule />

        {/* ── AI digest ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Weekly business digest" />
          {digest ? (
            <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>{digest}</Text>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>An AI Monday summary of your coaching business.</Text>
          )}
          <Pressable onPress={genDigest} disabled={digestBusy}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
                     backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: 12, opacity: digestBusy ? 0.6 : 1 }}>
            {digestBusy ? <ActivityIndicator color={t.brand} /> : <Icon name="sparkle" size={15} color={t.brand} />}
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>
              {digestBusy ? 'Writing…' : digest ? 'Regenerate' : 'Generate digest'}
            </Text>
          </Pressable>
        </Section>

        <Rule />

        <Section>
          <ListRow icon="chart" title="Payments" note={`Pro plan · $${platformFee}/mo to Repple`}
            onPress={() => router.push('/(trainer)/payments')} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Every new client at ${sessionFee}/session adds about ${(sessionFee * 4).toLocaleString()}/mo.
          </Text>
        </Section>

      </ScrollView>

      {/* ── goal editor ──────────────────────────────────────────────────── */}
      <Modal visible={goalOpen} transparent animationType="slide" onRequestClose={() => setGoalOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setGoalOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 }}>
          <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Set your goals</Text>
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Monthly revenue target ($)</Text>
          <TextInput value={gRev} onChangeText={setGRev} keyboardType="number-pad" placeholder="4000" placeholderTextColor={t.ink3}
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11, marginBottom: sp.md }} />
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Client target</Text>
          <TextInput value={gCli} onChangeText={setGCli} keyboardType="number-pad" placeholder="12" placeholderTextColor={t.ink3}
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11, marginBottom: sp.xl }} />
          <Cta label="Save goals" wide onPress={() => { setGoals({ revenue: parseInt(gRev, 10) || 0, clients: parseInt(gCli, 10) || 0 }); setGoalOpen(false); }} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => setGoalOpen(false)} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}
