// Client · Personal Records. The full PR board (the dashboard shows only the top
// three) — every lift's best estimated 1RM, sorted, with the set that set it.
// Read-only from the workout log via personalRecords().
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: the heaviest lift is the
// screen's one hero figure, the stack of bordered cards became hairline rows,
// and the est-1RM column reads as ink rather than accent.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useSettings } from '../../src/ui/settings';
import { est1RMIn, liftLabel, convertedNote } from '../../src/lib/units';
import { personalRecords } from '../../src/lib/streaks';
import { Rule, Section, SectionHead, Hero, Ghost, Notice, Cta, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric, value } from '../../src/theme/scale';

export default function Records() {
 const t = useTheme();
 const router = useRouter();
 const { log, status: logStatus, reload } = useWorkoutLog();
 const wu = useSettings().weightUnit;
 const note = convertedNote(wu);
 // Ranked in the kilograms the board is stored in, and only then read out. The
 // order would come out the same either way today, but an estimate rounded to
 // the whole pound can tie two lifts that are a kilogram apart, and a board
 // sorted on the rounded figure would then order those two arbitrarily.
 const prs = [...personalRecords(log)].sort((a, b) => b.est1RM - a.est1RM);
 const top = prs[0];
 const dstr = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

  {/* ── header ──────────────────────────────────────────────────────── */}
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
   <View style={{ flex: 1 }}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>Best estimated 1-rep max per lift</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Personal records</Text>
   </View>
   <Ghost icon="back" onPress={() => router.back()} />
  </View>

  {/* An empty PR board has three causes and only one of them is "you have not
      set a PR yet". Saying that to a lifter whose log simply did not load
      reports their whole board as gone, on the screen whose entire job is to
      keep a record of it. */}
  {prs.length === 0 && logStatus === 'error' ? (<>
   <Rule />
   <Section>
    <Notice tone={t.warn} kicker="Records" title="We couldn’t read your training log"
     note="Your records are safe — this screen can't see them right now. Nothing has been reset.">
     <View style={{ marginTop: sp.lg }}>
      <Cta label="Try again" wide onPress={reload} />
     </View>
    </Notice>
   </Section>
  </>) : prs.length === 0 && logStatus === 'loading' ? (<>
   <Rule />
   <Section>
    <Text style={{ ...ty.body, color: t.ink3 }}>Loading your records…</Text>
   </Section>
  </>) : prs.length === 0 ? (<>
   <Rule />
   <Section>
    <SectionHead title="No records yet" />
    <Text style={{ ...ty.body, color: t.ink2 }}>No records yet — log a strength workout to set your first PR.</Text>
   </Section>
  </>) : (<>
   {/* ── the hero: the heaviest thing you have lifted ────────────────── */}
   <Hero
    label="Heaviest lift"
    figure={fig(est1RMIn(top.est1RM, wu))}
    unit={`${wu} est. 1RM`}
    note={`${top.exercise} · best set ${fig(liftLabel(top.weight, wu))} × ${top.reps} on ${dstr(top.at)}`}
   />
   {/* The board is kept in kilograms and read out in pounds, so the figures
       here and the ones on a coach's console are the same lifts said twice
       rather than a discrepancy. Absent for a metric reader, who is being
       shown the record itself. */}
   {note ? <Text style={{ ...ty.caption, color: t.ink3 }}>{note}</Text> : null}

   <Rule />

   <Section>
    <SectionHead title="All records" note={`${prs.length} lift${prs.length === 1 ? '' : 's'}`} />
    {prs.map((pr, i) => (
     <View key={pr.exercise} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, width: 18 }}>{i + 1}</Text>
      <View style={{ flex: 1 }}>
       <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }}>{pr.exercise}</Text>
       <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>Best set {fig(liftLabel(pr.weight, wu))} × {pr.reps} · {dstr(pr.at)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
       <Text style={{ ...value(17), color: t.ink }}>{fig(est1RMIn(pr.est1RM, wu))}</Text>
       <Text style={{ ...ty.caption, color: t.ink3 }}>est 1RM · {wu}</Text>
      </View>
     </View>
    ))}
   </Section>
  </>)}
 </ScrollView>
 </SafeAreaView>
 );
}
