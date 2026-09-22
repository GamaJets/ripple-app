// Client · Progression. Auto-generated next-session targets from your logged
// lifts using double-progression (add load when you clear the top of the range,
// otherwise chase reps). Read-only guidance — you still log what you actually do.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: one bordered card per
// exercise (each with a second bordered box nested inside it) became hairline
// rows carrying a <KpiRow>, and the action tag no longer prints itself in a
// reserved status colour — the status is a coloured mark beside ink text.
// A list of equal-weight targets is a list, so this screen leads with no hero.
import { useCallback } from 'react';
import { trainIntent } from '../../src/lib/trainIntent';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import type { IconName } from '../../src/ui/Icon';
import { isWhole } from '../../src/ui/loadStatus';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useSettings } from '../../src/ui/settings';
import { liftIn, liftLabel, liftDeltaIn, convertedNote } from '../../src/lib/units';
import { suggestProgression, type ProgressAction } from '../../src/lib/progression';
import { deltaLabel } from '../../src/lib/deltaLabel';
import { Section, SectionHead, PageHead, KpiRow, Notice, Cta, Ghost, fig, Donut, Legend, IconPlate, TonedChip, Expandable, type Slice, type Tone } from '../../src/ui/kit';
import { sp, layout, hairline, font, type as ty } from '../../src/theme/scale';
import { useMovementName } from '../../src/ui/catalogueTranslations';

// A tone by NAME, not a colour: the kit gives the plate, the chip and the donut
// slice their own measured pairs from it. Green is the one that adds load and
// amber the one that takes it off; the two that leave the bar alone are blue
// and grey, because neither is a verdict on anything.
const META: Record<ProgressAction, { label: string; icon: IconName; tone: Tone }> = {
  increase: { label: 'Add Load', icon: 'trending', tone: 'brand' },
  reps: { label: 'Chase Reps', icon: 'plus', tone: 'blue' },
  hold: { label: 'Hold', icon: 'minus', tone: 'neutral' },
  deload: { label: 'Ease Back', icon: 'swap', tone: 'amber' },
};
const ACTIONS: ProgressAction[] = ['increase', 'reps', 'hold', 'deload'];

export default function Progression() {
  const t = useTheme();
  // The reader's own language for the movement, English where the catalogue
  // has no translation. The stored name is untouched — it is the identity.
  const { textOf: movement } = useMovementName();
  const router = useRouter();
  const { log, status: logStatus, reload } = useWorkoutLog();
  // A failed read used to strand this screen for the whole session: the only
  // way to ask again was the Try Again button inside the failure notice, and
  // there is no such button on a screen that merely went stale. Pull to refresh
  // is the gesture people already try — see src/ui/pullToRefresh.tsx.
  const pull = usePullToRefresh(useCallback(() => { reload(); }, [reload]));
  // This screen tells somebody what to load on a bar, so it is the one place
  // in the app where reading the wrong unit is not a cosmetic problem. The
  // double-progression arithmetic stays in kilograms — its 2.5 kg step is a
  // pair of 1.25 kg plates, not a rounded pound figure — and the targets are
  // read out at the half-pound `liftIn` uses, which is what an imperial rack
  // of 1.25 lb fractionals can actually make.
  const wu = useSettings().weightUnit;
  const unitNote = convertedNote(wu);
  const tips = suggestProgression(log, wu);
  const whole = isWhole(logStatus);
  // The donut's slices and the legend's lines: how many of the targets are each
  // kind. Null — not zero — under a read that was not whole, which the legend
  // prints as a dash and the donut does not draw.
  const mix: Slice[] = ACTIONS.map((a) => {
    const n = tips.filter((x) => x.action === a).length;
    return { label: META[a].label, tone: META[a].tone, value: whole ? n : null, shown: whole ? String(n) : null };
  });
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        {/* The board's pushed-page head; where the targets come from is the
            one quiet line under the title. */}
        <PageHead title="Next-Session Targets" subtitle="From your logged lifts" />


        {/* This screen prescribes a load, and every target is
            anchored to the most recent set it can see. With the read failed
            that anchor is either missing entirely — "log a few weighted sets",
            said to someone who has logged hundreds — or it is whatever this
            phone happened to be holding, which is not the same thing as the
            last set the client actually did. Both need saying before anyone
            loads a bar off the numbers below. */}
        {logStatus === 'error' ? (
          <Section>
            <Notice tone={t.warn} kicker="Targets" title="We couldn’t read your training log"
              note={tips.length
                ? 'The targets below come from what this phone had before the read failed, so they may not include your last session. Check them against what you actually lifted.'
                : 'Targets are worked out from your logged lifts, and we couldn’t read them. This is not a sign you haven’t lifted.'}>
              <View style={{ marginTop: sp.lg }}>
                <Cta label="Try Again" wide onPress={reload} />
              </View>
            </Notice>
          </Section>
        ) : null}

        {tips.length === 0 ? (
          logStatus === 'error' ? null : logStatus === 'loading' ? (
            <Section>
              <Text style={{ ...ty.body, color: t.ink3 }}>Working out your targets…</Text>
            </Section>
          ) : logStatus === 'partial' ? (
            // 'partial' had no arm and fell into "No Targets Yet · Log a few
            // weighted sets" — told to a lifter with years of them on file. A
            // truncated read holds the newest thousand sessions, so a lifter
            // whose weighted work is all older than that produces no tips at
            // all, and the confident sentence is exactly backwards. Same shape
            // as the arm app/(client)/records.tsx already carries.
            <Section>
              <SectionHead title="No Targets in This Read" />
              <Text style={{ ...ty.body, color: t.ink2 }}>
                You have logged more sessions than this screen can read in one go, and there were no weighted
                sets among the ones it read. This is not a statement that you have never logged one.
              </Text>
            </Section>
          ) : (
          <Section>
            <SectionHead title="No Targets Yet" />
            <Text style={{ ...ty.body, color: t.ink2 }}>Log a few weighted sets and your progression targets will appear here.</Text>
            <View style={{ height: sp.lg }} />
            <View style={{ alignSelf: 'flex-start' }}>
              <Cta label="Log a Workout" onPress={() => router.push(trainIntent('/(client)/workouts') as any)} />
            </View>
          </Section>
          )
        ) : (
          <>
          {/* ── what next session asks, as one picture ─────────────────────
              The page opened on a list; it opens on the mix the list adds up
              to. Counted only over a read that finished whole — under a
              truncated one a lift last trained before the cut is not on the
              list, so the shares would be of a sample, and the ring draws its
              grey track and a dash instead. */}
          <Section>
            <SectionHead title="Next Session at a Glance" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg }}>
              <Donut
                slices={mix} centre={whole ? String(tips.length) : null} sub={tips.length === 1 ? 'lift' : 'lifts'}
                spoken={whole
                  ? `${tips.length} lift${tips.length === 1 ? '' : 's'}: ${mix.filter((m) => (m.value ?? 0) > 0).map((m) => `${m.shown} ${m.label}`).join(', ')}`
                  : 'The mix of targets is not counted, because not every session could be read'} />
              <Legend items={mix} />
            </View>
            {!whole && logStatus !== 'error' ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                {logStatus === 'loading' ? 'Still reading your training log.' : 'Not every session could be read, so the mix is not counted. Each target below is still drawn from a real last session.'}
              </Text>
            ) : null}
          </Section>
          <Section>
            <SectionHead title="Aim for These Next Time" note={`${tips.length} Lift${tips.length === 1 ? '' : 's'}`} />
            {tips.map((tip, i) => {
              const m = META[tip.action];
              const bump = tip.nextWeight - tip.lastWeight;
              // The jump is converted as a SPAN. The commonest one this
              // screen produces is 2.5 kg, which is 5.5 lb — and subtracting
              // the two loads AFTER rounding each to the half-pound gives 5.0
              // or 5.5 depending on where the last session's load happened to
              // sit, so the same two plates would be described differently
              // from one week to the next.
              const bumpShown = liftDeltaIn(bump, wu);
              return (
                <View key={tip.exercise} style={{ paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <IconPlate icon={m.icon} tone={m.tone} size={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, ...font('500'), color: t.ink, textTransform: 'capitalize' }}>{movement(tip.exercise)}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Last: {fig(liftLabel(tip.lastWeight, wu))} × {tip.lastReps}</Text>
                    </View>
                    <TonedChip label={m.label} tone={m.tone} />
                  </View>
                  <View style={{ height: sp.md }} />
                  <KpiRow items={[
                    {
                      label: 'Target Load', value: fig(liftIn(tip.nextWeight, wu)), unit: wu,
                      good: bump >= 0,
                      // Gated on the CONVERTED bump, not the raw one. A 1 kg
                      // step is 2 lb, but a 0.2 kg one is no whole pounds at
                      // all, and `bump !== 0` let that through as "+0 lb" —
                      // a load increase the member cannot put on the bar.
                      delta: deltaLabel(bumpShown, { since: null, unit: wu, noChange: 'same weight', noBaseline: 'same weight' }),
                    },
                    { label: 'Target Reps', value: fig(tip.nextReps) },
                  ]} />
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{tip.rationale}</Text>
                </View>
              );
            })}
            {/* The targets are worked out on metric plates and read out in
                pounds, so an imperial rack will not always have the exact
                figure above. Saying so is the difference between a target and
                an instruction nobody can follow. */}
            {unitNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{unitNote} Load the nearest thing your gym has.</Text> : null}
            <View style={{ marginTop: sp.md }}>
              <Expandable title="How Targets Are Worked Out">
                <Text style={{ ...ty.caption, color: t.ink3 }}>Double-progression: clear the top of the rep range on every working set, then the weight goes up and reps reset. These are guidance. Log what you actually lift.</Text>
              </Expandable>
            </View>
          </Section>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
