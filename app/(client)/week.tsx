// Client · This Week. The week's training plan at a glance — each day's planned
// focus (coach or auto program) and whether it's been logged. Profile hub.
//
// On the instrument-panel kit (`src/ui/kit`) and the scale (`src/theme/scale`).
// Seven days is a list, so the screen leads with no hero: hairline-separated
// rows instead of seven bordered cards. Every provider, computation and route is
// preserved.
import { View, Text, Pressable, ScrollView } from 'react-native';
import { BRAND } from '../../src/lib/brands';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useNow } from '../../src/ui/today';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, type as ty, value } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useCallback } from 'react';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { buildProgram } from '../../src/lib/programs';
import { scheduledDay } from '../../src/lib/checklist';
// Which week of the block this is. The seven rows below are a WEEK of a
// programme, and until now they were always week one of it — so a member on a
// twelve week block read the same seven rows for twelve weeks while their coach
// looked at eleven more they had written. See src/lib/clientBlock.ts.
import { useClientWeek } from '../../src/ui/clientWeek';
import { clientWeekLine } from '../../src/lib/clientBlock';
import { weekLabel } from '../../src/lib/programBlock';
import { WEEK_DAYS, jsDayForIndex, startOfWeek, weekIndexOf } from '../../src/lib/weekStart';
import { BACK_ICON, FORWARD_ICON } from '../../src/ui/direction';
// Which of the movements the plan names have actually appeared in the log.
// `planVsActual` has done this arithmetic since it was written and its only
// reader was the coach's client-training screen; `myPlanWeek` is the member's
// side of the same sentence. See src/lib/myPlanWeek.ts.
import { planVsActual } from '../../src/lib/planVsActual';
import { myPlanWeek, allLoggedNote } from '../../src/lib/myPlanWeek';
// How far back the log read actually reached, which is what makes "not logged"
// an honest claim under a truncated read rather than a guess.
import { readBoundary } from '../../src/lib/sessionHistory';
import { dayKeyOf } from '../../src/lib/entryEdit';

/** The seven rows, in the order src/lib/weekStart.ts draws a week. `WEEK[i]`
 *  and `jsDayForIndex(i)` are the label and the weekday of the same row, which
 *  is the pairing this screen used to keep by hand and got wrong once. */
const WEEK = WEEK_DAYS;

export default function ThisWeek() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { getProgram, status: programStatus, reload: reloadPrograms, cachedNote } = useAssignedPrograms();
  const coachProgram = getProgram(c.id);
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  // What the coach assigned, what has been trained against it, and the profile
  // the generic fallback programme is built from. A programme assigned this
  // morning was invisible here until the app was killed.
  const pull = usePullToRefresh(useCallback(() => {
    reloadPrograms(); reloadLog(); c.reload();
  }, [reloadPrograms, reloadLog, c.reload]));
  // Under 'error' a null from getProgram means "we could not find out", not
  // "your coach has not assigned you one" — and which of the two it is decides
  // what the client trains all week. The `??` below fell through to the generic
  // auto program in both cases, and the header prints the "· coach plan" suffix
  // only when `coachProgram` is set, so the substitution arrived looking exactly
  // like a client who has no coach plan: a bespoke plan replaced by a generic
  // one, with nothing on the screen to prompt a second look.
  //
  // 'loading' is not "known" either. The provider starts at 'loading' under
  // Supabase (src/ui/assignedPrograms.tsx), so the first frame drew seven days
  // of a generated programme under "The Plan" with nothing said — and a member
  // glancing at their week has usually looked away before the real one lands.
  // 'partial' is the third: the page came back at the row cap, so their
  // assignment may have been on the part we never read. Anything that is not
  // 'ready' is a null we cannot read as "no coach plan".
  const programUnknown = coachProgram == null && programStatus !== 'ready';
  const program = coachProgram ?? buildProgram(c.goal, c.bodyFatPct);
  // The week they are on, and its days. Identical to `program.days` for every
  // one-week programme, which is every programme this app generates and every
  // one written before blocks existed.
  const blk = useClientWeek(program, c.id);
  const blockLine = clientWeekLine(blk.week, blk.week.index);
  const thisWeek = blk.weeks[blk.week.index] ?? null;

  // ── the day, kept current ──────────────────────────────────────────────
  //
  // These two were `new Date()` and `startOfWeek()` in the render body, which
  // src/ui/today.ts rules on directly: "A bare todayKey() in the render body is
  // correct and does not re-render: it is only right at the moment something
  // else happens to redraw. A screen sitting untouched at 23:59 is exactly the
  // case that matters." Nothing on this screen redraws at midnight — it imports
  // no focus effect and the pull only fires on a pull — and expo-router mounts
  // these once and never tears them down.
  //
  // So on a phone left open across a Saturday night, a screen titled "This
  // Week" went on marking Saturday as "Today", drew last week's seven dates,
  // and judged what had been logged against a week that had ended. `useNow`
  // re-reads at the next local midnight, whenever the app comes back to the
  // foreground, and on every focus — which are the three moments this screen is
  // actually being looked at.
  const now = useNow();
  const todayIdx = weekIndexOf(now);
  const weekOpened = startOfWeek(now);
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
  const rows = WEEK.map((label, i) => ({ label, i, day: scheduledDay(blk.days, jsDayForIndex(i)) }));
  // The number of days the member will actually see a session on — not
  // `program.days.length`, which counts days the plan names but this week does
  // not place (a coach program whose day fell outside Mon–Sun would be counted
  // and never drawn).
  const trainingDays = rows.filter((r) => r.day).length;

  /* ── what the plan names, against what the log holds ────────────────────
   *
   * The seven rows above mark a day "Logged" when ANYTHING was logged on it,
   * which is a different claim from the one a member actually wants: whether
   * the movements their coach wrote are the movements they have been doing. A
   * member can be marked Logged on all three training days for a month and not
   * have touched a prescribed leg movement, and nothing on this screen would
   * have said so.
   *
   * Seven days, rolling. A rolling week always contains one of every weekday,
   * so the comparison is as fair on a Tuesday as on a Sunday — which a
   * Sunday-to-today window would not be, and a member two days into their week
   * reading "1 of 6" would be reading a number about the calendar rather than
   * about themselves.
   *
   * `days` is null while the coach programme is unknown. The plan drawn above
   * is then the generated one and may be about to be replaced, so comparing
   * against it would measure somebody's week against a programme they may not
   * be on — `programUnknown` is the flag the banner at the top already uses for
   * exactly that doubt.
   */
  const PLAN_WINDOW_DAYS = 7;
  const pva = planVsActual({
    days: programUnknown ? null : blk.days,
    programStatus,
    // Null under 'error', which the module requires: an empty array must never
    // be able to arrive there meaning both "nothing logged" and "not read".
    log: logStatus === 'error' ? null : log,
    logStatus,
    todayISO: dstr(now),
    // Only consulted under a truncated read — a whole one covers the window by
    // definition. `readBoundary` is the existing reader for "how far back does
    // this screen honestly see", and it is given `truncated` rather than a
    // guess so a member under the row cap has no boundary claimed about them.
    oldestDay: dayKeyOf(readBoundary(log.map((l) => ({ startsAt: l.t })), logStatus === 'partial').oldestISO),
    windowDays: PLAN_WINDOW_DAYS,
  });
  const planCheck = myPlanWeek(pva, PLAN_WINDOW_DAYS);
  const allLogged = allLoggedNote(planCheck, PLAN_WINDOW_DAYS);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }} numberOfLines={1}>{program.title}{coachProgram ? ' · coach plan' : ''}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>This Week</Text>
          </View>
        </View>

        {/* ── whose copy of the coach's plan this is ──────────────────────
            Non-null for exactly as long as the phone's own copy is what is
            drawn — `mayServeCached` in src/ui/assignedPrograms.tsx decides
            that, and the note carries the age — so it needs no gating of its
            own and disappears the moment a live read lands.
            
            It is here rather than left unsaid because the horizon on that
            cache is THIRTY DAYS. A member reading a month-old block as their
            current one trains the wrong week, and a coach who reassigned them
            a fortnight ago has no way to know why. The same sentence sits over
            the timetable on app/(client)/classes.tsx, for the same reason. */}
        {cachedNote ? <Flag tone={t.warn} style={{ marginTop: sp.lg }}>{cachedNote}</Flag> : null}

        {programUnknown ? (
          <View style={{ marginTop: sp.lg }}>
            {programStatus === 'loading' ? (
              <Notice tone={t.ink3} kicker="This week" title="Still checking for a coach plan"
                note={`The week below is ${BRAND.label}'s automatic program. If your coach has assigned you one it takes over as soon as it lands.`} />
            ) : (
              <Notice tone={t.warn} kicker="This week" title="We couldn’t check for a coach plan"
                note={`The week below is ${BRAND.label}'s automatic program. If your coach has assigned you one it takes over as soon as we can read it — open this screen again when you have signal.`} />
            )}
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
        ) : logStatus === 'partial' ? (
          /* The other status that produces the same unmarked week, and the one
             that used to fall through this gate in silence. A truncated log is
             short of exactly the entries the cap dropped, and the dots go
             missing with nothing on screen to explain them — which is the same
             cost as a failed read, arrived at from a read that succeeded. Its
             own sentence, because "we could not read it" and "we could not read
             all of it" are two different things to be told. */
          <View style={{ marginTop: sp.lg }}>
            <Notice tone={t.warn} kicker="This week" title="We couldn’t read your whole training log"
              note="You have more history than we can read at once, so some days you trained may not be marked below. Nothing has been lost." />
          </View>
        ) : null}

        <Section>
          <SectionHead title="The Plan" note={trainingDays === 0 ? 'No days scheduled' : `${trainingDays} training day${trainingDays === 1 ? '' : 's'} a week`} />

          {/* Which week of the block these seven days are, and the sentence
              saying why that one. Nothing at all for a one-week programme, so a
              plan written before blocks existed reads exactly as it did. The
              week is not tappable here: Train is where a member moves through
              the block, and two screens offering the same control is two places
              for them to disagree about which week is open. */}
          {blk.weeks.length > 1 ? (
            <View style={{ marginBottom: sp.lg }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{weekLabel(thisWeek, blk.week.index + 1)}</Text>
              {blockLine ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{blockLine}</Text> : null}
              {thisWeek?.note ? (
                <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.xs }}>{thisWeek.note}</Text>
              ) : null}
            </View>
          ) : null}

          {rows.map(({ label, i, day: workout }) => {
            const date = new Date(weekOpened); date.setDate(weekOpened.getDate() + i);
            const isToday = i === todayIdx;
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
                    <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
                  )}
                </Pressable>
              </View>
            );
          })}
        </Section>

        <Rule />

        {/* ── the plan, against the record ────────────────────────────────
            The rows above answer "did I train"; this answers "did I train
            THIS". Every figure comes out of `planVsActual`, so the member's
            screen and their coach's cannot come to disagree about the same
            week — and every refusal that module makes is kept: movements
            rather than sessions, no percentage, and "we could not tell" never
            wearing the face of "you did not do it".

            'no-programme' never fires from here, because the plan drawn above
            is always a plan; the branch is kept in the module for a caller
            that has none. */}
        <Section>
          <SectionHead title="Against the Plan" note={`Last ${PLAN_WINDOW_DAYS} days`} />
          <Text style={{ ...ty.body, color: t.ink }}>{planCheck.note}</Text>
          {allLogged ? (
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{allLogged}</Text>
          ) : null}
          {planCheck.kind === 'ready' ? (
            <>
              {/* Marked, not coloured. The words carry it; the dot is the
                  mark, because a status hue as text ink does not clear the
                  contrast running prose needs. */}
              {planCheck.missingNote ? (
                <View style={{ marginTop: sp.md }}>
                  <Flag tone={t.warn}>{planCheck.missingNote}</Flag>
                </View>
              ) : null}
              {/* Never folded into the line above it. "You have not done these"
                  and "we could not tell" are two different things to be told,
                  and the tri-state on `Coverage` exists so they stay two. */}
              {planCheck.unansweredNote ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{planCheck.unansweredNote}</Text>
              ) : null}
              {planCheck.offPlanNote ? (
                <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{planCheck.offPlanNote}</Text>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{planCheck.caveat}</Text>
            </>
          ) : null}
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
