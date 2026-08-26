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
// Roster health is now read from the training record via src/lib/clientDrift.ts
// rather than counted with `atRiskClient()` — see the comment on the read below
// for what that boolean could not say, and why the distinction between
// "drifting" and "nothing recorded" has to survive all the way to the number
// the AI digest is handed.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Card, Cta, Ghost, Spark, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { useCoachProfile } from '../../src/ui/coachProfile';
import {
  assessDrift, fetchClientActivity, compareDrift, summariseDrift,
  DRIFT_LABEL, DEFAULT_WINDOWS, type Drift,
} from '../../src/lib/clientDrift';
import type { RosterClient } from '../../src/lib/trainerMock';
import { useRoster } from '../../src/ui/roster';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { DistBar } from '../../src/ui/charts';
import { askCoach } from '../../src/lib/coach';
import { useTrainerGoals, goalPct } from '../../src/ui/trainerGoals';
import { useMonthlyHistory } from '../../src/ui/useMrrHistory';
import { useSessions } from '../../src/ui/sessions';
import { monthToDateRevenue, deliveredByClients, unmarkedNote } from '../../src/lib/coachRevenue';

export default function TrainerAnalytics() {
  const t = useTheme();
  const router = useRouter();
  const { roster } = useRoster();
  const { tenant } = useTenant();
  const { sessionFee } = useCoachProfile();
  const { sessions } = useSessions();
  const clients = roster.length;

  // ── who needs a call ──────────────────────────────────────────────────────
  //
  // This screen counted at-risk clients with `atRiskClient()` from trainerMock:
  // a boolean over the roster row's adherence and its `lastActive` STRING. A
  // boolean cannot say "we do not know", so the client the record has never
  // seen a data point from was either counted as fine (the bug that function
  // carried until it gained its `noRecordOf` clause) or quietly folded in with
  // the clients who are measurably falling off their own pattern. Both are
  // wrong in the same way: they turn two different situations into one number,
  // and that number was fed to the AI at `genDigest` below as `atRiskClients`.
  //
  // The Clients screen already ranks the book on src/lib/clientDrift.ts. This
  // screen now counts with it, so the two agree, and — the point of the whole
  // exercise — "drifting" and "nothing recorded" stay two separate figures from
  // the read all the way to the digest prompt.
  //
  // THREE renders, never two, the same three the Clients screen keeps:
  //   drift === null && !driftErr → not read yet. Every derived count is null
  //                                 and prints through fig() as an em-dash.
  //   drift !== null              → read. An empty map is a real answer.
  //   driftErr !== null           → the read failed. Say so. A failed read must
  //                                 never render as "nobody is drifting".
  const [drift, setDrift] = useState<Record<string, Drift> | null>(null);
  const [driftErr, setDriftErr] = useState<string | null>(null);
  const rosterKey = roster.map((c) => c.id).join(',');
  useEffect(() => {
    const ids = rosterKey ? rosterKey.split(',') : [];
    let live = true;
    setDriftErr(null);
    if (!ids.length) { setDrift({}); return; }
    setDrift(null);
    (async () => {
      try {
        const events = await fetchClientActivity(supabase, ids, {
          days: DEFAULT_WINDOWS.historyDays,
          tenantId: tenant?.id ?? null,
        });
        if (!live) return;
        // `since` is the join date. Without it a client added on Tuesday and a
        // client silent for eight weeks are indistinguishable — both UNKNOWN,
        // both told nothing has been recorded for fifty-six days. Same reason
        // as the Clients screen; null where genuinely unknown, never guessed.
        const joinedOf: Record<string, string | null> = {};
        for (const c of roster) joinedOf[c.id] = c.joinedAt ?? null;
        const map: Record<string, Drift> = {};
        for (const id of ids) {
          map[id] = assessDrift({ clientId: id, events: events[id] ?? [], since: joinedOf[id] ?? null });
        }
        setDrift(map);
      } catch (e: any) {
        if (!live) return;
        reportError('analytics.clientDrift', e);
        setDrift(null);
        setDriftErr(e?.message || 'Could not read the training record.');
      }
    })();
    return () => { live = false; };
  }, [rosterKey, tenant?.id]);
  const driftFor = (c: RosterClient): Drift | null => (drift ? drift[c.id] ?? null : null);
  const bands = summariseDrift(drift ? roster.map((c) => drift[c.id]).filter((d): d is Drift => !!d) : null);
  // Null, not 0, until the read lands: "nobody is drifting" and "we have not
  // worked out who is drifting" are opposite claims, and only one of them is
  // something this screen is ever in a position to make.
  const drifting = bands ? bands.drifting : null;
  const unknown = bands ? bands.unknown : null;
  /** Drifting plus nothing-recorded — the clients a coach actually has to ring.
   *  Kept as one figure for the header and as two everywhere they are named. */
  const toContact = bands ? bands.drifting + bands.unknown : null;
  /** The clients behind those counts, worst first. Empty until the read lands;
   *  every render below branches on `bands`/`drift`, never on this being empty,
   *  so "not read yet" cannot come out looking like "nobody". */
  const contactRows: { c: RosterClient; d: Drift }[] = drift
    ? roster
        .map((c) => ({ c, d: driftFor(c) }))
        .filter((p): p is { c: RosterClient; d: Drift } =>
          !!p.d && (p.d.status === 'at_risk' || p.d.status === 'idle'))
        .sort((a, b) => compareDrift(a.d, b.d))
    : [];

  // Sessions actually delivered this calendar month: booked, and already
  // started. This used to be `clients * 4` - an assumption that every client
  // trains four times a month - multiplied by the rate the trainer typed into
  // their profile, and rendered as "Monthly revenue". A trainer with five
  // clients who trained nobody was shown "$1,500 · 20 sessions". The real
  // sessions were sitting in the same store the calendar screen already reads.
  //
  // …and it then counted a session as delivered because it was booked and its
  // clock had passed, which billed no-shows and cancellations at full rate.
  // Both definitions now live in src/lib/coachRevenue.ts and are shared with
  // the Clients screen, which had drifted onto a third one of its own.
  const month = monthToDateRevenue(sessions, sessionFee > 0 ? sessionFee : null);
  const sessionsMo = month.delivered;
  // Still arithmetic, but on a real count of delivered sessions and the
  // trainer's own rate, and the note on screen says exactly that. The $99
  // "platform fee" that used to be subtracted here is gone: nothing charges it,
  // and billing.tsx reports that billing is not switched on while this screen
  // called them a paying Pro customer.
  //
  // 0 when no rate is set, only because the goal bars and the stored monthly
  // history need a number; the note beside the hero is what says which of "no
  // rate set" and "nothing delivered" is true.
  const revenue = month.revenue ?? 0;
  const valuePerClient = clients ? Math.round(revenue / clients) : 0;
  // Average over clients who have actually checked in. Averaging a null-as-100
  // default meant a roster of strangers reported 100% adherence. Null rather
  // than 0 when nobody has checked in at all, for the same reason one step on:
  // "0% adherence" is a verdict, and an empty set does not support one.
  const _adhKnown = roster.map((c) => c.adherence).filter((a): a is number => a != null);
  const avgAdh = _adhKnown.length ? Math.round(_adhKnown.reduce((a, x) => a + x, 0) / _adhKnown.length) : null;
  // The three adherence buckets that used to draw the roster-health bar are
  // gone. They came off `check_ins.adherence`, so a client with no check-in
  // fell out of all three and simply vanished from the bar — a book of five
  // with two strangers drew as a bar of three, all of them fine. Drift bands
  // replace them: same bar, four segments, and the one for "nothing recorded"
  // is a segment rather than an omission. Two rules for "who needs attention"
  // on one screen is how the product ended up with two status scales.
  //
  // Sessions those clients actually took this month, at the trainer's rate -
  // not `at-risk count x rate x 4`, which invented a subscription nobody pays.
  // Null until the drift read lands, because "$0 at risk" is an all-clear.
  //
  // Both bands are in this figure, and a client in either can carry real money.
  // It would be wrong to say the nothing-recorded band contributes nothing: the
  // drift read counts a session only when its outcome is `completed`, so a
  // client whose sessions were delivered but never MARKED shows up with no
  // recorded activity at all — silent to drift, and billable here. That client
  // is the single most common inhabitant of the unknown band, and telling the
  // coach their fees were excluded would have been false as well as unhelpful.
  const atRiskRevenue = bands
    ? deliveredByClients(sessions, new Set(contactRows.map((p) => p.c.id)), sessionFee > 0 ? sessionFee : null)
    : null;
  const { goals, setGoals } = useTrainerGoals();
  const [goalOpen, setGoalOpen] = useState(false);
  const [gRev, setGRev] = useState('');
  const [gCli, setGCli] = useState('');
  const [digest, setDigest] = useState('');
  const [digestBusy, setDigestBusy] = useState(false);
  const genDigest = async () => {
    setDigestBusy(true); setDigest('');
    // Roster health reaches the model as exactly what the screen can support,
    // and never as a number this screen does not have. Before the read lands,
    // and after it fails, these say so in words: hand a model `drifting: 0` and
    // it will write "everyone is on track", which is the failure this whole
    // change is about, restated by a more confident narrator.
    const health = driftErr
      ? { rosterHealth: 'UNAVAILABLE — the training record could not be read. Do not say anything about who is drifting or on track.' }
      : !bands
      ? { rosterHealth: 'NOT READ YET — do not say anything about who is drifting or on track.' }
      : {
          drifting: bands.drifting,
          slipping: bands.watch,
          nothingRecorded: bands.unknown,
          holdingTheirPattern: bands.steady,
          clientsToContact: bands.drifting + bands.unknown,
          nothingRecordedMeans: `no check-in, logged workout, completed session or gym visit in ${DEFAULT_WINDOWS.historyDays} days — UNKNOWN, not fine, and worth a call`,
        };
    const ctx = { sessionsDeliveredThisMonth: sessionsMo, revenueAtOwnRateUsd: revenue, clients, avgAdherence: _adhKnown.length ? avgAdh + '%' : 'no check-ins yet', ...health };
    const reply = await askCoach([{ role: 'user', content: 'You are my fitness-coaching business assistant. Write a short Monday digest (3-4 sentences) from these numbers (revenueAtOwnRateUsd is sessions delivered multiplied by the coach own session rate, in US dollars): one line on revenue and clients, one on roster health, and one concrete action to grow or retain. On roster health: keep drifting clients and clients with nothing recorded separate — a client with nothing recorded is one you cannot judge, never one who is fine, and the action for them is to find out. If rosterHealth says the record was not read, say nothing at all about roster health. Encouraging and specific.' }], ctx);
    setDigestBusy(false);
    setDigest(reply || 'Could not generate the digest right now — the AI backend may be unavailable.');
  };
  const revHist = useMonthlyHistory('repple.trainer.revHistory', revenue);
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
          note={[
            sessionFee > 0
              ? `$${revenue.toLocaleString()} at your $${sessionFee} session rate — Repple does not process this, so it is your own arithmetic, not a payout.`
              : 'Set a session rate in your profile to see what that is worth.',
            unmarkedNote(month) || null,
          ].filter(Boolean).join(' ')}
          arc={goals.revenue > 0 ? goalPct(revenue, goals.revenue) : undefined}
          onPress={() => router.push('/(trainer)/payments')}
        />

        <Rule />

        {/* ── the shape of the business ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Roster" note="Leaderboard" onPress={() => router.push('/(trainer)/leaderboard')} />
          <KpiRow items={[
            { label: 'Clients', value: fig(clients) },
            // No unit on an em-dash: "— %" reads as a figure with a stray sign.
            { label: 'Avg adherence', value: fig(avgAdh), unit: avgAdh != null ? '%' : undefined },
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
          ].filter((g) => g.goal > 0).map((g) => {
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

        {/* ── revenue at risk: the one thing to act on ────────────────────── */}
        {toContact != null && toContact > 0 ? (<>
          <Rule />
          <Section>
            <Card tone={t.warn}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: sp.sm }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                <Text style={{ ...ty.micro, color: t.ink3 }}>Revenue at risk</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...value(26), color: t.ink }}>
                    {atRiskRevenue == null ? fig(null) : '~$' + atRiskRevenue.toLocaleString()}
                    <Text style={{ ...ty.caption, color: t.ink3 }}>/mo</Text>
                  </Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                    {[drifting ? `${drifting} drifting` : null,
                      unknown ? `${unknown} with nothing recorded` : null]
                      .filter(Boolean).join(' · ')} — check in before they go.
                  </Text>
                </View>
                <Cta label="Review" onPress={() => router.push('/(trainer)/dashboard')} />
              </View>
              {unknown ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                  A client can sit in “nothing recorded” simply because their sessions were never marked. Marking them is the quickest way to find out which of these {unknown === 1 ? 'is' : 'are'} a client leaving and which {unknown === 1 ? 'is' : 'are'} a gap in the paperwork.
                </Text>
              ) : null}
            </Card>
          </Section>
        </>) : null}

        <Rule />

        {/* ── roster health ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Roster health"
            note={avgAdh != null ? `${avgAdh}% avg adherence` : undefined}
            onPress={() => router.push('/(trainer)/leaderboard')} />

          {/* The read failed. Say so, and do not draw a bar underneath it —
              four empty segments is a picture of a healthy book. */}
          {driftErr && clients > 0 ? (
            <Notice tone={t.crit} kicker="Unavailable"
              title="Could not read who is drifting"
              note={driftErr + ' Nothing below is a claim about your clients — the training record could not be read at all.'} />
          ) : null}

          {/* Not read yet. The counts print as em-dashes rather than as zeros. */}
          {!drift && !driftErr && clients > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.md }}>
              <ActivityIndicator size="small" color={t.ink3} />
              <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                Reading check-ins, logs, sessions and visits…
              </Text>
            </View>
          ) : null}

          {/* Read. An empty map is a real answer, and UNKNOWN gets a segment of
              its own — a client with no record is counted here in their own
              band, never rolled into the steady end of the bar. */}
          {bands ? (
            <DistBar segments={[
              { label: DRIFT_LABEL.at_risk, value: bands.drifting, color: t.crit },
              { label: DRIFT_LABEL.watch, value: bands.watch, color: t.warn },
              { label: DRIFT_LABEL.idle, value: bands.unknown, color: t.s5 },
              { label: DRIFT_LABEL.on_track, value: bands.steady, color: t.brand },
            ]} />
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.lg, marginTop: sp.md }}>
            {([[DRIFT_LABEL.at_risk, drifting, t.crit],
               [DRIFT_LABEL.watch, bands ? bands.watch : null, t.warn],
               [DRIFT_LABEL.idle, unknown, t.s5],
               [DRIFT_LABEL.on_track, bands ? bands.steady : null, t.brand]] as const).map(([l, v, col]) => (
              <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: col }} />
                <Text style={{ ...ty.caption, color: t.ink2 }}>{l} {fig(v)}</Text>
              </View>
            ))}
          </View>
          {bands && bands.unknown > 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              “{DRIFT_LABEL.idle}” is {bands.unknown === 1 ? 'a client' : bands.unknown + ' clients'} with no check-in, logged workout, completed session or gym visit in {DEFAULT_WINDOWS.historyDays} days. Not a verdict that they are fine — there is nothing here to judge them on.
            </Text>
          ) : null}
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

        {/* ── clients to contact ─────────────────────────────────────────── */}
        {/* Both bands, in one list, each row saying which it is and why. The
            row's second line is the drift verdict's own `reason`, which is
            written about the RECORD rather than about the person — "nothing
            recorded in 41 days" rather than "inactive". */}
        <Section>
          <SectionHead title="Clients to contact"
            note={`Drifting from their own pattern, or nothing recorded in ${DEFAULT_WINDOWS.historyDays} days`} />
          {driftErr ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              The training record could not be read, so this list is unavailable — which is not the same as empty. {driftErr}
            </Text>
          ) : !drift ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Working out who needs a call…</Text>
          ) : contactRows.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {clients === 0 ? 'No clients yet.' : 'Everyone is holding their own pattern.'}
            </Text>
          ) : contactRows.map(({ c, d }, i) => (
            <View key={c.id} style={{
              flexDirection: 'row', alignItems: 'center', paddingVertical: sp.md,
              borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              {/* UNKNOWN takes its own colour, not a dimmed at-risk: it is a
                  different kind of thing, and it should be visible as one
                  without reading the label. */}
              <View style={{ width: 6, height: 6, borderRadius: 3, marginRight: sp.md, backgroundColor: d.status === 'at_risk' ? t.crit : t.s5 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{c.name}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  {DRIFT_LABEL[d.status]} · {d.reason}
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
            {/* The one place a "4 sessions a month" figure survives on this
                screen. It is a projection about a client who does not exist
                yet, so there is nothing to measure — but the assumption is
                stated rather than folded silently into a dollar amount. */}
            A new client training four times a month at ${sessionFee}/session would add ${(sessionFee * 4).toLocaleString()}/mo.
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
