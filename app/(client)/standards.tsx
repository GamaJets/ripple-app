// Client · Strength Standards. Grades the client's best estimated 1RM on the big
// lifts against bodyweight multiples (approximate, unisex). Reads PRs + weight.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: five bordered cards
// became hairline rows, the level bar is on the kit's 3px mark spec, and the
// level name and "Elite" tag no longer print in accent/status colour — the
// status is a mark beside ink text. Five equal lifts is a list, so no hero.
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { personalRecords } from '../../src/lib/streaks';
import { Rule, Section, SectionHead, Ghost } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty, numeric, value } from '../../src/theme/scale';

const LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
const LIFTS: { name: string; match: string[]; mult: number[] }[] = [
 { name: 'Squat', match: ['squat'], mult: [0.75, 1.25, 1.5, 2.0, 2.5] },
 { name: 'Bench Press', match: ['bench'], mult: [0.5, 0.75, 1.0, 1.5, 2.0] },
 { name: 'Deadlift', match: ['deadlift'], mult: [1.0, 1.5, 2.0, 2.5, 3.0] },
 { name: 'Overhead Press', match: ['overhead', 'shoulder press', 'ohp'], mult: [0.35, 0.55, 0.7, 0.9, 1.1] },
 { name: 'Row', match: ['row'], mult: [0.5, 0.75, 1.0, 1.25, 1.5] },
];

function levelFor(ratio: number, mult: number[]) {
 let lvl = -1;
 for (let i = 0; i < mult.length; i++) if (ratio >= mult[i]) lvl = i;
 return lvl; // -1 = below beginner
}

export default function Standards() {
 const t = useTheme();
 const router = useRouter();
 const c = useClientData();
 const { log } = useWorkoutLog();
 const prs = personalRecords(log);
 const bw = c.weightKg;

 const rows = LIFTS.map((lift) => {
 const best = prs
 .filter((p) => lift.match.some((m) => p.exercise.toLowerCase().includes(m)))
 .reduce((mx, p) => Math.max(mx, p.est1RM), 0);
 const ratio = best && bw ? best / bw : 0;
 const lvl = best ? levelFor(ratio, lift.mult) : -2;
 const nextTarget = lvl >= 0 && lvl < LEVELS.length - 1 ? Math.round(lift.mult[lvl + 1] * bw) : null;
 return { lift, best, ratio, lvl, nextTarget };
 });
 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

  {/* ── header ──────────────────────────────────────────────────────── */}
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
   <View style={{ flex: 1 }}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>Best lifts vs bodyweight · approximate</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Strength standards</Text>
   </View>
   <Ghost icon="back" onPress={() => router.back()} />
  </View>

  <Rule />

  <Section>
   <SectionHead title="The big lifts" note={`bodyweight ${bw} kg`} />
   {rows.map(({ lift, best, ratio, lvl, nextTarget }, i) => (
    <View key={lift.name} style={{ paddingVertical: sp.lg, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{lift.name}</Text>
      {best ? (
       <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ ...value(18), color: t.ink }}>{best}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginLeft: 4 }}>kg · {ratio.toFixed(2)}×</Text>
       </View>
      ) : (
       <Text style={{ ...ty.caption, color: t.ink3 }}>No data</Text>
      )}
     </View>
     {lvl >= -1 ? (
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
         <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>Next: {LEVELS[lvl + 1]} @ {nextTarget} kg</Text>
        ) : lvl === LEVELS.length - 1 ? (
         <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2 }}>Top of the scale</Text>
        ) : null}
       </View>
      </View>
     ) : (
      <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Log this lift to see your level.</Text>
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
