// Trainer · Analytics — sessions delivered, clients, retention.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same numbers, same routes, same AI digest — the ten
// stacked bordered cards became hairline-separated sections, revenue became the
// screen's one hero figure, and the Georgia serif header is gone.
//
// Also removed: a `months` array of hardcoded growth fractions (Feb 0.55 …
// Jul 1) that was dead but still shipping in the bundle.
//
// ── Every figure here waits for a whole read ───────────────────────────────
//
// This screen is nothing but sums, averages and rankings over two sets — the
// roster and the sessions — and it read neither set's status. A figure computed
// from part of a set is not a smaller figure, it is a wrong one, so each is
// gated on `isWhole`: 'ready' and nothing else. 'partial' is refused alongside
// 'error' deliberately, because a truncated read is the more dangerous of the
// two — it produces a plausible number rather than an obviously empty screen,
// and there is nothing on a plausible number for a coach to doubt.
//
// Two of these are more than a wrong sentence. The roster-health bar always
// fills its width, so a split over a fragment of the book is drawn as the whole
// of it; it is withheld rather than drawn short. And the revenue trend WRITES:
// `useMonthlyHistory` stores this month's figure, so one bad month recorded
// from a truncated read stays in the chart forever, indistinguishable from a
// month that really was that quiet.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Card, Cta, Ghost, Spark, fig, Notice, PartialRead } from '../../src/ui/kit';
import { isWhole, worstStatus } from '../../src/ui/loadStatus';
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
  // This screen is nothing but figures over two sets, and it read neither set's
  // status. Every number below — the session count, the revenue, the average
  // adherence, the on-track/watch/at-risk split, the value per client, the
  // trend point written to storage — is a sum, an average or a ranking, and a
  // sum over part of a set is not a smaller sum, it is a wrong one. A coach
  // with fourteen clients whose roster read was refused was shown 0 clients, 0%
  // adherence and "$0 at risk", every one of them stated as a measurement.
  //
  // So the figures are gated on the read being WHOLE — `isWhole`, which is
  // 'ready' and nothing else. 'partial' is refused alongside 'error' here on
  // purpose: a truncated read is the more dangerous of the two, because it
  // produces a plausible number rather than an obviously empty screen.
  const { roster, status: rosterStatus } = useRoster();
  const { sessionFee } = useMyTrainerProfile();
  const { sessions, status: sessionsStatus } = useSessions();
  const rosterWhole = isWhole(rosterStatus);
  const sessionsWhole = isWhole(sessionsStatus);
  // Anything that crosses the two — revenue per client, revenue at risk, the
  // digest — is only as sound as the worse of them.
  const figureStatus = worstStatus(rosterStatus, sessionsStatus);
  const figuresWhole = isWhole(figureStatus);
  // The people are real even when the set is short, so they may be listed. It
  // is the count of them that may not be quoted.
  const atRisk = roster.filter(atRiskClient);
  const clients = rosterWhole ? roster.length : null;

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
  // Null unless the sessions read was whole. A count of the sessions that came
  // back is not a count of the sessions delivered, and this one is the hero
  // figure of the screen and the multiplicand of every money figure on it.
  const sessionsMo = sessionsWhole ? _deliveredMo.length : null;
  // Still arithmetic, but on a real count and the trainer's own rate, and the
  // note on screen says exactly that. The $99 "platform fee" that used to be
  // subtracted here is gone: nothing charges it, and billing.tsx reports that
  // billing is not switched on while this screen called them a paying Pro
  // customer.
  // Null, not 0, when no rate is known — the same rule as `valuePerClient`
  // below, now enforced by the type rather than by remembering to write
  // `sessionFee > 0`. `sessionFee` used to be a number starting at 0, so every
  // figure derived from it was silently zero until the profile loaded.
  const revenue = sessionFee == null || sessionsMo == null ? null : sessionsMo * sessionFee;
  // Null, not 0, with no clients: an average over nobody is undefined, and
  // "$0 / client" reads as a fact about a coaching business that has none.
  const valuePerClient = revenue != null && clients ? Math.round(revenue / clients) : null;
  // Average over clients who have actually checked in. Averaging a null-as-100
  // default meant a roster of strangers reported 100% adherence.
  const _adhKnown = roster.map((c) => c.adherence).filter((a): a is number => a != null);
  // Same rule. 0% adherence is a damning number to show a coach whose clients
  // have simply never checked in — and this screen opens by saying so. An
  // average over a roster that came back short is the same kind of lie one step
  // removed: it is a real average of a set nobody chose.
  const avgAdh = rosterWhole && _adhKnown.length ? Math.round(_adhKnown.reduce((a, x) => a + x, 0) / _adhKnown.length) : null;
  // Clients with no check-in are counted as unknown, not as on-track. Null when
  // the roster is not whole: these three are a distribution, and a distribution
  // over an unknown fraction of the book is drawn to full width and read as
  // everybody.
  const onTrack = rosterWhole ? roster.filter((c) => c.adherence != null && c.adherence >= 85).length : null;
  const watch = rosterWhole ? roster.filter((c) => c.adherence != null && c.adherence >= 70 && c.adherence < 85).length : null;
  const riskCount = rosterWhole ? roster.filter((c) => c.adherence != null && c.adherence < 70).length : null;
  // Sessions those clients actually took this month, at the trainer's rate -
  // not `at-risk count x rate x 4`, which invented a subscription nobody pays.
  const _atRiskIds = new Set(atRisk.map((c) => c.id));
  const _atRiskSessions = _deliveredMo.filter((sx) => sx.clientId && _atRiskIds.has(sx.clientId)).length;
  // Both sets have to be whole: the sessions being counted, and the roster that
  // decides which clients count. Short either one and this understates the
  // money at risk, which is the one direction that makes the card safe to
  // ignore.
  const atRiskRevenue = sessionFee == null || !figuresWhole ? null : _atRiskSessions * sessionFee;
  const { goals, setGoals } = useTrainerGoals();
  const [goalOpen, setGoalOpen] = useState(false);
  const [gRev, setGRev] = useState('');
  const [gCli, setGCli] = useState('');
  const [digest, setDigest] = useState('');
  const [digestBusy, setDigestBusy] = useState(false);
  // The digest is prose a coach acts on, written from these numbers. With the
  // reads short or refused every input to it is null, and a paragraph composed
  // from nulls is not a cautious digest — it is a confident one about a
  // business that does not exist. The button is withheld instead, which is why
  // this guard is here as well as on the control.
  const genDigest = async () => {
    if (!figuresWhole) return;
    setDigestBusy(true); setDigest('');
    // The model is told the rate is unset rather than handed a number, because
    // a null arriving as 0 would come back as a paragraph about a coach who
    // earned nothing this month.
    const ctx = { sessionsDeliveredThisMonth: sessionsMo, revenueAtOwnRateUsd: revenue ?? 'unknown — no session rate set', clients, avgAdherence: avgAdh != null ? avgAdh + '%' : 'no check-ins yet', atRiskClients: atRisk.length, onTrack, watch, atRiskLow: riskCount };
    const reply = await askCoach([{ role: 'user', content: 'You are my fitness-coaching business assistant. Write a short Monday digest (3-4 sentences) from these numbers (revenueAtOwnRateUsd is sessions delivered multiplied by the coach own session rate, in US dollars): one line on revenue and clients, one on roster health (on-track vs at-risk), and one concrete action to grow or retain. Encouraging and specific.' }], ctx);
    setDigestBusy(false);
    setDigest(reply || 'Could not generate the digest right now — the AI backend may be unavailable.');
  };
  // `revenue` is already null unless the sessions read was whole, and that
  // matters more here than anywhere else on the screen: this hook WRITES. A
  // month's figure recorded off a truncated read is not wrong for a second, it
  // is saved as that month's history and shows in the trend chart forever,
  // indistinguishable from a month that really was that quiet. Nothing later
  // can tell the two apart — see the note on useMonthlyHistory.
  const revHist = useMonthlyHistory('repple.trainer.revHistory', revenue);
  // Only the targets that have both a number to aim at and a number reached so
  // far. A revenue goal with no session rate has the first and not the second,
  // and is spoken to separately below rather than drawn as a bar at zero.
  const goalRows = ([
    { label: 'Monthly revenue', cur: revenue, goal: goals.revenue, money: true },
    { label: 'Active clients', cur: clients, goal: goals.clients, money: false },
  ] as { label: string; cur: number | null; goal: number; money: boolean }[])
    .filter((g): g is typeof g & { cur: number } => g.goal > 0 && g.cur != null);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your coaching business</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Analytics</Text>
        </View>

        {/* Said once, at the top, because it is the reason every figure below
            is a dash. Without it the screen reads as a coaching business with
            nothing in it rather than as a screen that could not look. */}
        {figureStatus === 'error' ? (
          <Notice tone={t.warn} kicker="Analytics" title="These figures could not be worked out"
            note={rosterStatus === 'error' && sessionsStatus === 'error'
              ? 'Neither your roster nor your sessions came back, so nothing on this screen has been counted. Every dash below means unknown, not zero.'
              : rosterStatus === 'error'
                ? 'Your roster did not come back, so nothing counted over your clients has been worked out. Every dash below means unknown, not zero.'
                : 'Your sessions did not come back, so nothing counted over them has been worked out. Every dash below means unknown, not zero.'} />
        ) : figureStatus === 'partial' ? (
          <PartialRead what={rosterStatus === 'partial' ? 'clients on your book' : 'sessions in your calendar'} />
        ) : null}

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
          unit={sessionsMo == null ? undefined : 'this month'}
          note={sessionsMo == null
            ? (sessionsStatus === 'loading'
                ? 'Still reading your sessions.'
                : sessionsStatus === 'partial'
                  ? 'Your sessions came back short, so they cannot be counted — a subtotal printed here would be read as a month.'
                  : 'Your sessions could not be read, so this is not a count of zero.')
            : revenue != null && sessionFee != null
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
              Monthly revenue target ${goals.revenue.toLocaleString()} — progress needs {sessionsMo == null ? (sessionsStatus === 'loading' ? 'a session count that is still being read' : 'a session count that did not come back whole') : 'a session rate in your profile'}.
            </Text>
          ) : null}
          {/* Same withholding for the client target. A bar drawn at 0% tells a
              coach with a full book that nobody is on it. */}
          {goals.clients > 0 && clients == null ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              Client target {goals.clients} — your roster {rosterStatus === 'loading' ? 'is still being read' : 'did not come back whole'}, so there is no progress to draw against it.
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
                  {/* "N clients slipping" is a count of the whole book, and off
                      a short roster it is a count of whoever happened to load —
                      which reads as reassuringly small. Said as "at least" when
                      the set is not whole, because that is the only claim the
                      rows on this screen support. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                    {rosterWhole ? '' : 'At least '}{atRisk.length} client{atRisk.length > 1 ? 's' : ''} slipping — check in before they churn.
                    {atRiskRevenue == null
                      ? (sessionFee == null
                          ? ' Set a session rate in your profile to see what that is worth.'
                          : ' What that is worth cannot be worked out from a read this short.')
                      : ''}
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
          <SectionHead title="Roster health"
            note={!rosterWhole ? undefined : avgAdh == null ? 'no check-ins yet' : `${avgAdh}% avg adherence`}
            onPress={() => router.push('/(trainer)/leaderboard')} />
          {/* The bar is withheld rather than drawn from what loaded. A DistBar
              always fills its width, so a split computed over a short roster is
              rendered as the whole book at whatever proportions the fragment
              happened to have — the one chart on this screen that cannot show
              its own incompleteness. Three zeroes would be worse still: an
              empty bar under "Roster health" reads as a roster in trouble. */}
          {onTrack == null || watch == null || riskCount == null ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {rosterStatus === 'loading'
                ? 'Reading your roster…'
                : rosterStatus === 'partial'
                  ? 'Your roster came back short, so the split between on-track, watch and at-risk is not drawn — a share of part of your book is not a share of it.'
                  : 'Your roster could not be read, so the split between on-track, watch and at-risk is not drawn. It is unknown, not empty.'}
            </Text>
          ) : (<>
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
          </>)}
        </Section>

        <Rule />

        {/* ── revenue trend ──────────────────────────────────────────────── */}
        <Section>
          {/* With no figure for this month there is nothing to compare against
              last month, and "Tracking started" reads as though a point had
              just been recorded — nothing was, deliberately: an unsound figure
              written here would be indistinguishable from a real month forever
              after. */}
          <SectionHead title="Revenue trend"
            note={revenue == null ? 'This month not recorded'
              : revHist.delta !== 0 ? `${revHist.delta > 0 ? '+' : '−'}$${Math.abs(revHist.delta).toLocaleString()} vs last mo`
              : 'Tracking started'}
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
          {/* "Everyone is on track" is a claim about every client the coach
              has, and an unread roster is not a clean one. */}
          {atRisk.length === 0 && rosterWhole ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Everyone is on track.</Text>
          ) : atRisk.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {rosterStatus === 'loading'
                ? 'Reading your roster…'
                : 'Nobody at risk is listed, but your roster did not come back whole — this is not a clean bill of health for your book.'}
            </Text>
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
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              {figuresWhole
                ? 'An AI Monday summary of your coaching business.'
                : figureStatus === 'loading'
                  ? 'An AI Monday summary of your coaching business — it needs the figures above, which are still being read.'
                  : 'An AI Monday summary of your coaching business. It is written from the figures above, and those could not be worked out from this read — a digest composed from them would sound just as certain and be about nothing.'}
            </Text>
          )}
          {/* Withheld rather than run on nulls. The digest comes back as
              paragraphs of plain English with no dashes in it, so a coach has
              no way to tell a summary of their month from a summary of what
              happened to load. */}
          <Pressable onPress={genDigest} disabled={digestBusy || !figuresWhole}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp.sm,
                     backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: 12, opacity: digestBusy || !figuresWhole ? 0.4 : 1 }}>
            {digestBusy ? <ActivityIndicator color={t.brand} /> : <Icon name="sparkle" size={15} color={t.brand} />}
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>
              {digestBusy ? 'Writing…' : !figuresWhole ? 'Needs figures it could not read' : digest ? 'Regenerate' : 'Generate digest'}
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
