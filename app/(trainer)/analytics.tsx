// Trainer · Analytics — sessions delivered, clients, retention.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same numbers, same routes, same AI digest — the ten
// stacked bordered cards became hairline-separated sections, revenue became the
// screen's one hero figure, and the Georgia serif header is gone.
//
// Also removed: a `months` array of hardcoded growth fractions (Feb 0.55 …
// Jul 1) that was dead but still shipping in the bundle.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Card, Cta, Ghost, Spark, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { atRiskClient } from '../../src/lib/trainerMock';
import { STATUS_LABEL } from '../../src/lib/status';
import { useRoster } from '../../src/ui/roster';
import { DistBar } from '../../src/ui/charts';
import { askCoach } from '../../src/lib/coach';
import { useTrainerGoals, goalPct } from '../../src/ui/trainerGoals';
import { useMonthlyHistory } from '../../src/ui/useMrrHistory';
import { useSessions } from '../../src/ui/sessions';

export default function TrainerAnalytics() {
  const t = useTheme();
  const router = useRouter();
  const { roster } = useRoster();
  const { sessionFee } = useMyTrainerProfile();
  const { sessions } = useSessions();
  const atRisk = roster.filter(atRiskClient);
  const clients = roster.length;

  // Sessions actually delivered this calendar month: booked, and already
  // started. This used to be `clients * 4` - an assumption that every client
  // trains four times a month - multiplied by the rate the trainer typed into
  // their profile, and rendered as "Monthly revenue". A trainer with five
  // clients who trained nobody was shown "$1,500 · 20 sessions". The real
  // sessions were sitting in the same store the calendar screen already reads.
  const _monthStart = new Date(); _monthStart.setDate(1); _monthStart.setHours(0, 0, 0, 0);
  const _deliveredMo = sessions.filter((sx) => sx.status === 'booked'
    && Date.parse(sx.startsAt) >= _monthStart.getTime()
    && Date.parse(sx.startsAt) <= Date.now());
  const sessionsMo = _deliveredMo.length;
  // Still arithmetic, but on a real count and the trainer's own rate, and the
  // note on screen says exactly that. The $99 "platform fee" that used to be
  // subtracted here is gone: nothing charges it, and billing.tsx reports that
  // billing is not switched on while this screen called them a paying Pro
  // customer.
  // Null, not 0, when no rate is known — the same rule as `valuePerClient`
  // below, now enforced by the type rather than by remembering to write
  // `sessionFee > 0`. `sessionFee` used to be a number starting at 0, so every
  // figure derived from it was silently zero until the profile loaded.
  const revenue = sessionFee == null ? null : sessionsMo * sessionFee;
  // Null, not 0, with no clients: an average over nobody is undefined, and
  // "$0 / client" reads as a fact about a coaching business that has none.
  const valuePerClient = revenue != null && clients ? Math.round(revenue / clients) : null;
  // Average over clients who have actually checked in. Averaging a null-as-100
  // default meant a roster of strangers reported 100% adherence.
  const _adhKnown = roster.map((c) => c.adherence).filter((a): a is number => a != null);
  // Same rule. 0% adherence is a damning number to show a coach whose clients
  // have simply never checked in — and this screen opens by saying so.
  const avgAdh = _adhKnown.length ? Math.round(_adhKnown.reduce((a, x) => a + x, 0) / _adhKnown.length) : null;
  // Clients with no check-in are counted as unknown, not as on-track.
  const onTrack = roster.filter((c) => c.adherence != null && c.adherence >= 85).length;
  const watch = roster.filter((c) => c.adherence != null && c.adherence >= 70 && c.adherence < 85).length;
  const riskCount = roster.filter((c) => c.adherence != null && c.adherence < 70).length;
  // Sessions those clients actually took this month, at the trainer's rate -
  // not `at-risk count x rate x 4`, which invented a subscription nobody pays.
  const _atRiskIds = new Set(atRisk.map((c) => c.id));
  const _atRiskSessions = _deliveredMo.filter((sx) => sx.clientId && _atRiskIds.has(sx.clientId)).length;
  const atRiskRevenue = sessionFee == null ? null : _atRiskSessions * sessionFee;
  const { goals, setGoals } = useTrainerGoals();
  const [goalOpen, setGoalOpen] = useState(false);
  const [gRev, setGRev] = useState('');
  const [gCli, setGCli] = useState('');
  const [digest, setDigest] = useState('');
  const [digestBusy, setDigestBusy] = useState(false);
  const genDigest = async () => {
    setDigestBusy(true); setDigest('');
    // The model is told the rate is unset rather than handed a number, because
    // a null arriving as 0 would come back as a paragraph about a coach who
    // earned nothing this month.
    const ctx = { sessionsDeliveredThisMonth: sessionsMo, revenueAtOwnRateUsd: revenue ?? 'unknown — no session rate set', clients, avgAdherence: _adhKnown.length ? avgAdh + '%' : 'no check-ins yet', atRiskClients: atRisk.length, onTrack, watch, atRiskLow: riskCount };
    const reply = await askCoach([{ role: 'user', content: 'You are my fitness-coaching business assistant. Write a short Monday digest (3-4 sentences) from these numbers (revenueAtOwnRateUsd is sessions delivered multiplied by the coach own session rate, in US dollars): one line on revenue and clients, one on roster health (on-track vs at-risk), and one concrete action to grow or retain. Encouraging and specific.' }], ctx);
    setDigestBusy(false);
    setDigest(reply || 'Could not generate the digest right now — the AI backend may be unavailable.');
  };
  const revHist = useMonthlyHistory('repple.trainer.revHistory', revenue);
  // Only the targets that have both a number to aim at and a number reached so
  // far. A revenue goal with no session rate has the first and not the second,
  // and is spoken to separately below rather than drawn as a bar at zero.
  const goalRows = ([
    { label: 'Monthly revenue', cur: revenue, goal: goals.revenue, money: true },
    { label: 'Active clients', cur: clients, goal: goals.clients, money: false },
  ] as const).filter((g): g is typeof g & { cur: number } => g.goal > 0 && g.cur != null);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

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
          label="Sessions delivered"
          figure={fig(sessionsMo)}
          unit={sessionsMo === 1 ? 'this month' : 'this month'}
          note={revenue != null && sessionFee != null
            ? `$${revenue.toLocaleString()} at your $${sessionFee} session rate — Repple does not process this, so it is your own arithmetic, not a payout.`
            : 'Set a session rate in your profile to see what that is worth.'}
          arc={revenue != null && goals.revenue > 0 ? goalPct(revenue, goals.revenue) : undefined}
          onPress={() => router.push('/(trainer)/payments')}
        />

        <Rule />

        {/* ── the shape of the business ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Roster" note="Leaderboard" onPress={() => router.push('/(trainer)/leaderboard')} />
          <KpiRow items={[
            { label: 'Clients', value: fig(clients) },
            { label: 'Avg adherence', value: fig(avgAdh), unit: avgAdh == null ? undefined : '%' },
            { label: 'Value / client', value: valuePerClient == null ? '—' : '$' + valuePerClient.toLocaleString(), unit: valuePerClient == null ? undefined : '/mo' },
          ]} />
        </Section>

        <Rule />

        {/* ── goals ──────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your goals" note="Edit"
            onPress={() => { setGRev(String(goals.revenue)); setGCli(String(goals.clients)); setGoalOpen(true); }} />
          {goals.revenue <= 0 && goals.clients <= 0 ? (
            // Was a heading with nothing under it. A section that renders
            // empty looks broken; this one is simply not set up yet.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No targets set. Tap Edit to give yourself a monthly revenue or client number to work towards.
            </Text>
          ) : null}
          {/* A revenue target set with no session rate has a goal but no
              progress, and drawing that bar at 0% would tell a coach who has
              delivered a full month of sessions that they are nowhere. The bar
              is withheld and the reason is given instead. */}
          {goals.revenue > 0 && revenue == null ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              Monthly revenue target ${goals.revenue.toLocaleString()} — progress needs a session rate in your profile.
            </Text>
          ) : null}
          {goalRows.map((g) => {
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
                  {/* A dash, not ~$0. The figure is these clients' delivered
                      sessions priced at the coach's own rate, so with no rate
                      set there is no figure — and "~$0/mo at risk" is the one
                      reading that would make this card safe to ignore. */}
                  <Text style={{ ...value(26), color: t.ink }}>
                    {atRiskRevenue == null ? '—' : <>~${atRiskRevenue.toLocaleString()}<Text style={{ ...ty.caption, color: t.ink3 }}>/mo</Text></>}
                  </Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                    {atRisk.length} client{atRisk.length > 1 ? 's' : ''} slipping — check in before they churn.
                    {atRiskRevenue == null ? ' Set a session rate in your profile to see what that is worth.' : ''}
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
          <SectionHead title="Roster health" note={avgAdh == null ? 'no check-ins yet' : `${avgAdh}% avg adherence`} onPress={() => router.push('/(trainer)/leaderboard')} />
          <DistBar segments={[
            { label: STATUS_LABEL.on_track, value: onTrack, color: t.brand },
            { label: STATUS_LABEL.watch, value: watch, color: t.warn },
            { label: STATUS_LABEL.at_risk, value: riskCount, color: t.crit },
          ]} />
          <View style={{ flexDirection: 'row', gap: sp.lg, marginTop: sp.md }}>
            {([[STATUS_LABEL.on_track, onTrack, t.brand], [STATUS_LABEL.watch, watch, t.warn], [STATUS_LABEL.at_risk, riskCount, t.crit]] as const).map(([l, v, col]) => (
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
          {revHist.months >= 2 ? (<>
          <Spark data={revHist.series.filter((v): v is number => v != null)} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
            {revHist.labels.map((l, i) => (
              <Text key={i} style={{ ...ty.micro, letterSpacing: 0.4, color: t.ink3 }}>{revHist.series[i] != null ? l : ''}</Text>
            ))}
          </View>
          </>) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>Not enough history yet — a snapshot is recorded each month, and the trend appears from the second one.</Text>
          )}
        </Section>

        <Rule />

        {/* ── client value ───────────────────────────────────────────────── */}

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
              <View style={{ width: 6, height: 6, borderRadius: 3, marginRight: sp.md, backgroundColor: (c.adherence != null && c.adherence < 82) ? t.crit : t.warn }} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {(c.adherence != null && c.adherence < 82) ? `Low adherence · ${c.adherence}%` : 'Inactive'} · last active {c.lastActive}
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
          <ListRow icon="chart" title="Payments"
            onPress={() => router.push('/(trainer)/payments')} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            {sessionFee == null
              ? 'Set a session rate in your profile to see what a new client is worth.'
              : `Every new client at $${sessionFee}/session adds about $${(sessionFee * 4).toLocaleString()}/mo.`}
          </Text>
        </Section>

      </ScrollView>

      {/* ── goal editor ──────────────────────────────────────────────────── */}
      <Modal visible={goalOpen} transparent animationType="slide" onRequestClose={() => setGoalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
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
              </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
