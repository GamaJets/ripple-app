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

/**
 * Which of the member's logged exercises grade against which standard.
 *
 * This used to be `match: ['bench']` and a `String.includes` against the live
 * catalogue — 608 exercises, checked below — and a catalogue that size has a
 * great many substrings in it. `'bench'` caught **Bench Dips** and **Bench
 * Pull**; `'overhead'` caught **Overhead Squat** and the whole **Overhead
 * Carry** family; `'row'` caught **Crow Pose**, on the `row` inside `c-row`.
 *
 * None of that was cosmetic, because of what the numbers behind it do. A
 * bodyweight set is priced at the member's FULL bodyweight (`setLoadKg` in
 * src/lib/bodyweightSets.ts) and `est1RM` is Epley (src/lib/streaks.ts), so an
 * 80 kg member's twelve Bench Dips price at 80 kg and estimate a 112 kg max —
 * a ratio of 1.4, which this screen printed as "Bench Press · Intermediate ·
 * 112 kg · Next: Advanced @ 120 kg" to somebody who has never lain on a bench.
 * And because `best` is a MAX over the matches, a false match can only ever
 * push the grade UP: it can never be corrected by a real lift lower down.
 *
 * So the rule is word boundaries plus an explicit refusal, and the refusal
 * asks one question of every candidate: **could the number on this log line
 * sit at or above the member's true barbell lift?** Where the answer is yes —
 * or where the load is the member's own body rather than a bar — it does not
 * grade. The cost of refusing is a row that reads "Log this lift to see your
 * level", which is true. The cost of accepting is a level, a ratio and a next
 * target, all wrong, in the member's own words about their own strength.
 *
 * What that means lift by lift:
 *
 * · **Bodyweight anything** — `Bodyweight Squat`, `Bodyweight Overhead Press`,
 *   `Inverted Row`, `Ring Row`, `TRX Row/Squat`, `Pistol Squat`, `Jump Squat`,
 *   `Stability Ball Wall Squat`. Priced at the whole member, so they grade a
 *   set of air squats as a loaded max. `Bodyweight Overhead Press` was the
 *   worst of them: the press scale tops out at 1.1×, so an 80 kg member's own
 *   body cleared Elite on the first rep.
 * · **Selectorized machines** — `Machine Shoulder Press`, `Hack Squat`. The
 *   plate stack is a leverage ratio chosen by a manufacturer, not the mass the
 *   member moved, and it reads high. A **Smith** machine is the exception and
 *   is normalised back in below: that is a real bar with real plates on it.
 * · **Cables, sleds and landmines** — `Seated Row`, `Kneeling Cable Row`,
 *   `Sled Row`, `T-Bar Row`. Same objection, and the T-bar is the sharpest
 *   case: the lever puts roughly two thirds of the loaded plate at the hands,
 *   so a logged 100 kg would have graded as a 100 kg barbell row.
 * · **A different exercise wearing the name** — `Upright Row` and `Rear Delt
 *   Row` are shoulder accessories, `Overhead Squat` is a shoulder-limited lift
 *   at half a back squat, `Romanian`/`Stiff Leg` deadlifts are hinge
 *   accessories nobody tests a single at. Each of these under-states rather
 *   than inflates, which is the safe direction — but a member who only ever
 *   RDLs has not tested a deadlift, and this screen must not hand them a level
 *   and a target for a lift they have not done.
 * · **One leg at a time** — every `Split Squat`, `Bulgarian Split Squat`,
 *   `Pistol Squat`, `Single Leg`/`Kickstand` deadlift. Half the body against a
 *   two-leg standard, and the unloaded ones inflate on top of it.
 * · **Bands** — `Banded Squat`, `Banded Romanian Deadlift`. A band's
 *   resistance is not kilograms of mass and any figure typed there is not
 *   comparable to a bar.
 *
 * What DOES grade is the named lift and the variants whose load is directly
 * comparable and, in all but a couple of cases, strictly below it: front and
 * pause and box squats, every grip and angle of bench press, sumo and deficit
 * and trap-bar pulls, seated and kettlebell presses, bent-over and
 * chest-supported rows. Two of those read slightly high — a trap-bar deadlift
 * and a Smith squat are each worth a few per cent more than the free-barbell
 * lift — and they are kept anyway: the bands here are 25 to 50 percentage
 * points of bodyweight wide, a few per cent does not cross one, and refusing
 * them would tell a trap-bar-only or Smith-only lifter they have never
 * deadlifted or squatted.
 *
 * The full per-lift match list against the live catalogue was checked name by
 * name when this was written; the patterns match 66 of the 608 exercises and
 * match NOTHING the old substrings did not — this can only ever narrow.
 */
const LIFTS: { name: string; re: RegExp; not: RegExp; mult: number[] }[] = [
 { name: 'Squat', re: /\bsquats?\b/, not: /\b(bodyweight|jump|pistol|split|hack|overhead|wall|trx|cossack|banded|machine)\b/, mult: [0.75, 1.25, 1.5, 2.0, 2.5] },
 { name: 'Bench Press', re: /\bbench\s+press\b/, not: /\b(bodyweight|machine)\b/, mult: [0.5, 0.75, 1.0, 1.5, 2.0] },
 { name: 'Deadlift', re: /\bdeadlifts?\b/, not: /\b(bodyweight|romanian|rdl|stiff[- ]?leg|straight[- ]?leg|single[- ]?leg|kickstand|banded|machine)\b/, mult: [1.0, 1.5, 2.0, 2.5, 3.0] },
 { name: 'Overhead Press', re: /\b(overhead|shoulder|military)\s+press(es)?\b|\bohp\b/, not: /\b(bodyweight|machine)\b/, mult: [0.35, 0.55, 0.7, 0.9, 1.1] },
 { name: 'Row', re: /\brows?\b/, not: /\b(bodyweight|upright|rear\s+delt|inverted|rings?|trx|sled|cable|t-?bar|machine)\b|\bseated\s+row\b/, mult: [0.5, 0.75, 1.0, 1.25, 1.5] },
];

/**
 * The exercise name as the patterns above read it.
 *
 * Lowercased, and with "Smith machine" collapsed to "Smith" — which is the one
 * piece of cleverness here and it is load-bearing. Every `not` above refuses
 * `machine`, because a selectorized stack is not the mass the member lifted; a
 * Smith machine is a barbell on rails and its plates are exactly what they say
 * they are. Without this line `Smith Machine Squat` and `Smith Machine
 * Shoulder Press` would be thrown out with `Hack Squat` and `Machine Shoulder
 * Press`, and a member who trains in a Smith rack would be told they have
 * never squatted.
 */
const normalise = (exercise: string) => exercise.toLowerCase().replace(/\bsmith\s+machine\b/g, 'smith');
const isLift = (lift: { re: RegExp; not: RegExp }, exercise: string) => {
 const n = normalise(exercise);
 return lift.re.test(n) && !lift.not.test(n);
};

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
 // `c.status`, not `c.profileStatus`. The bodyweight is not a profile field:
 // `weightKg` is the most recent of a TYPED figure (profile) and the newest
 // SCAN (scans), so its readability depends on both reads. Gating on the
 // profile alone meant a member with a body-composition scan every Monday, on a
 // phone whose scans read had failed or come back truncated, got `bw === null`
 // under `bodyWhole === true` — and was told the app has never had a weight for
 // them and sent off to add one, while every lift on the screen graded
 // ungradable. `c.status` is `worstStatus(profileStatus, scansStatus)` and has
 // been there the whole time; this screen's own header says the status gates
 // are what stop exactly this.
 const bodyWhole = isWhole(c.status);
 const bw = c.weightKg;

 const rows = LIFTS.map((lift) => {
 // `!p.bodyweight` is the belt to the patterns' braces, and it is here because
 // a name is not the only way a body gets onto this board. None of the five
 // lifts above is a bodyweight movement — they are a bar, five times over — so
 // a record whose load came from a weigh-in cannot be one of them, whatever it
 // is called. A trainer writing their own exercise name, or a member who ticks
 // Bodyweight on a bench press by accident, would otherwise put their own
 // weight through Epley and read it back here as a max.
 const best = prs
 .filter((p) => !p.bodyweight && isLift(lift, p.exercise))
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
