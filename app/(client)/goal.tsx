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
import { useState } from 'react';
import { View, Text, ScrollView, TextInput, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, Notice, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightToKg, kgToLb, type WeightUnit } from '../../src/lib/units';
import { useGoalTracker } from '../../src/ui/goalTracker';
import {
  progressOf, projectionOf, goalLabel, isMeasured, isOverdue, sortGoals,
  GOAL_METRIC, MEASURED_KINDS, MIN_TREND_DAYS,
  type GoalKind, type GoalTarget, type MeasuredKind, type Point,
} from '../../src/lib/goalTargets';

const KIND_TAB: { kind: GoalKind; label: string }[] = [
  ...MEASURED_KINDS.map((k) => ({ kind: k as GoalKind, label: k === 'weight' ? 'Weight' : k === 'bodyfat' ? 'Body fat' : 'Muscle' })),
  { kind: 'custom', label: 'Something else' },
];

const DATE_CHIPS: [string, number | null][] = [['4 wks', 28], ['8 wks', 56], ['12 wks', 84], ['No date', null]];

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

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
const goalDelta = (v: number, k: MeasuredKind, wu: WeightUnit) =>
  weightKind(k) && wu === 'lb' ? Math.round(kgToLb(v)) : v;

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
  switch (p.kind) {
    case 'reached':
      return 'You’ve reached this one — mark it done, or set a new target.';
    case 'tooshort':
      return `Only ${p.days === 1 ? 'a day' : `${p.days} days`} between your readings so far. A finish date needs about ${MIN_TREND_DAYS} days of them — a shorter gap is noise, not a trend.`;
    case 'flat':
      return 'Your readings haven’t moved since you set this, so there’s no pace to project from.';
    case 'wrongway':
      return `Your recent trend (${p.weeklyRate > 0 ? '+' : ''}${rate(p.weeklyRate).toFixed(2)} ${unit}/wk) is heading away from this target. Keep going, or adjust the goal.`;
    case 'eta': {
      const eta = new Date(p.etaMs);
      return `At your current pace (${p.weeklyRate > 0 ? '+' : ''}${rate(p.weeklyRate).toFixed(2)} ${unit}/wk) you’ll get there around ${eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.`;
    }
  }
}

export default function Goal() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const g = useGoalTracker();
  // The unit this client reads weight in. Targets are stored in kilograms, the
  // same as every series they are measured against, so this only ever touches
  // what is printed and what comes back out of the entry field (TF-37).
  const wu = useSettings().weightUnit;

  const [kind, setKind] = useState<GoalKind>('weight');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [days, setDays] = useState<number | null>(84);
  const [saving, setSaving] = useState(false);

  const seriesFor = (k: MeasuredKind): Point[] =>
    k === 'weight' ? c.weightSeries : k === 'bodyfat' ? c.bodyFatSeries : c.muscleSeries;

  const goals = sortGoals(g.goals);
  const open = goals.filter((x) => !x.achievedAtISO);
  // The one to put at the top: the nearest-due open goal that actually has
  // readings behind it. A goal we cannot measure makes a poor hero.
  const lead = open.find((x) => isMeasured(x) && progressOf(x, seriesFor(x.kind as MeasuredKind)) !== null);
  const leadProgress = lead ? progressOf(lead, seriesFor(lead.kind as MeasuredKind)) : null;

  const save = async () => {
    if (saving) return;
    const targetDateISO = days == null ? null : new Date(Date.now() + days * 86400000).toISOString();
    setSaving(true);
    let ok = false;
    if (kind === 'custom') {
      if (!title.trim()) { setSaving(false); Alert.alert('Say what the goal is', 'Type what you’re working toward.'); return; }
      ok = await g.addCustomGoal(title, targetDateISO);
    } else {
      const mk = kind as MeasuredKind;
      const n = parseFloat(amount);
      if (!Number.isFinite(n) || n <= 0) {
        setSaving(false);
        Alert.alert('Enter a number', `Type your ${GOAL_METRIC[mk].label.toLowerCase()} in ${goalUnit(mk, wu)}.`);
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
      Alert.alert('Not saved', 'Your goal could not be saved just now, so it isn’t stored. Check your connection and try again.');
      return;
    }
    setAmount(''); setTitle('');
  };

  const confirmRemove = (x: GoalTarget) => {
    Alert.alert('Remove this goal?', goalLabel(x), [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        if (!(await g.removeGoal(x.id))) Alert.alert('Not removed', 'That goal is still there — it could not be removed just now.');
      } },
    ]);
  };

  const toggleAchieved = async (x: GoalTarget) => {
    if (!(await g.setAchieved(x.id, !x.achievedAtISO))) {
      Alert.alert('Not saved', 'That change was not stored, so it will be back as it was.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Progress</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Goals</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>What you’re working toward, and how it’s going</Text>

        {g.status === 'error' ? (
          <Section>
            <Notice tone="warn" kicker="Not loaded" title="Your goals could not be read"
              note="This is not an empty list — it’s an unread one. Nothing below is missing because you haven’t set it. Pull back and open this again once you’re connected." />
          </Section>
        ) : g.status === 'loading' ? (
          <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading your goals…</Text></Section>
        ) : (
          <>
            {lead && leadProgress ? (
              <View>
                <Hero
                  label={goalLabel(lead)}
                  figure={fig(goalValue(leadProgress.current, lead.kind as MeasuredKind, wu))}
                  unit={goalUnit(lead.kind as MeasuredKind, wu)}
                  arc={leadProgress.pct / 100}
                  note={`${leadProgress.pct}% of the way · ${Math.abs(goalDelta(leadProgress.remaining, lead.kind as MeasuredKind, wu))} ${goalUnit(lead.kind as MeasuredKind, wu)} to go`}
                />
                {projectionLine(lead, seriesFor(lead.kind as MeasuredKind), wu) ? (
                  <Section>
                    <Text style={{ ...ty.body, color: t.ink2 }}>{projectionLine(lead, seriesFor(lead.kind as MeasuredKind), wu)}</Text>
                  </Section>
                ) : null}
                <Rule />
              </View>
            ) : null}

            <Section>
              <SectionHead title="Your goals" note={goals.length ? `${open.length} open` : undefined} />
              {!goals.length ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  No goals yet. Set one below — a number to work toward, or anything else you’re chasing.
                </Text>
              ) : goals.map((x) => {
                const measured = isMeasured(x);
                const series = measured ? seriesFor(x.kind as MeasuredKind) : [];
                const prog = measured ? progressOf(x, series) : null;
                const unit = measured ? goalUnit(x.kind as MeasuredKind, wu) : '';
                const overdue = isOverdue(x, Date.now());
                return (
                  <View key={x.id} style={{ paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.body, color: x.achievedAtISO ? t.ink3 : t.ink, fontWeight: '600' }}>
                          {goalLabel(x)}{measured && x.targetValue != null ? ` · ${fig(goalValue(x.targetValue, x.kind as MeasuredKind, wu))} ${unit}` : ''}
                        </Text>
                        <Text style={{ ...ty.micro, color: overdue ? t.warn ?? t.ink3 : t.ink3, marginTop: 2 }}>
                          {x.achievedAtISO
                            ? `Done ${shortDate(x.achievedAtISO)}`
                            : x.targetDateISO
                              ? (overdue ? `Target date passed (${shortDate(x.targetDateISO)})` : `By ${shortDate(x.targetDateISO)}`)
                              : 'No target date'}
                        </Text>
                        {/* What the readings can and cannot say about this goal. */}
                        {measured ? (
                          <Text style={{ ...ty.micro, color: t.ink3, marginTop: 3 }}>
                            {prog
                              ? `${prog.pct}% · ${Math.abs(goalDelta(prog.remaining, x.kind as MeasuredKind, wu))} ${unit} to go`
                              : `No ${GOAL_METRIC[x.kind as MeasuredKind].source} on record yet, so there’s nothing to measure this against.`}
                          </Text>
                        ) : (
                          <Text style={{ ...ty.micro, color: t.ink3, marginTop: 3 }}>
                            Nothing to measure this one against — mark it done when you get there.
                          </Text>
                        )}
                      </View>
                      <Pressable onPress={() => toggleAchieved(x)} accessibilityRole="button"
                        accessibilityLabel={x.achievedAtISO ? `Reopen ${goalLabel(x)}` : `Mark ${goalLabel(x)} done`}
                        style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                        <Text style={{ ...ty.micro, color: t.ink2 }}>{x.achievedAtISO ? 'Reopen' : 'Done'}</Text>
                      </Pressable>
                      <Pressable onPress={() => confirmRemove(x)} accessibilityRole="button"
                        accessibilityLabel={`Remove ${goalLabel(x)}`}
                        style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </Section>

            <Rule />

            <Section>
              <SectionHead title="Set a goal" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.md }}>
                {KIND_TAB.map((k) => (
                  <Pressable key={k.kind} onPress={() => setKind(k.kind)} accessibilityRole="button"
                    accessibilityState={{ selected: kind === k.kind }} accessibilityLabel={k.label}
                    style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
                             backgroundColor: kind === k.kind ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.micro, color: kind === k.kind ? t.brandInk : t.ink2 }}>{k.label}</Text>
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
                  <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric"
                    placeholder={goalUnit(kind as MeasuredKind, wu)} placeholderTextColor={t.ink3}
                    accessibilityLabel={`${GOAL_METRIC[kind as MeasuredKind].label} in ${goalUnit(kind as MeasuredKind, wu)}`}
                    style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring,
                             borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
                  <Text style={{ ...ty.body, color: t.ink3 }}>{goalUnit(kind as MeasuredKind, wu)}</Text>
                </View>
              )}

              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Target date</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                {DATE_CHIPS.map(([label, d]) => (
                  <Pressable key={label} onPress={() => setDays(d)} accessibilityRole="button"
                    accessibilityState={{ selected: days === d }} accessibilityLabel={label}
                    style={{ flex: 1, paddingVertical: sp.md, borderRadius: radius.sm, alignItems: 'center',
                             backgroundColor: days === d ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, fontWeight: '500', color: days === d ? t.brandInk : t.ink2 }}>{label}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ marginTop: sp.lg }}>
                <Cta label={saving ? 'Saving…' : 'Save goal'} wide disabled={saving} onPress={save} />
              </View>
              {kind !== 'custom' ? (
                <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
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
