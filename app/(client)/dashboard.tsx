// Client · Home — the daily briefing: readiness, today's session, body stats,
// weight trend, fuel, this week, and the things that need attention.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: one hero figure instead
// of four competing 20px numbers, hairline-separated sections instead of eleven
// stacked bordered cards, and a card spent only on the thing you can act on.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import {
  Rule, Section, SectionHead, Hero, KpiRow, ActionCard, ListRow,
  Cta, Ghost, QuickRow, Meter, Spark, WeekDots, Notice, Card,
} from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric, value } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { macrosFor, applyCoachAdjust } from '../../src/lib/nutrition';
import { buildProgram } from '../../src/lib/programs';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useCoachFeedback } from '../../src/ui/feedback';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { useAnnouncements } from '../../src/ui/announcements';
import { useHabits } from '../../src/ui/habits';
import { useWellness } from '../../src/ui/wellness';
import { readinessScore } from '../../src/lib/readiness';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARD_KEY } from './onboarding';
import { useSessions } from '../../src/ui/sessions';
import { useInvites } from '../../src/ui/invites';
import { useFoodLog } from '../../src/ui/foodLog';
import { useWearables } from '../../src/ui/wearables';
import { currentStreak, weekStats, personalRecords, streakRisk, freezeBudget, currentStreakFrozen } from '../../src/lib/streaks';
import { severeSummary } from '../../src/lib/injuries';
import { scheduleLocal, pushAvailable } from '../../src/ui/pushNotifications';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log } = useWorkoutLog();
  const coachProgram = useAssignedPrograms().getProgram(c.id);
  const nutriAdjust = useCoachNutrition().get(c.id);
  const coachNotes = useCoachFeedback().getFeedback(c.id);
  const ann = useAnnouncements().latest;
  const { water, waterGoal, addWater, removeWater } = useHabits();
  const { sleep } = useWellness();
  const _recentSleep = sleep.slice(0, 3);
  // No sleep logged means no readiness score. This used to fall back to 7 hours,
  // which awards 43.75 of the 50 sleep points - so a brand-new account with zero
  // inputs opened on ~64/100 'Moderately recovered' and a tip telling them how to
  // train, all of it computed from a literal.
  const _avgSleep = _recentSleep.length ? _recentSleep.reduce((a, x) => a + x.hours, 0) / _recentSleep.length : null;
  const _hasReadiness = _avgSleep != null;
  const _since2d = Date.now() - 2 * 86400000;
  const _load2d = new Set(log.filter((e) => Date.parse(e.t) >= _since2d).map((e) => e.t.slice(0, 10))).size;
  const readiness = readinessScore({ avgSleepHours: _avgSleep ?? 0, hydrationPct: waterGoal ? water / waterGoal : 0, workoutsLast2Days: _load2d });
  const readinessColor = readiness.tone === 'good' ? t.brand : readiness.tone === 'moderate' ? t.warn : t.crit;
  const [needsOnboard, setNeedsOnboard] = useState(false);
  useFocusEffect(useCallback(() => { let c = false; (async () => { try { const v = await AsyncStorage.getItem(ONBOARD_KEY); if (!c) setNeedsOnboard(!v); } catch { /* ignore */ } })(); return () => { c = true; }; }, []));
  const { sessions } = useSessions();
  const { received: myInvites, acceptInvite: acceptCoachInvite, declineInvite: declineCoachInvite } = useInvites();
  const foodToday = useFoodLog().consumed;
  const burnedToday = useWearables().today.activeKcal || 0;

  const solo = c.coachingMode === 'solo';
  const online = c.coachingMode === 'online';
  const inperson = c.coachingMode === 'inperson';
  const program = (solo ? null : coachProgram) ?? buildProgram(c.goal, c.bodyFatPct);
  const jsToMon = (new Date().getDay() + 6) % 7;
  const workout = program.days[jsToMon % program.days.length] || program.days[0] || { focus: 'Rest day', exercises: [] };

  const freezes = freezeBudget(log);
  const frz = currentStreakFrozen(log, freezes);
  const streak = frz.streak;
  const risk = streakRisk(log);
  const protectedTonight = risk.atRisk && freezes > 0;
  const sevInj = severeSummary(c.injuries);
  const remindTonight = async () => {
    const when = new Date(); when.setHours(19, 0, 0, 0);
    if (when.getTime() <= Date.now()) when.setTime(Date.now() + 60 * 60 * 1000);
    try { await scheduleLocal('Keep your streak alive', 'One session today keeps your ' + risk.streak + '-day streak going.', when, { route: '/(client)/workouts' }); } catch { /* ignore */ }
  };
  const wk = weekStats(log);
  const prs = personalRecords(log);
  const goalDays = program.days.length || 4;

  const macros = applyCoachAdjust(macrosFor({ weightKg: c.weightKg, bodyFatPct: c.bodyFatPct, activity: c.activity, goal: c.goal, diet: c.diet }), solo ? undefined : (nutriAdjust || undefined));
  // Real logged intake (shared with the Meals tab + Food Log); reflects what was actually eaten today.
  const consumed = { kcal: foodToday.kcal, p: foodToday.protein, cbs: foodToday.carbs, f: foodToday.fat };
  const _todayKey = new Date().toISOString().slice(0, 10);
  const trainedToday = log.some((e) => (e.t || '').slice(0, 10) === _todayKey);
  const kcalLeft = Math.max(0, macros.kcal + burnedToday - consumed.kcal);
  const today = readiness.tone === 'low'
    ? { headline: 'Recover today', tip: 'Under-recovered — keep it light or take a rest day.', cta: 'Recovery', route: '/(client)/recovery', tone: t.warn }
    : !trainedToday
    ? { headline: 'Ready to train', tip: readiness.tip, cta: 'Start workout', route: '/(client)/workouts', tone: t.brand }
    : kcalLeft > 200
    ? { headline: 'Fuel up', tip: kcalLeft + ' kcal left today' + (burnedToday > 0 ? ' (incl. ' + burnedToday + ' burned)' : '') + '.', cta: 'Log a meal', route: '/(client)/nutrition', tone: t.brand }
    : { headline: 'On track', tip: 'Session done and your macros are on point. Nice work.', cta: 'View plan', route: '/(client)/nutrition', tone: t.brand };

  const ws = c.weightSeries.map((x) => x.v);
  const scSort = [...c.scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const scPrev = scSort.length > 1 ? scSort[scSort.length - 2] : null;
  const scLast = scSort[scSort.length - 1];
  const bfD = scPrev && scLast ? +(scLast.bodyFatPct - scPrev.bodyFatPct).toFixed(1) : 0;
  const muD = scPrev && scLast ? +(scLast.skeletalMuscleKg - scPrev.skeletalMuscleKg).toFixed(1) : 0;
  const wDelta = ws.length > 1 ? +(ws[ws.length - 1] - ws[0]).toFixed(1) : 0;

  const now = Date.now();
  const nextSession = sessions
    .filter((sx) => sx.status === 'booked' && sx.clientId === c.id && Date.parse(sx.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

  const d = new Date();
  const hi = d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const firstName = (c.name || '').trim().split(' ')[0] || '';
  const kcalNote = `${consumed.kcal.toLocaleString()} of ${macros.kcal.toLocaleString()} kcal`;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{DAYS[d.getDay()]} {d.getDate()} {MONTHS[d.getMonth()]}</Text>
            {/* A client who has not finished onboarding has no name yet — don't
                render "Good morning," with a dangling comma and nothing after it. */}
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }} numberOfLines={1}>
              {firstName ? `${hi}, ${firstName}` : hi}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: 2 }}>
            <Ghost icon="search" label={undefined} onPress={() => router.push('/(client)/explore')} />
            <View>
              <Ghost icon="bell" onPress={() => router.push('/(client)/messages')} />
              {(coachNotes.length > 0 || !!ann) ? (
                <View style={{ position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderRadius: 5, backgroundColor: t.brand, borderWidth: 2, borderColor: t.bg }} />
              ) : null}
            </View>
          </View>
        </View>

        {/* ── interrupts: things that need a decision now ─────────────────── */}
        <View style={{ marginTop: sp.lg }}>
          {needsOnboard ? (
            <Card onPress={() => router.push('/(client)/onboarding')} tone={t.brand} style={{ marginBottom: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <Icon name="sparkle" size={20} color={t.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Personalise your plan</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>One minute — tailors your workouts and meals to you.</Text>
                </View>
                <Icon name="chevron" size={16} color={t.ink3} />
              </View>
            </Card>
          ) : null}

          {sevInj ? (
            <Notice tone={t.crit} kicker="From your coach" title="Your plan is adjusted for your injury"
              note={`I've eased off ${sevInj.groups.join(' & ').toLowerCase()} while your ${sevInj.areas.join(' & ').toLowerCase()} ${sevInj.areas.length > 1 ? 'are' : 'is'} severe — risky moves are swapped or paused. Let's train safely around it.`}>
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 2 }}><Cta label="Get a safe plan" wide onPress={() => router.push('/(client)/coach?ask=injury')} /></View>
                <View style={{ flex: 1 }}><Ghost label="Update" onPress={() => router.push('/(client)/injuries')} /></View>
              </View>
            </Notice>
          ) : null}

          {risk.atRisk ? (
            <Notice tone={protectedTonight ? t.brand : t.warn}
              kicker={protectedTonight ? 'Streak protected' : 'Streak at risk'}
              title={protectedTonight ? `A freeze is holding your ${risk.streak}-day streak` : `Your ${risk.streak}-day streak is on the line`}
              note={protectedTonight
                ? `${freezes} freeze${freezes > 1 ? 's' : ''} in reserve — tonight is covered, but training keeps it growing.`
                : 'Log one session today to keep it alive.'}>
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}><Cta label="Start now" wide onPress={() => router.push('/(client)/workouts')} /></View>
                {pushAvailable() ? <View style={{ flex: 1 }}><Ghost label="Remind me tonight" onPress={remindTonight} /></View> : null}
              </View>
            </Notice>
          ) : null}

          {myInvites.length > 0 ? (
            <Notice tone={t.brand} kicker={`Coaching invitation${myInvites[0].demo ? ' · sample' : ''}`}
              title={`${myInvites[0].coachName || 'A coach'} invited you`}
              note={`${myInvites[0].mode === 'inperson' ? 'In-person' : 'Online'} coaching. Accept to connect.`}>
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}><Ghost label="Decline" onPress={() => declineCoachInvite(myInvites[0].id)} /></View>
                <View style={{ flex: 2 }}>
                  <Cta label="Accept" wide onPress={async () => { const iv = myInvites[0]; const m = await acceptCoachInvite(iv.id); c.setCoachingMode(m); }} />
                </View>
              </View>
            </Notice>
          ) : null}
        </View>

        {/* ── the hero: one number leads the screen ───────────────────────── */}
        <Hero
          label="Readiness"
          figure={_hasReadiness ? String(readiness.score) : '—'}
          unit={_hasReadiness ? '/100' : undefined}
          note={_hasReadiness ? readiness.tip : 'Log a night of sleep to see your readiness.'}
          arc={_hasReadiness ? readiness.score / 100 : undefined}
          tone={_hasReadiness ? readinessColor : undefined}
          onPress={() => router.push('/(client)/recovery')}
        />

        <Rule />

        {/* ── the one card: today's action ────────────────────────────────── */}
        <Section>
          {/* The header follows the card. When the adaptive call is "fuel up" or
              "recover", naming today's muscle group here made the header and the
              card underneath talk about two different things. */}
          <SectionHead
            title={today.route.includes('workouts') ? `Today · ${workout.focus}` : 'Today'}
            note={`${wk.workouts} of ${goalDays} this week`}
          />
          <ActionCard
            ring={goalDays ? wk.workouts / goalDays : 0}
            ringLabel={String(streak)}
            title={today.headline}
            note={today.tip}
            cta={today.cta}
            tone={today.tone}
            onPress={() => router.push(today.route as any)}
          />
        </Section>

        <Rule />

        {/* ── body ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Body" note="Scans" onPress={() => router.push('/(client)/scans')} />
          <KpiRow
            onPress={() => router.push('/(client)/scans')}
            items={[
              { label: 'Weight', value: String(c.weightKg), unit: 'kg', route: '/(client)/scans', good: wDelta <= 0, delta: wDelta !== 0 ? `${wDelta < 0 ? '−' : '+'}${Math.abs(wDelta)} kg` : undefined },
              { label: 'Body fat', value: String(c.bodyFatPct), unit: '%', route: '/(client)/scans', good: bfD <= 0, delta: bfD !== 0 ? `${bfD < 0 ? '−' : '+'}${Math.abs(bfD)}` : undefined },
              { label: 'Muscle', value: String(c.muscleKg), unit: 'kg', route: '/(client)/scans', good: muD >= 0, delta: muD !== 0 ? `${muD < 0 ? '−' : '+'}${Math.abs(muD)}` : undefined },
            ]}
          />
        </Section>

        {/* ── weight trend ───────────────────────────────────────────────── */}
        {ws.length > 1 ? (<>
          <Rule />
          <Section>
            <SectionHead title={`Weight · ${ws.length} check-ins`}
              note={`${wDelta > 0 ? '+' : wDelta < 0 ? '−' : ''}${Math.abs(wDelta)} kg`}
              onPress={() => router.push('/(client)/scans')} />
            <Spark data={ws} />
          </Section>
        </>) : null}

        <Rule />

        {/* ── fuel ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Fuel today" note={kcalNote} onPress={() => router.push('/(client)/nutrition')} />
          <Meter label="Protein" val={consumed.p} target={macros.protein} />
          <Meter label="Carbs" val={consumed.cbs} target={macros.carbs} dim />
          <Meter label="Fat" val={consumed.f} target={macros.fat} dim />
        </Section>

        <Rule />

        {/* ── water ──────────────────────────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Water</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 5 }}>
                <Text style={{ ...value(22), color: t.ink }}>{water}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginLeft: 3 }}>of {waterGoal} glasses</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Pressable accessibilityLabel="Remove a glass of water" accessibilityRole="button" onPress={removeWater}
                style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="minus" size={16} color={t.ink2} />
              </Pressable>
              <Pressable accessibilityLabel="Add a glass of water" accessibilityRole="button" onPress={addWater}
                style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" size={16} color={t.brandInk} />
              </Pressable>
            </View>
          </View>
        </Section>

        <Rule />

        {/* ── this week ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="This week" note="All activity" onPress={() => router.push('/(client)/trends')} />
          <KpiRow items={[
            { label: 'Sessions', value: String(wk.workouts), unit: `/${goalDays}` },
            { label: 'Lifted', value: Math.round(wk.volumeKg).toLocaleString(), unit: 'kg' },
            { label: 'New PRs', value: String(prs.length) },
          ]} />
          <WeekDots done={wk.days} />
        </Section>

        <Rule />

        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          {(online || inperson) ? (
            <ListRow icon="calendar"
              title={nextSession
                ? `Next session · ${new Date(nextSession.startsAt).toLocaleDateString(undefined, { weekday: 'short' })} ${(() => { let h = new Date(nextSession.startsAt).getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${ap}`; })()}`
                : 'No sessions booked'}
              note={nextSession
                ? `${inperson ? 'In-person' : 'Online'} · ${nextSession.durationMin} min with your coach`
                : `Tap to book ${inperson ? 'an in-person session' : 'with your coach'}`}
              onPress={() => router.push('/(client)/calendar')} />
          ) : null}

          <ListRow icon="trophy" title="Challenges" note="Track your progress against the goal"
            onPress={() => router.push('/(client)/challenges')} />

          {solo ? (
            <ListRow icon="people" title="Work with a coach" note="Browse trainers · online or in-person"
              onPress={() => router.push('/(client)/trainers')} />
          ) : null}
        </Section>

        {/* ── coach note ─────────────────────────────────────────────────── */}
        {(!solo && (coachNotes.length > 0 || !!ann)) ? (<>
          <Rule />
          <Section>
            <SectionHead title="From your coach" />
            {coachNotes.length > 0 ? (
              <Text style={{ ...ty.body, color: t.ink2 }} numberOfLines={4}>{coachNotes[0].body}</Text>
            ) : null}
            {ann ? (
              <Text style={{ ...ty.body, color: t.ink2, marginTop: coachNotes.length > 0 ? sp.md : 0 }}>{ann.body}</Text>
            ) : null}
          </Section>
        </>) : null}

        <Rule />

        {/* ── quick actions ──────────────────────────────────────────────── */}
        <Section>
          <QuickRow items={[
            { icon: 'plus', label: 'Log', onPress: () => router.push('/(client)/workouts') },
            { icon: 'meals', label: 'Food', onPress: () => router.push('/(client)/foodlog') },
            (online || inperson)
              ? { icon: 'calendar' as const, label: 'Book', onPress: () => router.push('/(client)/calendar') }
              : { icon: 'chart' as const, label: 'Report', onPress: () => router.push('/(client)/report') },
            { icon: 'camera', label: 'Photo', onPress: () => router.push('/(client)/scans') },
          ]} />
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
