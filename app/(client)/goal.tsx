// Client · Goals. Set what you are working toward — a target weight, body fat,
// muscle, or something the app cannot measure at all — and see how far along
// each one is. Profile hub.
//
// Two honesty rules run through this screen, both of them bugs it has had:
//
//  · Nothing is drawn from readings that do not exist. The provider used to
//    hand every account a 64 kg target nobody had chosen, and this screen drew
//    a filled progress bar and a projected finish date from it. A goal with no
//    readings behind it now says so, in words.
//  · A goal with no number never gets a percentage. "Squat without my knee
//    complaining" has no series, so it has no ring and no projection — it has
//    a Done button, which is the only honest signal available.
//
// A third rule arrived with TF-37: a target is read and typed in the unit the
// client reads in, and stored in the kilograms `goalTargets` and every series
// behind it are expressed in. Weight and muscle convert. Body fat does NOT —
// it is a proportion of the body, and a proportion is the same number whatever
// the scale is calibrated in. That distinction is made once, in `goalUnit` and
// `weightKind` below, rather than at each of the eight places a unit is printed.
//
// The arithmetic is in src/lib/goalTargets.ts, where it is tested.
import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
// The help row's words, opened from the head's info control instead of drawn
// as a row: round five takes explanation off the page. See the note in
// app/(client)/nutrition.tsx for why this is not the kit's <ScreenHelp>.
import { SCREEN_HELP } from '../../src/lib/screenHelp';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, PageHead, Cta, Ghost, Notice, fig, Ring, Spark, Meter, TonedChip } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value, font, fontScale } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { isWhole } from '../../src/ui/loadStatus';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightToKg, weightDeltaIn, kgToLb, readNumber, type WeightUnit } from '../../src/lib/units';
import { deltaMoved, deltaSign } from '../../src/lib/deltaLabel';
import { useGoalTracker, type GoalSaved } from '../../src/ui/goalTracker';
import { fmtFullDay, num2 } from '../../src/lib/format';
// The chip's span turned into a day on the MEMBER'S calendar. See the header of
// that file for the two whole-day errors the expression this replaced carried.
import { targetDayIn } from '../../src/lib/goalDeadline';
import { useNow } from '../../src/ui/today';
// Whether a row is still on this phone. The queue was built for goals set with
// no signal and this screen was never told about it: the waiting row was drawn
// exactly like a stored one, could not be removed or ticked off, and both
// refusals blamed the member's connection.
import { isPending } from '../../src/lib/wellnessSync';
import { useReachability } from '../../src/ui/reachability';
import { retryLine } from '../../src/lib/reachability';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import {
  progressOf, projectionOf, startPoint, goalLabel, isMeasured, isOverdue, sortGoals,
  GOAL_METRIC, MEASURED_KINDS, MIN_TREND_DAYS,
  type GoalKind, type GoalProgress, type GoalTarget, type MeasuredKind, type Point,
} from '../../src/lib/goalTargets';

const KIND_TAB: { kind: GoalKind; label: string }[] = [
  ...MEASURED_KINDS.map((k) => ({ kind: k as GoalKind, label: k === 'weight' ? 'Weight' : k === 'bodyfat' ? 'Body Fat' : 'Muscle' })),
  { kind: 'custom', label: 'Something Else' },
];

const DATE_CHIPS: [string, number | null][] = [['4 wks', 28], ['8 wks', 56], ['12 wks', 84], ['No Date', null]];

// `appLocale()`, not `undefined` — the resolver in src/lib/locale.ts is what
// every date in this app is written through, and `undefined` asks the device
// instead, which is a different answer on a phone whose region and language
// disagree. The year is back too: "12 Mar" on a goal set for next March is a
// date somebody reads as this year.
const shortDate = (iso: string) => fmtFullDay(iso);

/** True for the two goal kinds whose numbers are kilograms on the record. */
const weightKind = (k: MeasuredKind) => k !== 'bodyfat';

/** The unit a goal of this kind is read in — the client's for the two weights,
 *  and the metric table's own '%' for body fat, which never converts. */
const goalUnit = (k: MeasuredKind, wu: WeightUnit) =>
  weightKind(k) ? wu : GOAL_METRIC[k].unit;

/** A stored goal figure — a target, a current reading — in the read unit. */
const goalValue = (v: number, k: MeasuredKind, wu: WeightUnit) =>
  weightKind(k) ? weightIn(v, wu) : v;

/**
 * A goal DIFFERENCE — how much is left to go, how fast it is moving — in the
 * read unit. The whole span is converted and rounded once at the end; rounding
 * each end into pounds first would let "2 lb to go" flicker to "3 lb" on a
 * reading that had not really changed. Metric is passed through untouched so
 * that a client reading kilograms sees exactly what they saw before.
 */
// Body fat is a percentage in every unit system, so only the weight-shaped
// kinds are converted; the rest pass straight through.
const goalDelta = (v: number, k: MeasuredKind, wu: WeightUnit) =>
  (weightKind(k) ? weightDeltaIn(v, wu) : v) ?? v;

/** The client's trend, in a sentence, or null when there is no honest one. */
function projectionLine(goal: GoalTarget, series: Point[], wu: WeightUnit): string | null {
  const p = projectionOf(goal, series, Date.now());
  if (!p) return null;
  const measured = goal.kind === 'custom' ? null : (goal.kind as MeasuredKind);
  const unit = measured == null ? '' : goalUnit(measured, wu);
  // A weekly rate is a change per week, so it converts as a span. It keeps two
  // decimals rather than dropping to whole pounds like a reading does: at half
  // a kilogram a week the honest figure is 1.10 lb/wk, and "1 lb/wk" would make
  // every pace between 0.7 and 1.5 look identical.
  const rate = (v: number) => (measured != null && weightKind(measured) && wu === 'lb' ? kgToLb(v) : v);
  // A pace is only quoted where it survives being printed. `weeklyRate === 0`
  // is caught upstream as 'flat', but a rate of 0.004 kg/wk is not zero and
  // formatted "+0.00 kg/wk" — a plus sign on a pace of nothing, offered as the
  // basis of a finish date. Where the rate rounds away the sentence drops the
  // parenthetical rather than quoting a figure it has just contradicted.
  const pace = (v: number) => {
    const r = rate(v);
    return deltaMoved(r, 2) ? ` (${deltaSign(r, 2)}${num2(Math.abs(r))} ${unit}/wk)` : '';
  };
  switch (p.kind) {
    case 'reached':
      return 'You’ve reached this one — mark it done, or set a new target.';
    case 'tooshort':
      return `Only ${p.days === 1 ? 'a day' : `${p.days} days`} between your readings so far. A finish date needs about ${MIN_TREND_DAYS} days of them — a shorter gap is noise, not a trend.`;
    case 'flat':
      return 'Your readings haven’t moved since you set this, so there’s no pace to project from.';
    case 'wrongway':
      return `Your recent trend${pace(p.weeklyRate)} is heading away from this target. Keep going, or adjust the goal.`;
    case 'eta': {
      const eta = new Date(p.etaMs);
      return `At your current pace${pace(p.weeklyRate)} you’ll get there around ${eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.`;
    }
  }
}

export default function Goal() {
  const t = useTheme();
  const c = useClientData();
  const g = useGoalTracker();
  // The targets, and the measurements they are measured against.
  const pull = usePullToRefresh(useCallback(() => { g.reload(); c.reload(); }, [g.reload, c.reload]));
  // The unit this client reads weight in. Targets are stored in kilograms, the
  // same as every series they are measured against, so this only ever touches
  // what is printed and what comes back out of the entry field (TF-37).
  const wu = useSettings().weightUnit;
  const reach = useReachability();

  const [kind, setKind] = useState<GoalKind>('weight');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [days, setDays] = useState<number | null>(84);
  /**
   * The clock the chips are read against, and the one the save writes with.
   *
   * ONE instant for both, deliberately. The chip says "12 wks" and the line
   * under it now says which day that is, and those two must be the same day the
   * row ends up carrying — a preview computed from one clock and a write from
   * another can disagree across midnight, and the member would be shown a date
   * and given a different one.
   *
   * `useNow` (src/ui/today.ts) rather than a bare `Date.now()`: this screen is
   * registered `href: null` in app/(client)/_layout.tsx, so it is mounted once
   * and never torn down, and the preview would otherwise still be offering
   * yesterday's answer a week later. It re-reads at the next local midnight, on
   * every foreground and whenever the screen is focused.
   */
  const nowMs = useNow().getTime();
  /** Which day the chosen chip lands on, or null for "No date". */
  const targetDay = targetDayIn(days, nowMs);
  const [saving, setSaving] = useState(false);

  const seriesFor = (k: MeasuredKind): Point[] =>
    k === 'weight' ? c.weightSeries : k === 'bodyfat' ? c.bodyFatSeries : c.muscleSeries;

  // The goals and the READINGS they are measured against are two different
  // reads against two different policies, and this screen only ever consulted
  // the first. `goal_targets` succeeding says nothing about `scans`: when the
  // scans read fails, every series above is `[]`, `progressOf` returns null for
  // every measured goal, the hero silently disappears and each row says "no
  // weigh-ins and scans on record yet" — to a member with a year of them.
  //
  // `c.status` is the worst of the profile and scans reads, which is the right
  // one to ask: the manual weight lives on the profile and the scans on their
  // own table, and either failing leaves a hole where a reading should be.
  const readingsWhole = isWhole(c.status);
  /**
   * How far along one measured goal is, or null when the record cannot say.
   *
   * Gated on the READINGS read, not only on whether `progressOf` could produce
   * a number, and that gate is the fix rather than a precaution.
   *
   * `progressOf` measures from a baseline — the reading taken at or before the
   * goal was set — and the scans read is newest-first with a cap
   * (src/ui/clientData.tsx orders `taken_at` descending before `capped()`), so
   * under 'partial' the OLDEST readings are the ones missing. That is exactly
   * the end the baseline comes from: `startPoint` finds nothing at or before
   * the goal and falls back to the earliest reading that survived, which is one
   * taken AFTER the target was set. The percentage that comes out is not a
   * rougher figure, it is a different one, and it is printed as "68% of the way"
   * with an arc drawn round it.
   *
   * The screen already knew this — `noReadingLine` has carried the sentence for
   * 'partial' since it was written ("how far along this is cannot be worked out
   * from what came back") — and could never reach it, because the sentence was
   * only ever offered where `progressOf` returned null, and a truncated read is
   * by definition one with more than a thousand readings in it. The condition
   * was on the wrong thing.
   *
   * app/(trainer)/client-goals.tsx already refuses on exactly this status, in
   * as many words: "a percentage worked out from an unknown fraction of them
   * would be a wrong number rather than a rough one". A member and their coach
   * looking at the same goal must not read two different numbers off it — the
   * whole reason the shaping rules live in src/lib/clientGoals.ts.
   */
  const progressFor = (x: GoalTarget): GoalProgress | null =>
    readingsWhole && isMeasured(x) ? progressOf(x, seriesFor(x.kind as MeasuredKind)) : null;
  /** Why a measured goal has no progress, in the reader's terms. */
  const noReadingLine = (k: MeasuredKind) =>
    readingsWhole
      ? `No ${GOAL_METRIC[k].source} on record yet, so there’s nothing to measure this against.`
      : c.status === 'loading'
        ? `Reading your ${GOAL_METRIC[k].source}…`
        : c.status === 'partial'
          ? `More ${GOAL_METRIC[k].source} on record than can be read in one go, so progress is unknown.`
          : `Your ${GOAL_METRIC[k].source} could not be read, so progress is unknown — not a statement that you have none.`;

  const goals = sortGoals(g.goals);
  const open = goals.filter((x) => !x.achievedAtISO);
  // The one to put at the top: the nearest-due open goal that actually has
  // readings behind it. A goal we cannot measure makes a poor hero.
  const lead = open.find((x) => progressFor(x) !== null);
  // Whether there was anything for the hero to have been about. Without this,
  // a member whose only goals are unmeasurable ("squat without my knee
  // complaining") would be shown a banner about readings that could not be read
  // for a goal no reading was ever going to measure.
  const measuredOpen = open.some((x) => isMeasured(x));
  const leadProgress = lead ? progressFor(lead) : null;
  // The readings the hero's chart draws: from the goal's baseline forward, in
  // the read unit. The SAME window `projectionOf` takes its rate over — first
  // to last reading since the goal was set — so the line on the card and the
  // finish date under it are one piece of arithmetic seen twice. Only real
  // readings: the projection stays a sentence, because a dotted line into
  // next month is a series nobody measured.
  const leadSeries = (() => {
    if (!lead || !isMeasured(lead)) return [];
    const all = seriesFor(lead.kind);
    const from = startPoint(all, lead.createdAtISO);
    if (!from) return [];
    return [...all].sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
      .filter((p) => Date.parse(p.t) >= Date.parse(from.t))
      .map((p) => ({ t: p.t, v: goalValue(p.v, lead.kind, wu) }));
  })();

  const save = async () => {
    if (saving) return;
    // `targetDayIn`, not `new Date(Date.now() + days * 86400000).toISOString()`.
    // That expression named UTC's calendar day, and src/ui/goalTracker.tsx
    // writes `.slice(0, 10)` of whatever it gets into a bare Postgres `date` —
    // so "4 wks" tapped in the evening in Los Angeles was stored 29 days out and
    // the same tap in the morning in Auckland 27. It also added `days` lots of
    // twenty-four hours, which is a day short across a clocks change. Both are
    // argued and asserted in src/lib/goalDeadline.ts. Computed at the moment of
    // the tap rather than held in a memo, so a screen left open across midnight
    // counts from the day the member is actually in when they press Save.
    //
    // The same `targetDay` the line under the chips is showing, not a second
    // call: what the member was shown before they tapped Save is what gets
    // written down.
    const targetDateISO = targetDay;
    setSaving(true);
    let ok: GoalSaved = false;
    if (kind === 'custom') {
      if (!title.trim()) { setSaving(false); Alert.alert('Say What the Goal Is', 'Type what you’re working toward.'); return; }
      ok = await g.addCustomGoal(title, targetDateISO);
    } else {
      const mk = kind as MeasuredKind;
      // `readNumber` and not `parseFloat`: this box is a decimal pad, and a
      // decimal comma is what it offers on a European keyboard. A body-fat
      // target of 16,2 stored as 16 is a target the client did not set.
      const n = readNumber(amount);
      if (n == null || n <= 0) {
        setSaving(false);
        Alert.alert('Enter a Number', `Type your ${GOAL_METRIC[mk].label.toLowerCase()} in ${goalUnit(mk, wu)}.`);
        return;
      }
      // The stored target has to be in the same unit as the series it will be
      // compared against, and those are kilograms. A client reading pounds who
      // typed 165 was otherwise setting themselves a 165 kg target and being
      // shown as a very long way from it. Body fat is a percentage and goes in
      // exactly as typed.
      const stored = weightKind(mk) ? weightToKg(amount, wu) : n;
      if (stored == null) { setSaving(false); return; }
      ok = await g.setMeasuredGoal(mk, stored, targetDateISO);
    }
    setSaving(false);
    if (!ok) {
      // Saying "saved" for a write that did not land is how a goal disappears
      // overnight and the client assumes they never set it.
      //
      // The second half used to be "Check your connection and try again"
      // whatever had happened, and on this screen that sentence is wrong more
      // often than anywhere else it was printed: `setMeasuredGoal` QUEUES the
      // request that nobody answered, so a false here is very largely the
      // server having read the goal and refused it — an RLS check, a CHECK
      // constraint, a row that is not theirs — and offering the same bytes
      // again gets the same answer. `retryLine` says which of the two it was;
      // see src/lib/reachability.ts.
      Alert.alert('Not Saved', `Your goal could not be saved just now, so it isn’t stored. ${retryLine(reach)}`);
      return;
    }
    setAmount(''); setTitle('');
    if (ok === 'queued') {
      // Deliberately not `keptOnPhoneNote`, whose promise ends "it won't show
      // up here until it has" — true of a message, false of this: the goal is
      // in the list below already. Same reasoning as the queued scan on
      // app/(client)/scans.tsx.
      Alert.alert(
        'Saved on This Phone',
        'Your goal is saved on this phone and has not reached your record yet — it goes up on its own next time you have signal. It is in your list in the meantime, and until it has gone up it can’t be removed or marked done.',
      );
    }
  };

  const confirmRemove = (x: GoalTarget) => {
    // A goal no server has seen. `removeGoal` refuses it — correctly, the id is
    // this device's — and the screen used to blame the connection for it.
    if (isPending(x.id)) {
      Alert.alert(
        'Not Sent Yet',
        'This goal is still saved on this phone and has not gone up, so there is nothing to remove yet. It goes up on its own next time you have signal, and you can remove it then. Setting a new goal for the same thing replaces it.',
      );
      return;
    }
    Alert.alert('Remove This Goal?', goalLabel(x), [
      { text: 'Keep It', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        if (!(await g.removeGoal(x.id))) Alert.alert('Not Removed', 'That goal is still there — it could not be removed just now.');
      } },
    ]);
  };

  const toggleAchieved = async (x: GoalTarget) => {
    if (isPending(x.id)) {
      Alert.alert(
        'Not Sent Yet',
        'This goal is still saved on this phone and has not gone up, so it can’t be marked done yet. It goes up on its own next time you have signal.',
      );
      return;
    }
    if (!(await g.setAchieved(x.id, !x.achievedAtISO))) {
      Alert.alert('Not Saved', 'That change was not stored, so it will be back as it was.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* The board's pushed-page head: back, the title centred. The
            eyebrow and the tagline under it were two lines of prose in the
            first viewport that the board does not have. */}
        <PageHead title="Goals" trailing={<Ghost icon="info" a11yLabel={SCREEN_HELP.goal.title}
          onPress={() => Alert.alert(SCREEN_HELP.goal.title, SCREEN_HELP.goal.lines.map((l) => `${l.term} — ${l.means}`).join('\n\n'))} />} />

        {/* The projected finish is drawn beside a date the member chose, which
            is exactly what makes it read as a commitment. What each of the two
            dates is sits behind the info control above. */}

        {g.status === 'error' ? (
          <Section>
            {/* `t.warn`, not the string "warn". Notice's `tone` is a COLOUR —
                it becomes Card's borderColor and the status dot's
                backgroundColor — so the literal resolved to no colour at all
                and the one banner whose whole job is to be noticed lost its
                mark. It was the only tone= string literal in the tree; every
                other call passes a theme token. */}
            <Notice tone={t.warn} kicker="Not Loaded" title="Your goals could not be read"
              note="This is an unread list, not an empty one. Pull down to try again." />
          </Section>
        ) : g.status === 'loading' ? (
          <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading your goals…</Text></Section>
        ) : (
          <>
            {lead && leadProgress ? (
              // The board's figure card where the Hero was: the goal as the
              // card's head, the current reading as the one big figure, how
              // far along on its own line, a thin bar for the same fraction the
              // ring used to draw, and the projection under it in the same
              // card rather than in a second one.
              <View>
                <Section>
                  <SectionHead title={goalLabel(lead)} note={['Target', fig(goalValue(leadProgress.target, lead.kind as MeasuredKind, wu)), goalUnit(lead.kind as MeasuredKind, wu)].join(' ')} />
                  {/* Goal, figure, unit and progress are one fact and one stop. */}
                  {/* The ring is the fraction the thin bar used to draw; the
                      reading it is measured from sits beside it as the figure,
                      and what is left is a chip with its word. `leadProgress`
                      exists only over a WHOLE read of the readings (see
                      `progressFor`), so the arc is never drawn from a
                      truncated series. */}
                  <View accessible accessibilityLabel={[goalLabel(lead), [fig(goalValue(leadProgress.current, lead.kind as MeasuredKind, wu)), goalUnit(lead.kind as MeasuredKind, wu)].join(' '), `${leadProgress.pct}% of the way`, `${Math.abs(goalDelta(leadProgress.remaining, lead.kind as MeasuredKind, wu))} ${goalUnit(lead.kind as MeasuredKind, wu)} to go`].join(', ')}
                    style={{ flexDirection: fontScale >= 1.35 ? 'column' : 'row', alignItems: 'center', gap: sp.lg }}>
                    <Ring size={120} value={Math.max(0, Math.min(100, leadProgress.pct)) / 100} figure={`${leadProgress.pct}%`} sub="of the way"
                      spoken={`${leadProgress.pct}% of the way to your goal`} />
                    <View style={{ flex: 1, minWidth: 0, gap: sp.sm }}>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>Now</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.35}
                          style={{ ...value(34), color: t.ink, flexShrink: 1 }}>
                          {fig(goalValue(leadProgress.current, lead.kind as MeasuredKind, wu))}
                        </Text>
                        <Text numberOfLines={1} style={{ ...ty.head, color: t.ink3, marginStart: 6, letterSpacing: 0, flexShrink: 0 }}>{goalUnit(lead.kind as MeasuredKind, wu)}</Text>
                      </View>
                      <TonedChip label={`${Math.abs(goalDelta(leadProgress.remaining, lead.kind as MeasuredKind, wu))} ${goalUnit(lead.kind as MeasuredKind, wu)} to go`} />
                    </View>
                  </View>
                  {/* The readings since the goal was set, as the area chart.
                      Two readings or more: one is a dot, and the figure above
                      already is that dot. */}
                  {leadSeries.length >= 2 ? (
                    <View style={{ marginTop: sp.lg }}>
                      <Spark area data={leadSeries.map((p) => p.v)} labels={leadSeries.map((p) => p.t)} unit={` ${goalUnit(lead.kind as MeasuredKind, wu)}`} />
                    </View>
                  ) : null}
                  {projectionLine(lead, seriesFor(lead.kind as MeasuredKind), wu) ? (
                    <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>{projectionLine(lead, seriesFor(lead.kind as MeasuredKind), wu)}</Text>
                  ) : null}
                </Section>
              </View>
            ) : measuredOpen && !readingsWhole ? (
              // The hero is chosen as the nearest-due open goal that HAS
              // readings behind it, so a failed scans read simply deleted it
              // from the screen — the one place a member looks to see how a
              // goal is going went blank with no explanation anywhere on the
              // page. The goals themselves read fine; the readings did not, and
              // that is a different sentence from "you have not started".
              <Section>
                <Notice tone={t.warn} kicker="Progress"
                  title={c.status === 'loading' ? 'Reading your measurements' : c.status === 'partial' ? 'Not all of your measurements could be read' : 'Your measurements could not be read'}
                  note={c.status === 'loading'
                    ? 'Progress is worked out from your weigh-ins and scans, which are still loading.'
                    : c.status === 'partial'
                      ? 'More weigh-ins and scans are on record than can be read in one go, so progress cannot be worked out.'
                      : 'Your weigh-ins and scans could not be read just now, so progress cannot be worked out. Nothing is lost.'} />
              </Section>
            ) : null}

            <Section>
              {/* 'partial' falls through the error/loading branches above and reaches
    here, where `open.length` would be the size of the page rather than of
    the list. Same rule as every other count in the app. */}
        <SectionHead title="Your Goals" note={g.status === 'ready' && goals.length ? `${open.length} open` : undefined} />
              {!goals.length ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  No goals yet. Set one below — a number to work toward, or anything else you’re chasing.
                </Text>
              ) : goals.map((x) => {
                const measured = isMeasured(x);
                const prog = progressFor(x);
                const unit = measured ? goalUnit(x.kind as MeasuredKind, wu) : '';
                const overdue = isOverdue(x, Date.now());
                // On this phone and not yet on the record. Said on the row,
                // because the two controls beside it will refuse until it has
                // gone up and a refusal with no reason reads as a fault.
                const waiting = isPending(x.id);
                return (
                  <View key={x.id} style={{ paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.surface3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.head, color: x.achievedAtISO ? t.ink3 : t.ink }}>
                          {goalLabel(x)}{measured && x.targetValue != null ? ` · ${fig(goalValue(x.targetValue, x.kind as MeasuredKind, wu))} ${unit}` : ''}
                        </Text>
                        {/* A state is a chip with its word: done green, a date
                            gone by amber. An open goal with time left is not a
                            state, so it stays a quiet line. */}
                        <View style={{ marginTop: sp.xs }}>
                          {x.achievedAtISO ? <TonedChip tone="brand" icon="check" label={`Done ${shortDate(x.achievedAtISO)}`} />
                            : x.targetDateISO && overdue ? <TonedChip tone="amber" label={`Target Date Passed (${shortDate(x.targetDateISO)})`} />
                            : <Text style={{ ...ty.caption, color: t.ink3 }}>{x.targetDateISO ? `By ${shortDate(x.targetDateISO)}` : 'No target date'}</Text>}
                        </View>
                        {waiting ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                            Saved on this phone — not sent yet. It goes up on its own when you have signal.
                          </Text>
                        ) : null}
                        {/* What the readings can and cannot say about this goal. */}
                        {measured ? (
                          prog
                            // The same fraction the hero's ring draws, as a bar on
                            // the row. Only where `progressFor` gave one — a whole
                            // read with a baseline — and otherwise the reason.
                            ? <Meter label="Progress" val={Math.max(0, Math.min(100, prog.pct))} target={100}
                                note={`${prog.pct}% · ${Math.abs(goalDelta(prog.remaining, x.kind as MeasuredKind, wu))} ${unit} to go`} />
                            : <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{noReadingLine(x.kind as MeasuredKind)}</Text>
                        ) : (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
                            Nothing to measure this against — mark it done when you get there.
                          </Text>
                        )}
                      </View>
                      <Pressable onPress={() => toggleAchieved(x)} accessibilityRole="button"
                        accessibilityLabel={x.achievedAtISO ? `Reopen ${goalLabel(x)}` : `Mark ${goalLabel(x)} done`}
                        style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                        <Text style={{ ...ty.micro, ...font('700'), color: t.ink2 }}>{x.achievedAtISO ? 'Reopen' : 'Done'}</Text>
                      </Pressable>
                      <Pressable onPress={() => confirmRemove(x)} accessibilityRole="button"
                        accessibilityLabel={`Remove ${goalLabel(x)}`}
                        style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                        <Text style={{ ...ty.micro, ...font('700'), color: t.ink3 }}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </Section>

            <Section>
              <SectionHead title="Set a Goal" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.md }}>
                {KIND_TAB.map((k) => (
                  <Pressable key={k.kind} onPress={() => setKind(k.kind)} accessibilityRole="button"
                    accessibilityState={{ selected: kind === k.kind }} accessibilityLabel={k.label}
                    style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
                             backgroundColor: kind === k.kind ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, ...font('600'), color: kind === k.kind ? t.brandInk : t.ink2 }}>{k.label}</Text>
                  </Pressable>
                ))}
              </View>

              {kind === 'custom' ? (
                <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Get through a session without my knee complaining"
                  placeholderTextColor={t.ink3} accessibilityLabel="What you are working toward" multiline
                  style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline,
                           borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 64 }} />
              ) : (
                <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
                  <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad"
                    placeholder={goalUnit(kind as MeasuredKind, wu)} placeholderTextColor={t.ink3}
                    accessibilityLabel={`${GOAL_METRIC[kind as MeasuredKind].label} in ${goalUnit(kind as MeasuredKind, wu)}`}
                    style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring,
                             borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
                  <Text style={{ ...ty.body, color: t.ink3 }}>{goalUnit(kind as MeasuredKind, wu)}</Text>
                </View>
              )}

              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Target Date</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                {DATE_CHIPS.map(([label, d]) => (
                  <Pressable key={label} onPress={() => setDays(d)} accessibilityRole="button"
                    accessibilityState={{ selected: days === d }} accessibilityLabel={label}
                    style={{ flex: 1, paddingVertical: sp.md, borderRadius: radius.sm, alignItems: 'center',
                             backgroundColor: days === d ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, ...font('500'), color: days === d ? t.brandInk : t.ink2 }}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              {/* Which day the chip actually is.
                  "12 wks" is a span, and the thing a member plans around is a
                  date — it is what the list below prints ("By 2 Jun"), what
                  `isOverdue` judges them against, and what their coach reads. It
                  was only visible AFTER saving, so the one moment somebody could
                  have said "that is the week I'm away" was the one moment the
                  screen would not tell them. Read from the same instant the save
                  writes with, so the two cannot disagree. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }} accessibilityLiveRegion="polite">
                {targetDay
                  ? `That is ${shortDate(targetDay)}.`
                  : 'No date — it stays open until you mark it done, and is never overdue.'}
              </Text>

              <View style={{ marginTop: sp.lg }}>
                <Cta label={saving ? 'Saving…' : 'Save Goal'} wide disabled={saving} onPress={save} />
              </View>
              {kind !== 'custom' ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                  Tracked from your {GOAL_METRIC[kind as MeasuredKind].source}. Saving replaces any {GOAL_METRIC[kind as MeasuredKind].label.toLowerCase()} you already have.
                </Text>
              ) : null}
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
