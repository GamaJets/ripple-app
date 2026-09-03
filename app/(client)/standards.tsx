// Client · Strength Standards. Grades the client's best estimated 1RM on the big
// lifts against bodyweight multiples (approximate, unisex). Reads PRs + weight.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: five bordered cards
// became hairline rows, the level bar is on the kit's 3px mark spec, and the
// level name and "Elite" tag no longer print in accent/status colour — the
// status is a mark beside ink text. Five equal lifts is a list, so no hero.
//
// TF-37: the bodyweight, the best lift and the next target were all printed as
// kilograms whatever the client reads in — which on this screen means telling
// somebody who loads the bar in pounds that they need 140 for their next level
// when they need 309. All three now convert. The bodyweight MULTIPLE does not,
// and cannot: a ratio of two weights is the same number in every unit, and
// running it through a conversion would be the one change that made this screen
// say something untrue.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel } from '../../src/lib/units';
import { useCallback } from 'react';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { personalRecords } from '../../src/lib/streaks';
import { Rule, Section, SectionHead, Ghost, Notice } from '../../src/ui/kit';
import { gradeLift } from '../../src/lib/strengthLevel';
import { isWhole } from '../../src/ui/loadStatus';
import { sp, layout, hairline, type as ty, numeric, value } from '../../src/theme/scale';

const LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
const LIFTS: { name: string; match: string[]; mult: number[] }[] = [
 { name: 'Squat', match: ['squat'], mult: [0.75, 1.25, 1.5, 2.0, 2.5] },
 { name: 'Bench Press', match: ['bench'], mult: [0.5, 0.75, 1.0, 1.5, 2.0] },
 { name: 'Deadlift', match: ['deadlift'], mult: [1.0, 1.5, 2.0, 2.5, 3.0] },
 { name: 'Overhead Press', match: ['overhead', 'shoulder press', 'ohp'], mult: [0.35, 0.55, 0.7, 0.9, 1.1] },
 { name: 'Row', match: ['row'], mult: [0.5, 0.75, 1.0, 1.25, 1.5] },
];

// `levelFor` and the three-way grade it feeds live in src/lib/strengthLevel.ts,
// where strengthLevel.test.ts holds them to the distinction this screen used to
// lose: a lift with no bodyweight behind it is NOT a lift at the bottom of the
// scale.

export default function Standards() {
 const t = useTheme();
 const router = useRouter();
 const c = useClientData();
 // Neither provider's status was read, and this screen GRADES somebody on what
 // it finds. Under a failed log read `prs` is empty, every row printed "No data"
 // and "Log this lift to see your level." — a flat statement that the member has
 // never squatted — and under a truncated one (src/lib/rowCap.ts) the best set
 // may be in the part that did not come back, so the level, the ratio and the
 // "Next: Intermediate @ …" target are all graded low against a lift they have
 // already beaten. The bodyweight has the same problem in the header: under a
 // failed profile read `bw` is null and the screen told a member who weighs in
 // every week to "add your weight for ratios".
 const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
 // This screen GRADES somebody, off two reads: the training log the best sets
 // come from and the profile the bodyweight comes from. Both can fail, both
 // grade the member low when they do, and both are asked for again here.
 const pull = usePullToRefresh(useCallback(() => { reloadLog(); c.reload(); }, [reloadLog, c.reload]));
 const wu = useSettings().weightUnit;
 const liftsWhole = isWhole(logStatus);
 const prs = personalRecords(log, c.weightSeries);
 const bodyWhole = isWhole(c.profileStatus);
 const bw = c.weightKg;

 const rows = LIFTS.map((lift) => {
 const best = prs
 .filter((p) => lift.match.some((m) => p.exercise.toLowerCase().includes(m)))
 .reduce((mx, p) => Math.max(mx, p.est1RM), 0);
 // Three answers where there used to be a number that meant all three. With a
 // null bodyweight `best / bw` fell to a ratio of 0, and a ratio of 0 grades
 // as -1 — which the bar below draws as five empty segments under the words
 // "Getting started". So a member with a 2× bodyweight deadlift, on a phone
 // whose scans read had failed, was told they were below the beginner standard
 // on the strength of a division that never happened. See
 // src/lib/strengthLevel.ts: no bodyweight is now its own answer.
 const grade = gradeLift(best, bw, lift.mult);
 const lvl = grade.kind === 'graded' ? grade.level : -2;
 // The target is worked out in the kilograms the PRs and the bodyweight are
 // stored in, and only then read out in the client's unit. Multiplying a
 // converted bodyweight would give the same answer here, but the moment one of
 // these two is rounded and the other is not the ratios stop agreeing with the
 // levels they are supposed to define.
 const nextTarget = (bw != null && lvl >= 0 && lvl < LEVELS.length - 1) ? weightIn(lift.mult[lvl + 1] * bw, wu) : null;
 return { lift, best, grade, lvl, nextTarget };
 });
 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

  {/* ── header ──────────────────────────────────────────────────────── */}
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
   <View style={{ flex: 1 }}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>Best lifts vs bodyweight · approximate</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Strength Standards</Text>
   </View>
   <Ghost icon="back" onPress={() => router.back()} />
  </View>

  <Rule />

  <Section>
   <SectionHead title="The Big Lifts" note={bw != null ? `bodyweight ${weightLabel(bw, wu)}` : bodyWhole ? 'add your weight for ratios' : 'bodyweight not read'} />
   {/* Said before the rows, because every row below is a grade and this is the
       reason a low one may not be the member's. */}
   {!liftsWhole && logStatus !== 'loading' ? (
    <Notice tone={t.warn} kicker="Standards"
     title={logStatus === 'error' ? 'We couldn’t read your training log' : 'Not all of your log could be read'}
     note={logStatus === 'error'
      ? 'Nothing below is a level you are at — it is a level we could not look up. Your lifts are on your record.'
      : 'You have logged more sessions than this screen can read in one go, so a best lift set before that is not counted here and the level beside it may be under-stated.'} />
   ) : null}
   {rows.map(({ lift, best, grade, lvl, nextTarget }, i) => (
    <View key={lift.name} style={{ paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{lift.name}</Text>
      {best ? (
       <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ ...value(18), color: t.ink }}>{weightIn(best, wu)}</Text>
        {/* The multiple is deliberately printed raw beside the converted
            lift: it is a ratio, so 1.75× is 1.75× in pounds too. And it is
            printed only when there was something to divide by — "0.00×" beside
            a real lift is not a small multiple, it is a missing bodyweight
            wearing the clothes of one. */}
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginStart: 4 }}>
         {wu}{grade.kind === 'graded' ? ` · ${grade.ratio.toFixed(2)}×` : ''}
        </Text>
       </View>
      ) : (
       // "No data" is a claim that this lift is not on the member's log. Only
       // a whole read is entitled to make it.
       <Text style={{ ...ty.caption, color: t.ink3 }}>{liftsWhole ? 'No data' : logStatus === 'loading' ? 'Reading…' : 'Not read'}</Text>
      )}
     </View>
     {/* The bar is drawn from a ratio, so it is drawn only where there is one.
         `lvl >= -1` was true for an ungraded lift precisely BECAUSE the missing
         bodyweight had already been rounded down into -1. */}
     {grade.kind === 'graded' ? (
      <View>
       <View style={{ flexDirection: 'row', gap: 5, marginTop: sp.md }}>
        {LEVELS.map((L, li) => (
         <View key={L} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: li <= lvl ? t.brand : t.surface3 }} />
        ))}
       </View>
       <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: sp.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
         <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: lvl >= 0 ? t.brand : t.surface3 }} />
         <Text style={{ ...ty.caption, fontWeight: '500', color: lvl >= 0 ? t.ink : t.ink3 }}>{lvl >= 0 ? LEVELS[lvl] : 'Getting started'}</Text>
        </View>
        {nextTarget ? (
         <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>Next: {LEVELS[lvl + 1]} @ {nextTarget} {wu}</Text>
        ) : lvl === LEVELS.length - 1 ? (
         <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2 }}>Top of the scale</Text>
        ) : null}
       </View>
      </View>
     ) : (
      <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
       {/* The lift is on the record and the bodyweight is not, so there is no
           ratio to grade — which is a fact about our record, not about the
           lifter. Said in the two ways it can be true: they have never given us
           a weight, or the read that holds it did not come back. */}
       {grade.kind === 'ungradable'
        ? (bodyWhole
           ? 'A level is this lift divided by your bodyweight, and we do not have a weight for you yet. Add one and this grades itself.'
           : 'A level is this lift divided by your bodyweight, and your weight could not be read just now. This is not a level you are at — it is one we could not work out.')
        : liftsWhole ? 'Log this lift to see your level.'
        : logStatus === 'loading' ? 'Reading your log…'
        : 'Nothing read for this lift, so there is no level to show. That is not the same as never having done it.'}
      </Text>
     )}
    </View>
   ))}
  </Section>

  <Rule />

  <Section>
   <Text style={{ ...ty.caption, color: t.ink3 }}>Standards are general guidelines and vary by age, sex &amp; training history.</Text>
  </Section>
 </ScrollView>
 </SafeAreaView>
 );
}
