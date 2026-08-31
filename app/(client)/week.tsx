// Client · This Week. The week's training plan at a glance — each day's planned
// focus (coach or auto program) and whether it's been logged. Profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Seven days is a list, so the screen leads with no hero: hairline-separated
// rows instead of seven bordered cards. Every provider, computation and route is
// preserved.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Ghost, Notice } from '../../src/ui/kit';
import { sp, layout, type as ty, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { buildProgram } from '../../src/lib/programs';
import { scheduledDay } from '../../src/lib/checklist';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** WEEK is Monday-first; `Date.getDay()` is Sunday-first. */
const jsWeekday = (i: number) => (i + 1) % 7;

export default function ThisWeek() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { getProgram, status: programStatus } = useAssignedPrograms();
  const coachProgram = getProgram(c.id);
  const { log, status: logStatus } = useWorkoutLog();
  // Under 'error' a null from getProgram means "we could not find out", not
  // "your coach has not assigned you one" — and which of the two it is decides
  // what the client trains all week. The `??` below fell through to the generic
  // auto program in both cases, and the header prints the "· coach plan" suffix
  // only when `coachProgram` is set, so the substitution arrived looking exactly
  // like a client who has no coach plan: a bespoke plan replaced by a generic
  // one, with nothing on the screen to prompt a second look.
  const programUnknown = programStatus === 'error' && coachProgram == null;
  const program = coachProgram ?? buildProgram(c.goal, c.bodyFatPct);

  const jsToMon = (new Date().getDay() + 6) % 7;
  const monday = new Date(); monday.setDate(monday.getDate() - jsToMon); monday.setHours(0, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dstr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const logged = new Set(log.map((l) => dstr(new Date(l.t))));

  // What each of the seven rows is actually going to say, decided ONCE so the
  // count in the heading and the list underneath it cannot disagree.
  //
  // This used to be `program.days[i % program.days.length]`. A Mon/Wed/Fri plan
  // has three days, so the modulo painted a session onto all seven weekdays:
  // Push, Pull, Legs, Push, Pull, Legs, Push — Wednesday's session shown on
  // Tuesday, no rest day anywhere, under a heading that read "3 training days a
  // week" and a footer that repeated it. The screen contradicted itself twice
  // on one scroll, and the plan it drew was not the plan the coach wrote.
  //
  // `scheduledDay` is the exact weekday match src/lib/checklist.ts already used
  // for the daily checklist, for the reason written on it there: a plan day
  // that lands nowhere near the real day is a line telling somebody they owe a
  // leg session on a day their plan gives them off.
  const rows = WEEK.map((label, i) => ({ label, i, day: scheduledDay(program.days, jsWeekday(i)) }));
  // The number of days the member will actually see a session on — not
  // `program.days.length`, which counts days the plan names but this week does
  // not place (a coach program whose day fell outside Mon–Sun would be counted
  // and never drawn).
  const trainingDays = rows.filter((r) => r.day).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }} numberOfLines={1}>{program.title}{coachProgram ? ' · coach plan' : ''}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>This Week</Text>
          </View>
        </View>

        {programUnknown ? (
          <View style={{ marginTop: sp.lg }}>
            <Notice tone={t.warn} kicker="This week" title="We couldn’t check for a coach plan"
              note="The week below is Repple's automatic program. If your coach has assigned you one it takes over as soon as we can read it — open this screen again when you have signal." />
          </View>
        ) : null}

        {/* The plan is right either way; what the log decides is which days are
            marked done. Without it a client who trained Monday and Tuesday sees
            an unmarked week and reads it as a week they let slip. */}
        {logStatus === 'error' ? (
          <View style={{ marginTop: sp.lg }}>
            <Notice tone={t.warn} kicker="This week" title="We couldn’t read your training log"
              note="Days you have already trained may not be marked below. Nothing has been lost — this screen just can't see it right now." />
          </View>
        ) : null}

        <Section>
          <SectionHead title="The Plan" note={trainingDays === 0 ? 'No days scheduled' : `${trainingDays} training day${trainingDays === 1 ? '' : 's'} a week`} />

          {rows.map(({ label, i, day: workout }) => {
            const date = new Date(monday); date.setDate(monday.getDate() + i);
            const isToday = i === jsToMon;
            const done = logged.has(dstr(date));
            // A rest day says so and stays tappable — somebody who trains on a
            // day off still wants Train, and the log below still marks it.
            const focus = workout ? workout.focus : 'Rest day';
            const sub = workout
              ? `${workout.exercises.length} exercise${workout.exercises.length === 1 ? '' : 's'}${workout.cardio ? ` · ${workout.cardio}` : ''}`
              : 'Nothing scheduled — train anyway if you want to';
            return (
              <View key={label}>
                {i > 0 ? <Rule /> : null}
                <Pressable onPress={() => router.push('/(client)/workouts')} accessibilityRole="button"
                  accessibilityLabel={`${label} ${date.getDate()}. ${focus}. ${done ? 'Logged' : isToday ? 'Today' : 'Open Train'}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ width: 38 }}>
                    <Text style={{ ...ty.micro, color: isToday ? t.ink2 : t.ink3 }}>{label}</Text>
                    <Text style={{ ...value(17), color: isToday ? t.ink : t.ink2, marginTop: 2 }}>{date.getDate()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: workout ? t.ink : t.ink2, textTransform: 'capitalize' }}>{focus}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{sub}</Text>
                  </View>
                  {done ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
                      <Text style={{ ...ty.label, color: t.ink2 }}>Logged</Text>
                    </View>
                  ) : isToday ? (
                    <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>Today</Text>
                  ) : (
                    <Icon name="chevron" size={16} color={t.ink3} />
                  )}
                </Pressable>
              </View>
            );
          })}
        </Section>

        <Rule />

        <Section>
          {/* Says what the rows above it say. A plan with no day landing in this
              week gets its own sentence rather than "runs 0 training days a
              week", which reads as a plan that asks nothing of anybody. */}
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            {trainingDays === 0
              ? 'None of this program\u2019s days fall in this week. Tap any day to open Train and log a session anyway.'
              : `This program runs ${trainingDays} training day${trainingDays === 1 ? '' : 's'} a week. Tap any day to open Train and log it.`}
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
