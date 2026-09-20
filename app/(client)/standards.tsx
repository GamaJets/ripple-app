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
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
// `plain` beside them: `weightIn` hands back a NUMBER rounded to a tenth, and a
// number rendered as a JSX child is `String(n)` — an ASCII full stop, in every
// locale. This screen printed "142.5 kg · 1,75×" on one row, a full stop and a
// comma as decimal separators inside the same widget, because the ratio beside
// it goes through `num2` and the load did not. A German reader parses "142.5" as
// a hundred and forty-two thousand five hundred. `plain` and not `num2` for the
// same reason src/lib/deltaLabel.ts gives: a load is a figure that is typed back
// into boxes `readNumber` parses, so it takes the reader's separator and never a
// thousands group.
import { plain, weightIn, weightLabel } from '../../src/lib/units';
import { useCallback } from 'react';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { personalRecords } from '../../src/lib/streaks';
import { Section, SectionHead, PageHead, Ghost, Notice, fig, DayBars, TonedChip } from '../../src/ui/kit';
import { gradeLift } from '../../src/lib/strengthLevel';
// Which lift is furthest behind the others, measured on each lift's own ladder
// rather than on the ratio column. See the note where `balance` is built.
import { balanceLine, weakestLift } from '../../src/lib/strengthBalance';
import { STRENGTH_LIFTS, countsFor } from '../../src/lib/strengthLifts';
import { isWhole } from '../../src/ui/loadStatus';
import { sp, layout, hairline, type as ty, numeric, value, font } from '../../src/theme/scale';

/** A converted weight in the reader's own spelling, or null for `fig` to dash.
 *  The same two steps `weightLabel` takes, without the unit — this screen draws
 *  the unit in its own element beside the figure. */
const weightShown = (v: number | null): string | null => (v == null ? null : plain(v));
import { num2 } from '../../src/lib/format';

const LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];

// The lift table, the name matcher and the bodyweight guard live in
// src/lib/strengthLifts.ts. They were written here, and moved the moment the
// tree was quiet enough to register a suite in both package.json and
// tsconfig.test.json: which exercises grade is the part of this screen that a
// hand-sweep of the catalogue verified and nothing held. strengthLifts.test.ts
// now names the false matches — Bench Dips, Bench Pull, Overhead Squat, the
// Overhead Carry family, Crow Pose — against the live catalogue's own spelling
// of them. Nothing about the matching changed in the move.

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

 const rows = STRENGTH_LIFTS.map((lift) => {
 // `countsFor` is both halves of the test — the name patterns AND the refusal
 // of a bodyweight-priced record. None of the five lifts is a bodyweight
 // movement, so a load that came from a weigh-in cannot be one of them
 // whatever it is called, which is the half of the guard that covers the names
 // the catalogue does not contain. See src/lib/strengthLifts.ts.
 const best = prs
 .filter((p) => countsFor(lift, p))
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

 // ── which lift is furthest behind the rest ───────────────────────────────
 //
 // The question this screen is opened with, and the one five independent rows
 // could not answer. It cannot be answered by reading down the ratio column
 // either: the five ladders are not the same ladder, so an Elite 1.1× press and
 // a barely-Novice 1.1× deadlift look identical there. `weakestLift` compares
 // each lift's position on its OWN scale. See src/lib/strengthBalance.ts.
 //
 // Gated on BOTH reads being whole, which is not belt-and-braces. A truncated
 // training log under-states a best lift, and an under-stated lift is precisely
 // what this would name as the weak one — so the member would be sent to train
 // the lift our read had failed on. The bodyweight is the divisor behind every
 // ratio fed in, and `c.status` is the worst of the two reads it comes from.
 // Every grade on this screen is already gated this way; this sentence is the
 // one that would be acted on, so it gets the same gate and no less.
 const balance = liftsWhole && bodyWhole
  ? balanceLine(weakestLift(rows.flatMap(({ lift, grade }) => (
     grade.kind === 'graded' ? [{ name: lift.name, ratio: grade.ratio, mult: lift.mult }] : []
    ))))
  : null;

 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

  {/* ── header ──────────────────────────────────────────────────────── */}
  {/* The board's pushed-page head; what the grades are and how rough they
      are is the one quiet line under the title. */}
  <PageHead title="Strength Standards" subtitle="Best lifts vs bodyweight · approximate" />

  {/* ── the five lifts as one picture ─────────────────────────────────────
      The page opened on a help row and a list; it opens on where the five
      lifts stand beside each other, which is the question the list made a
      reader answer by scrolling. A bar is a LEVEL, one to five, and nothing
      finer — the ratio behind it is on the row below.

      Three different nothings, kept apart the way DayBars keeps them: a lift
      graded below Beginner is a grey stub (known, and low); a lift with no
      grade — never logged, or no bodyweight to divide by — draws NOTHING; and
      under a log read that was not whole every bar is withheld, because a best
      lift over part of a log may be under-stated and the notice below says so. */}
  <Section>
   <SectionHead title="Your Levels" note="Beginner to Elite" />
   <DayBars h={72} max={LEVELS.length}
    days={rows.map(({ lift, grade, lvl }) => ({
     label: lift.name.split(' ')[0],
     value: liftsWhole && grade.kind === 'graded' ? lvl + 1 : null,
    }))}
    spoken={liftsWhole
     ? 'Your levels. ' + rows.map(({ lift, grade, lvl }) => `${lift.name}, ${grade.kind === 'graded' ? (lvl >= 0 ? LEVELS[lvl] : 'getting started') : 'no level'}`).join('. ') + '.'
     : 'Your levels are not drawn, because your training log was not read in full.'} />
   {/* The takeaway, under the picture it is drawn from.
       Read as text and not as a Notice: a Notice carries a status mark, and
       nothing here is a warning — a lift sitting lower on its own scale than
       its neighbours is an ordinary fact about an ordinary training history,
       and marking it would turn a comparison into a verdict on the reader.
       Null whenever either read is short, so this never appears beside the
       caveat below it. */}
   {balance ? (
    <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>
     {balance}
    </Text>
   ) : null}
  </Section>

  {/* Above the grades, not below them. A member reads "Novice" first, and this
      card is what stops that landing as a verdict on them rather than as the
      ratio it is — see CLIENT_SCREEN_HELP_KEYS in src/lib/screenHelp.ts. */}
  <ScreenHelp screen="standards" />

  <Section>
   <SectionHead title="The Big Lifts" note={bw != null ? `bodyweight ${weightLabel(bw, wu)}` : bodyWhole ? 'add your weight for ratios' : 'bodyweight not read'} />
   {/* One button, before the rows, rather than one per lift.
       Every row on this screen grades a lift against bodyweight, so with no
       weight on the record all six say the same thing — "add one and this
       grades itself" — and until now not one of them offered a way to. Six
       buttons saying the same thing is the other mistake, so the offer is made
       once, where the SectionHead already says "add your weight for ratios".
       Only under a whole read: a weight that merely could not be READ is not a
       weight to add, and asking for it again would be the app blaming the
       member for its own failed request. */}
   {bw == null && bodyWhole ? (
    <View style={{ alignSelf: 'flex-start', marginTop: sp.sm, marginBottom: sp.md }}>
     <Ghost label="Add Your Weight" a11yLabel="Add your bodyweight, so these lifts can be graded"
      onPress={() => router.push('/(client)/scans')} />
    </View>
   ) : null}
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
      <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>{lift.name}</Text>
      {best ? (
       <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ ...value(18), color: t.ink }}>{fig(weightShown(weightIn(best, wu)))}</Text>
        {/* The multiple is deliberately printed raw beside the converted
            lift: it is a ratio, so 1.75× is 1.75× in pounds too. And it is
            printed only when there was something to divide by — "0.00×" beside
            a real lift is not a small multiple, it is a missing bodyweight
            wearing the clothes of one. */}
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginStart: 4 }}>
         {wu}{grade.kind === 'graded' ? ` · ${num2(grade.ratio)}×` : ''}
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
         <View key={L} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: li <= lvl ? t.brand : t.surface3 }} />
        ))}
       </View>
       <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: sp.sm }}>
        {/* The level as a chip: the accent once there is one, grey before. */}
        <TonedChip label={lvl >= 0 ? LEVELS[lvl] : 'Getting Started'} tone={lvl >= 0 ? 'brand' : 'neutral'} />
        {nextTarget ? (
         <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>Next: {LEVELS[lvl + 1]} @ {plain(nextTarget)} {wu}</Text>
        ) : lvl === LEVELS.length - 1 ? (
         <Text style={{ ...ty.caption, ...font('500'), color: t.ink2 }}>Top of the scale</Text>
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


  <Section>
   <Text style={{ ...ty.caption, color: t.ink3 }}>Standards are general guidelines and vary by age, sex &amp; training history.</Text>
  </Section>
 </ScrollView>
 </SafeAreaView>
 );
}
