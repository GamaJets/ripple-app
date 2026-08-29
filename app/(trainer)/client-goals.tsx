// Coach · Working toward. What one client is aiming at, and how it is going.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// Clients have been able to set four kinds of goal since supabase/parts/59 —
// a target weight, body fat, muscle, or something the app cannot measure at
// all — and the whole point of moving them off the phone and into
// `goal_targets` was that somebody else could see them. The console got a
// "Working toward" column on the roster; the coach app got nothing. So the one
// thing a coach most needs to know about a client, the thing that decides what
// their programme should even be for, was visible on a laptop and invisible on
// the phone they actually coach from.
//
// ── It reads and it does not write ─────────────────────────────────────────
//
// `goal_targets_coach_read` grants SELECT and nothing else, deliberately: a
// goal is the client's own statement of what they want, and a coach silently
// editing it would make the screen the client is looking at stop being theirs.
// There is no Done button here and no edit field, and that is not an omission
// to be filled in later. A coach who disagrees with a target has the messaging
// thread — which is the same reason `checklists.tsx` cannot tick a habit.
//
// ── Three empty screens that mean three different things ───────────────────
//
// The console named them and this screen keeps the vocabulary: a read that
// failed is "— unreadable", a client who has set nothing is "— none set", and
// a client who has got there is "— all reached". Collapsing any two of them
// tells a coach something false about a person they are about to ring.
//
// The same distinction runs one level down, into the readings. A client can
// have a target weight and no weigh-ins, which is worth knowing — it is the
// coach's cue to get them on the scales — and it is a different sentence from
// "their scans could not be read just now". Neither is ever a 0%.
//
// The arithmetic is entirely src/lib/goalTargets.ts and the wire-reading is
// src/lib/clientGoals.ts, both pure and both tested. Nothing on this screen
// works out a percentage or a finish date of its own.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, Ghost, Notice, Flag, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useSettings } from '../../src/ui/settings';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { isWhole, worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
import {
  progressOf, projectionOf, goalLabel, isMeasured, isOverdue,
  GOAL_METRIC, MIN_TREND_DAYS,
  type GoalTarget, type MeasuredKind, type Point,
} from '../../src/lib/goalTargets';
import {
  readGoals, seriesFrom, seriesFor, goalBoard, goalUnit, goalValue, goalDelta,
  type ClientSeries, type GoalRow, type ScanRow, type WeighInRow,
} from '../../src/lib/clientGoals';
import { kgToLb, type WeightUnit } from '../../src/lib/units';

const GOAL_COLS = 'id, kind, target_value, title, target_date, achieved_at, created_at';
const SCAN_COLS = 'taken_at, weight_kg, body_fat_pct, skeletal_muscle_kg';
const CHECKIN_COLS = 'at, weight_kg';

const EMPTY_SERIES: ClientSeries = { weight: [], bodyfat: [], muscle: [] };

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** The client's trend in a sentence, addressed to their coach, or null when
 *  there is no honest one to write. Every branch here is a named member of
 *  `Projection`; none of them is inferred on this screen. */
function projectionLine(goal: GoalTarget, series: Point[], wu: WeightUnit, who: string): string | null {
  const p = projectionOf(goal, series, Date.now());
  if (!p) return null;
  const kind = goal.kind as MeasuredKind;
  const unit = goalUnit(kind, wu);
  // A weekly rate is a change per week, so it converts as a span — but it keeps
  // two decimals rather than going through `goalDelta`, which rounds to the
  // whole pound a single reading can support. At half a kilogram a week the
  // honest figure is 1.10 lb/wk, and whole pounds would make every pace between
  // 0.7 and 1.5 look identical.
  const rate = (v: number) => (unit === 'lb' ? kgToLb(v) : v);
  switch (p.kind) {
    case 'reached':
      return `${who} has reached this one. It is theirs to mark done — worth a message.`;
    case 'tooshort':
      return `Only ${p.days === 1 ? 'a day' : `${p.days} days`} between their readings so far. A finish date needs about ${MIN_TREND_DAYS} days of them; a shorter gap is noise, not a trend.`;
    case 'flat':
      return 'Their readings have not moved since they set this, so there is no pace to project from.';
    case 'wrongway':
      return `Their trend since setting this (${p.weeklyRate > 0 ? '+' : ''}${rate(p.weeklyRate).toFixed(2)} ${unit}/wk) is heading away from the target.`;
    case 'eta': {
      const eta = new Date(p.etaMs);
      return `At their current pace (${p.weeklyRate > 0 ? '+' : ''}${rate(p.weeklyRate).toFixed(2)} ${unit}/wk) they get there around ${eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.`;
    }
  }
}

export default function ClientGoals() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  // Arrives from the client sheet on the dashboard, so a coach who is already
  // looking at somebody lands on that person rather than on a picker.
  const { clientId } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  // The coach's own unit, not the client's. The target is stored in kilograms
  // whichever unit it was typed in (TF-37), so this only changes what is
  // printed — but printing a kilogram figure to a coach who reads pounds is a
  // wrong number, not a stylistic one.
  const wu = useSettings().weightUnit;

  const [picked, setPicked] = useState<string | null>(clientId ?? null);

  // Null is "we do not know", never "there are none". Each read carries its own
  // status because they fail independently: a refused check_ins read must not
  // empty the body-fat series, which comes from scans and is unaffected by it.
  const [goals, setGoals] = useState<GoalTarget[] | null>(null);
  const [unreadableGoals, setUnreadableGoals] = useState(0);
  const [goalStatus, setGoalStatus] = useState<LoadStatus>('ready');
  const [series, setSeries] = useState<ClientSeries>(EMPTY_SERIES);
  const [scanStatus, setScanStatus] = useState<LoadStatus>('ready');
  const [weighStatus, setWeighStatus] = useState<LoadStatus>('ready');

  // The client whose reads are allowed to reach the screen. Tapping through a
  // book of clients starts a read per tap and they do not come back in order,
  // so without this a slow answer for the person tapped first can land under
  // the name of the person tapped second — one client's goals attributed to
  // another, which is worse than showing nothing at all.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string) => {
    wanted.current = id;
    setGoalStatus('loading'); setScanStatus('loading'); setWeighStatus('loading');
    setGoals(null); setUnreadableGoals(0); setSeries(EMPTY_SERIES);

    // RLS already limits all three of these to clients this coach actually
    // coaches (goal_targets_coach_read, scans_trainer_read,
    // checkins_trainer_read), so the filter below is about which client is on
    // screen rather than about who may be seen.
    const [goalRes, scanRes, ciRes] = await Promise.all([
      supabase.from('goal_targets').select(GOAL_COLS)
        .eq('client_id', id).order('created_at', { ascending: false }).limit(capLimit()),
      supabase.from('scans').select(SCAN_COLS)
        .eq('client_id', id).order('taken_at', { ascending: true }).limit(capLimit()),
      supabase.from('check_ins').select(CHECKIN_COLS)
        .eq('user_id', id).order('at', { ascending: true }).limit(capLimit()),
    ]);
    if (wanted.current !== id) return;

    if (goalRes.error) {
      reportError('clientGoals.goals', goalRes.error);
      setGoalStatus('error');
    } else {
      const page = capped((goalRes.data ?? []) as unknown as GoalRow[]);
      const read = readGoals(page.rows);
      setGoals(read.goals);
      setUnreadableGoals(read.skipped);
      setGoalStatus(page.truncated ? 'partial' : 'ready');
    }

    // Both reads feed `seriesFrom`, and a failure in one leaves the other's
    // rows exactly as good as they were: a coach whose check_ins read is
    // refused should still see body fat, which comes from scans and knows
    // nothing about check-ins. The statuses are what stops the remainder being
    // read as the whole of somebody's record.
    let scans: ScanRow[] = [];
    if (scanRes.error) {
      reportError('clientGoals.scans', scanRes.error);
      setScanStatus('error');
    } else {
      const page = capped((scanRes.data ?? []) as unknown as ScanRow[]);
      scans = page.rows;
      setScanStatus(page.truncated ? 'partial' : 'ready');
    }

    let weighIns: WeighInRow[] = [];
    if (ciRes.error) {
      reportError('clientGoals.checkIns', ciRes.error);
      setWeighStatus('error');
    } else {
      const page = capped((ciRes.data ?? []) as unknown as WeighInRow[]);
      weighIns = page.rows;
      setWeighStatus(page.truncated ? 'partial' : 'ready');
    }

    setSeries(seriesFrom(scans, weighIns));
  }, []);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    if (!picked) {
      // Deselecting has to disown the read in flight too, or it lands on a
      // screen that is no longer showing anybody.
      wanted.current = null;
      setGoals(null); setUnreadableGoals(0); setSeries(EMPTY_SERIES);
      setGoalStatus('ready'); setScanStatus('ready'); setWeighStatus('ready');
      return;
    }
    void load(picked);
  }, [picked, load]);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  const who = client?.name.split(' ')[0] ?? 'They';

  // 'error' hands `goalBoard` a null, which is the only way it can answer
  // 'unreadable'. Under any other status the list is the server's own answer.
  const board = useMemo(
    () => goalBoard(goalStatus === 'error' ? null : goals),
    [goalStatus, goals],
  );

  /**
   * Whether the readings a goal of this kind is measured against are the whole
   * of what the client has. Weight is held against scans AND weigh-ins, so it
   * is only as trustworthy as the worse of the two; body fat and muscle come
   * from scans alone and a refused check_ins read says nothing about them.
   */
  const readingStatus = useCallback((kind: MeasuredKind): LoadStatus =>
    kind === 'weight' ? worstStatus(scanStatus, weighStatus) : scanStatus,
  [scanStatus, weighStatus]);

  /** What can honestly be said about how far along one measured goal is. */
  const measuredLine = (g: GoalTarget & { kind: MeasuredKind }): string => {
    const st = readingStatus(g.kind);
    const source = GOAL_METRIC[g.kind].source;
    if (st === 'loading') return `Reading their ${source}…`;
    if (st === 'error') {
      return `Their ${source} could not be read, so there is nothing to hold this against right now. That is our connection, not their record.`;
    }
    if (st === 'partial') {
      return `Only part of their ${source} came back, and a percentage worked out from an unknown fraction of them would be a wrong number rather than a rough one.`;
    }
    const prog = progressOf(g, seriesFor(series, g.kind));
    if (!prog) {
      return `No ${source} on record yet, so there is nothing to measure this against. ${who} set the target; nobody has taken the reading.`;
    }
    const unit = goalUnit(g.kind, wu);
    const left = Math.abs(goalDelta(prog.remaining, g.kind, wu));
    return prog.reached
      ? `Reached — ${fig(goalValue(prog.current, g.kind, wu))} ${unit} against a target of ${fig(goalValue(prog.target, g.kind, wu))}.`
      : `${prog.pct}% of the way · ${fig(left)} ${unit} to go · now ${fig(goalValue(prog.current, g.kind, wu))} ${unit}`;
  };

  /** The goal to lead with: the nearest-due open one that actually has whole
   *  readings behind it. A goal nothing can be said about makes a poor hero. */
  const lead = useMemo(() => {
    if (board.state !== 'working') return null;
    for (const g of board.open) {
      if (!isMeasured(g)) continue;
      const kind = g.kind as MeasuredKind;
      if (!isWhole(readingStatus(kind))) continue;
      const prog = progressOf(g, seriesFor(series, kind));
      if (prog) return { goal: g, kind, prog };
    }
    return null;
  }, [board, series, readingStatus]);

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  const goalCard = (g: GoalTarget, i: number) => {
    const measured = isMeasured(g);
    const kind = measured ? (g.kind as MeasuredKind) : null;
    const unit = kind ? goalUnit(kind, wu) : '';
    const overdue = isOverdue(g, Date.now());
    const proj = kind && isWhole(readingStatus(kind))
      ? projectionLine(g, seriesFor(series, kind), wu, who)
      : null;
    return (
      <View key={g.id} style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        <Text style={{ ...ty.body, color: g.achievedAtISO ? t.ink3 : t.ink, fontWeight: '600' }}>
          {goalLabel(g)}
          {kind && g.targetValue != null ? ` · ${fig(goalValue(g.targetValue, kind, wu))} ${unit}` : ''}
        </Text>
        <Text style={{ ...ty.micro, color: overdue ? t.warn : t.ink3, marginTop: sp.xs }}>
          {g.achievedAtISO
            ? `Marked done ${shortDate(g.achievedAtISO)}`
            : g.targetDateISO
              ? (overdue ? `Target date passed (${shortDate(g.targetDateISO)})` : `By ${shortDate(g.targetDateISO)}`)
              : 'No target date'}
        </Text>
        {/* A goal with no number by construction gets the client's own words
            and no percentage. "Squat without my knee complaining" is 40% of
            nothing, and only they can say when it is done. */}
        <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
          {measured
            ? measuredLine(g as GoalTarget & { kind: MeasuredKind })
            : `In their words, and nothing measures it. Only ${who} can say when this one is done.`}
        </Text>
        {proj ? <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs }}>{proj}</Text> : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>Working toward</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          What each client is aiming at, in their own words and numbers, and how far along they are.
          You can read these; you can&rsquo;t change them — a goal is theirs to set and theirs to
          call done.
        </Text>

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="Goals live on the server and belong to the client, so there is no local copy of somebody else's to fall back on. Nothing below is a claim that they have not set any." />
          </Section>
        ) : (
          <>
            {r.status === 'error' ? (
              <Section>
                <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
                  note="This is not an empty book. Nobody is listed below because the list did not come back — pull back and open this again once you are connected." />
              </Section>
            ) : null}

            <Section>
              <SectionHead title="Client" />
              {r.roster.length === 0 && r.status !== 'error' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  Nobody is on your book yet, so there are no goals to look at.
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {r.roster.map((c) => (
                    <Pressable key={c.id} onPress={() => setPicked(c.id === picked ? null : c.id)}
                      accessibilityRole="button" accessibilityState={{ selected: picked === c.id }}
                      accessibilityLabel={c.name} style={chip(picked === c.id)}>
                      <Text style={{ ...ty.micro, color: picked === c.id ? t.brandInk : t.ink2 }}>{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Section>

            {picked ? (
              <View>
                <Rule />

                {/* The three states, kept apart. Each is a different fact about
                    this person and each starts a different conversation. */}
                {goalStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their goals…</Text></Section>
                ) : board.state === 'unreadable' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their goals could not be read"
                      note={`Nothing is shown below because nothing came back. It does not mean ${who} has set none — that is a different screen and a different conversation.`} />
                  </Section>
                ) : board.state === 'none' ? (
                  <Section>
                    <SectionHead title={client?.name ?? 'Their goals'} note="none set" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      {who} hasn&rsquo;t set a goal yet. The read came back and it was empty, so this
                      is about them rather than about the connection — which makes it worth raising.
                    </Text>
                  </Section>
                ) : board.state === 'reached' ? (
                  <Section>
                    <SectionHead title={client?.name ?? 'Their goals'} note="all reached" />
                    <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.md }}>
                      Everything {who} set has been reached and marked done. Nothing is outstanding —
                      which is not the same as nothing being set, and is usually the moment to agree
                      the next one.
                    </Text>
                    {board.achieved.map(goalCard)}
                  </Section>
                ) : (
                  <>
                    {lead ? (
                      <View>
                        <Hero
                          label={`${who} · ${goalLabel(lead.goal)}`}
                          figure={fig(goalValue(lead.prog.current, lead.kind, wu))}
                          unit={goalUnit(lead.kind, wu)}
                          arc={lead.prog.pct / 100}
                          note={`${lead.prog.pct}% of the way · ${fig(Math.abs(goalDelta(lead.prog.remaining, lead.kind, wu)))} ${goalUnit(lead.kind, wu)} to go`}
                        />
                        <Rule />
                      </View>
                    ) : null}

                    <Section>
                      <SectionHead title={client?.name ?? 'Their goals'} note={`${board.open.length} open`} />
                      {board.open.map(goalCard)}
                    </Section>

                    {board.achieved.length ? (
                      <>
                        <Rule />
                        <Section>
                          <SectionHead title="Reached" note={`${board.achieved.length}`} />
                          {board.achieved.map(goalCard)}
                        </Section>
                      </>
                    ) : null}
                  </>
                )}

                {/* Two things the lists above cannot say for themselves. */}
                {goalStatus === 'partial' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      Their goals came back at the row limit, so this is some of them rather than all
                      of them. The newest are here; older ones may not be.
                    </Flag>
                  </Section>
                ) : null}
                {unreadableGoals > 0 ? (
                  <Section>
                    <Flag tone={t.warn}>
                      {unreadableGoals === 1
                        ? 'One more goal is on record in a shape this version of the app cannot show, so it is not in the list above.'
                        : `${unreadableGoals} more goals are on record in a shape this version of the app cannot show, so they are not in the list above.`}
                    </Flag>
                  </Section>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
