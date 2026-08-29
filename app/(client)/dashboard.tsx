// Client · Home — the daily briefing: readiness, today's session, body stats,
// weight trend, fuel, this week, and the things that need attention.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: one hero figure instead
// of four competing 20px numbers, hairline-separated sections instead of eleven
// stacked bordered cards, and a card spent only on the thing you can act on.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, ActionCard, ListRow, Cta, Ghost, QuickRow, Meter, Spark, WeekDots, Notice, Card, fig } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric, value } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { macrosFor, applyCoachAdjust } from '../../src/lib/nutrition';
import { buildProgram } from '../../src/lib/programs';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightDeltaIn, kgToLb, type WeightUnit } from '../../src/lib/units';
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
import { booksInPerson, coachedRemotely, COACHED_MODE_SHORT, COACHING_MODE_NOTE } from '../../src/lib/types';
import { scheduleLocal, pushAvailable } from '../../src/ui/pushNotifications';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];


export default function Home() {
  const t = useTheme();
  // The unit this client reads weight in. Storage stays metric; this is only
  // ever applied on the way to the screen (TF-37).
  const wu = useSettings().weightUnit;
  const router = useRouter();
  const c = useClientData();
  const { log, status: logStatus } = useWorkoutLog();
  const { getProgram, status: programStatus } = useAssignedPrograms();
  const coachProgram = getProgram(c.id);
  // Under 'error' an empty log means the history could not be read, not that
  // there is none — so the streak, the week's session count and the PR count
  // below are unknowns rather than zeroes. This is the first screen of the app,
  // and "0 of 4 this week" over a broken streak is the first thing a client who
  // trained four times would read about their own week.
  const logKnown = logStatus !== 'error';
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
  const _since2d = Date.now() - 2 * 86400000;
  const _load2d = new Set(log.filter((e) => Date.parse(e.t) >= _since2d).map((e) => e.t.slice(0, 10))).size;
  // `?? 0` was the bug: no sleep logged became zero hours slept, which scored 20
  // and read as 'Under-recovered'. Nulls now travel as nulls, and readinessScore
  // returns null rather than a number nobody's data supports.
  const readiness = readinessScore({
    avgSleepHours: _avgSleep ?? null,
    hydrationPct: waterGoal ? water / waterGoal : null,
    workoutsLast2Days: _load2d,
  });
  const readinessColor = readiness == null ? t.ink3 : readiness.tone === 'good' ? t.brand : readiness.tone === 'moderate' ? t.warn : t.crit;
  const [needsOnboard, setNeedsOnboard] = useState(false);
  useFocusEffect(useCallback(() => { let c = false; (async () => { try { const v = await AsyncStorage.getItem(ONBOARD_KEY); if (!c) setNeedsOnboard(!v); } catch { /* ignore */ } })(); return () => { c = true; }; }, []));
  const { sessions } = useSessions();
  // `status` is read, not discarded. useInvites documents that under 'error' an
  // empty `received` means the check did not happen — not that nobody invited
  // you — and this screen used to take the empty list at face value. A coach
  // would add a client, the client's home screen would show no invitation and
  // no reason for its absence, and both sides concluded the other had failed.
  // Reported four separate times from two apps.
  const {
    received: myInvites, status: invitesStatus,
    acceptInvite: acceptCoachInvite, declineInvite: declineCoachInvite,
  } = useInvites();
  const foodToday = useFoodLog().consumed;
  const burnedToday = useWearables().today.activeKcal || 0;

  const solo = c.coachingMode === 'solo';
  // What the coaching answer actually decides on this screen.
  //
  // It decided nothing before TF-30: `online || inperson` gated the booking row
  // and the Book action, so the two produced an identical home screen and the
  // only difference between them anywhere in the app was the noun printed in a
  // caption. A tester picked one, then the other, and correctly reported that
  // nothing had happened.
  //
  // `booksInPerson` — the booking calendar is in-person by construction (see
  // the header of calendar.tsx), so an online-only client was being offered
  // slots in a room they are never in. `coachedRemotely` — a coach who is not
  // there only learns how the week went if the client writes it down, so the
  // weekly check-in leads for them instead. Hybrid is both, which is the whole
  // point of the option: sessions to book AND a check-in for the weeks between.
  const booksSessions = booksInPerson(c.coachingMode);
  const remoteCoached = coachedRemotely(c.coachingMode);
  // Same `??` as This Week: a coached client whose assignment could not be read
  // gets the generic auto program in its place, titled and laid out exactly like
  // a plan their coach wrote. Nothing on the screen distinguished the two, so
  // the client trains the wrong session and has no reason to look twice.
  const programUnknown = !solo && programStatus === 'error' && coachProgram == null;
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

  // null until there is a body to scale to. This used to run on the 70 kg /
  // 20% placeholder from clientData and present the result as the client's
  // own daily targets.
  const macros = (c.weightKg != null && c.bodyFatPct != null)
    ? applyCoachAdjust(macrosFor({ weightKg: c.weightKg, bodyFatPct: c.bodyFatPct, activity: c.activity, goal: c.goal, diet: c.diet }), solo ? undefined : (nutriAdjust || undefined))
    : null;
  // Real logged intake (shared with the Meals tab + Food Log); reflects what was actually eaten today.
  const consumed = { kcal: foodToday.kcal, p: foodToday.protein, cbs: foodToday.carbs, f: foodToday.fat };
  const _todayKey = new Date().toISOString().slice(0, 10);
  const trainedToday = log.some((e) => (e.t || '').slice(0, 10) === _todayKey);
  const kcalLeft = macros ? Math.max(0, macros.kcal + burnedToday - consumed.kcal) : 0;
  // Only claim somebody is under-recovered when there is a score saying so.
  // Unknown readiness falls through to the ordinary prompts, which assert
  // nothing about their body.
  const today = readiness != null && readiness.tone === 'low'
    ? { headline: 'Recover today', tip: 'Under-recovered — keep it light or take a rest day.', cta: 'Recovery', route: '/(client)/recovery', tone: t.warn }
    : !trainedToday
    ? { headline: 'Ready to train', tip: readiness?.tip ?? 'Log tonight’s sleep and your readiness appears here.', cta: 'Start workout', route: '/(client)/workouts', tone: t.brand }
    : kcalLeft > 200
    ? { headline: 'Fuel up', tip: kcalLeft + ' kcal left today' + (burnedToday > 0 ? ' (incl. ' + burnedToday + ' burned)' : '') + '.', cta: 'Log a meal', route: '/(client)/nutrition', tone: t.brand }
    : { headline: 'On track', tip: 'Session done and your macros are on point. Nice work.', cta: 'View plan', route: '/(client)/nutrition', tone: t.brand };

  const ws = c.weightSeries.map((x) => x.v);
  // The same series in the unit this client reads in, converted point by point
  // because each point is a value rather than a change. The filter is only
  // there to satisfy the null contract of `weightIn` — a series entry is always
  // a number, and a null one would have no place on a trend line anyway.
  const wsShown = ws.map((v) => weightIn(v, wu)).filter((v): v is number => v != null);
  const scSort = [...c.scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const scPrev = scSort.length > 1 ? scSort[scSort.length - 2] : null;
  const scLast = scSort[scSort.length - 1];
  const bfD = scPrev && scLast ? +(scLast.bodyFatPct - scPrev.bodyFatPct).toFixed(1) : 0;
  // null unless BOTH scans reported muscle. Read as `?? 0` this used to turn a
  // scan that measured no muscle into a whole body's worth of change overnight.
  const muD = scPrev?.skeletalMuscleKg != null && scLast?.skeletalMuscleKg != null
    ? +(scLast.skeletalMuscleKg - scPrev.skeletalMuscleKg).toFixed(1) : null;
  const wDelta = ws.length > 1 ? +(ws[ws.length - 1] - ws[0]).toFixed(1) : 0;
  // The two body changes in the client's unit. They are converted here and the
  // sign is taken from the converted figure, so that a change too small to show
  // at this grain — 0.2 kg is under half a pound — is reported as no change
  // rather than printed as "−0 lb", the fabricated zero this screen already
  // refuses to show elsewhere. `good` deliberately keeps reading the metric
  // value: whether a change is in the right direction does not depend on units.
  // wDelta comes off the weight series and is always finite, so the null
  // branch of weightDeltaIn cannot be reached here.
  const wDeltaShown = weightDeltaIn(wDelta, wu) ?? 0;
  const muDShown = weightDeltaIn(muD, wu);

  const now = Date.now();
  const nextSession = sessions
    .filter((sx) => sx.status === 'booked' && sx.clientId === c.id && Date.parse(sx.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

  const d = new Date();
  const hi = d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  const firstName = (c.name || '').trim().split(' ')[0] || '';
  const kcalNote = macros ? `${consumed.kcal.toLocaleString()} of ${macros.kcal.toLocaleString()} kcal` : `${consumed.kcal.toLocaleString()} kcal eaten — add your weight for a target`;
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

          {myInvites.length === 0 && invitesStatus === 'error' ? (
            <Notice tone={t.warn} kicker="Coaching invitations"
              title="Could not check for invitations"
              note="This is not the same as having none. If a coach has invited you, it will appear here once this loads — pull down to try again." />
          ) : null}

          {myInvites.length > 0 ? (
            <Notice tone={t.brand} kicker={`Coaching invitation${myInvites[0].demo ? ' · sample' : ''}`}
              title={`${myInvites[0].coachName || 'A coach'} invited you`}
              note={`${COACHED_MODE_SHORT[myInvites[0].mode]} coaching. ${COACHING_MODE_NOTE[myInvites[0].mode]} Accept to connect.`}>
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.lg }}>
                <View style={{ flex: 1 }}><Ghost label="Decline" onPress={() => declineCoachInvite(myInvites[0].id)} /></View>
                <View style={{ flex: 2 }}>
                  <Cta label="Accept" wide onPress={async () => {
                    const iv = myInvites[0];
                    // Only switch coaching mode once the server actually made
                    // the link; a refused accept used to move the whole app
                    // into coached mode with no coach behind it.
                    const { mode, ok } = await acceptCoachInvite(iv.id);
                    if (!ok) { Alert.alert('Not connected yet', 'We could not link you to that coach. The invitation is still here — try again in a moment.'); return; }
                    c.setCoachingMode(mode);
                  }} />
                </View>
              </View>
            </Notice>
          ) : null}
        </View>

        {/* ── the hero: one number leads the screen ───────────────────────── */}
        <Hero
          label="Readiness"
          figure={readiness != null ? String(readiness.score) : '—'}
          unit={readiness != null ? '/100' : undefined}
          note={readiness != null ? readiness.tip : 'Log a night of sleep to see your readiness.'}
          arc={readiness != null ? readiness.score / 100 : undefined}
          tone={readiness != null ? readinessColor : undefined}
          onPress={() => router.push('/(client)/recovery')}
        />

        <Rule />

        {/* Said before the card, because the card is what the reader acts on. */}
        {programUnknown ? (
          <Notice tone={t.warn} kicker="Today" title="We couldn’t check for a coach plan"
            note="Today's focus below comes from Repple's automatic program. If your coach has assigned you one it takes over as soon as we can read it." />
        ) : null}
        {!logKnown ? (
          <Notice tone={t.warn} kicker="Today" title="We couldn’t read your training log"
            note="Your streak and this week's sessions are shown as dashes because we can't see them — not because they're zero. Nothing has been lost." />
        ) : null}

        {/* ── the one card: today's action ────────────────────────────────── */}
        <Section>
          {/* The header follows the card. When the adaptive call is "fuel up" or
              "recover", naming today's muscle group here made the header and the
              card underneath talk about two different things. */}
          <SectionHead
            title={today.route.includes('workouts') ? `Today · ${workout.focus}` : 'Today'}
            note={logKnown ? `${wk.workouts} of ${goalDays} this week` : undefined}
          />
          <ActionCard
            ring={logKnown && goalDays ? wk.workouts / goalDays : 0}
            ringLabel={logKnown ? String(streak) : fig(null)}
            // The number is a day streak and the ring is this week's sessions —
            // neither is about the meal this card is asking you to log.
            ringNote={logKnown ? (streak === 1 ? 'day streak' : 'day streak') : 'streak'}
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
              { label: 'Weight', value: fig(weightIn(c.weightKg, wu)), unit: wu, route: '/(client)/scans', good: wDelta <= 0, delta: wDeltaShown !== 0 ? `${wDeltaShown < 0 ? '−' : '+'}${Math.abs(wDeltaShown)} ${wu}` : undefined },
              // Body fat is a proportion of the body, not an amount of it, and
              // stays a percentage under every unit preference. Nothing on this
              // line converts.
              { label: 'Body fat', value: fig(c.bodyFatPct), unit: '%', route: '/(client)/scans', good: bfD <= 0, delta: bfD !== 0 ? `${bfD < 0 ? '−' : '+'}${Math.abs(bfD)}` : undefined },
              { label: 'Muscle', value: fig(weightIn(c.muscleKg, wu)), unit: wu, route: '/(client)/scans', good: muD != null ? muD >= 0 : undefined, delta: muDShown ? `${muDShown < 0 ? '−' : '+'}${Math.abs(muDShown)}` : undefined },
            ]}
          />
        </Section>

        {/* ── weight trend ───────────────────────────────────────────────── */}
        {ws.length > 1 ? (<>
          <Rule />
          <Section>
            <SectionHead title={`Weight · ${ws.length} check-ins`}
              note={`${wDeltaShown > 0 ? '+' : wDeltaShown < 0 ? '−' : ''}${Math.abs(wDeltaShown)} ${wu}`}
              onPress={() => router.push('/(client)/scans')} />
            <Spark data={wsShown} labels={c.weightSeries.map((x) => x.t)} unit={` ${wu}`} />
          </Section>
        </>) : null}

        <Rule />

        {/* ── fuel ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Fuel today" note={kcalNote} onPress={() => router.push('/(client)/nutrition')} />
          {macros ? (<>
            <Meter label="Protein" val={consumed.p} target={macros.protein} />
            <Meter label="Carbs" val={consumed.cbs} target={macros.carbs} dim />
            <Meter label="Fat" val={consumed.f} target={macros.fat} dim />
          </>) : null}
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
            { label: 'Sessions', value: logKnown ? fig(wk.workouts) : fig(null), unit: logKnown ? `/${goalDays}` : undefined },
            // `(0).toLocaleString()` is the string "0" — a tonnage stated as
            // measured, with no hint that nothing was measured.
            // Tonnage is a weight like any other — a client who loads the bar
            // in pounds should be told what they shifted in pounds. Rounded to
            // a whole unit either way, because nobody reads a week's volume to
            // the tenth.
            { label: 'Lifted', value: logKnown ? Math.round(wu === 'lb' ? kgToLb(wk.volumeKg) : wk.volumeKg).toLocaleString() : fig(null), unit: logKnown ? wu : undefined },
            { label: 'New PRs', value: logKnown ? fig(prs.length) : fig(null) },
          ]} />
          <WeekDots done={logKnown ? wk.days : 0} />
        </Section>

        <Rule />

        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          {/* `|| nextSession` because a booking is a fact, not a preference: a
              client who switches to online after booking is still expected in
              the room on Thursday, and hiding the row would be how they miss
              it. The row appears to show them what exists; only the invitation
              to book more is gated. */}
          {(booksSessions || nextSession) ? (
            <ListRow icon="calendar"
              title={nextSession
                ? `Next session · ${new Date(nextSession.startsAt).toLocaleDateString(undefined, { weekday: 'short' })} ${(() => { let h = new Date(nextSession.startsAt).getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${ap}`; })()}`
                : 'No sessions booked'}
              note={nextSession
                ? `In person · ${nextSession.durationMin} min with your coach`
                : 'Tap to book an in-person session'}
              onPress={() => router.push('/(client)/calendar')} />
          ) : null}

          {remoteCoached ? (
            <ListRow icon="message" title="Weekly check-in"
              note={booksSessions
                ? 'How the weeks you train alone went — your coach reads it'
                : 'How the week went — your coach only sees what you send'}
              onPress={() => router.push('/(client)/checkin')} />
          ) : null}

          <ListRow icon="clock" title="Your history" note="Every month you have trained, back to the start"
            onPress={() => router.push('/(client)/history')} />

          <ListRow icon="trophy" title="Challenges" note="Track your progress against the goal"
            onPress={() => router.push('/(client)/challenges')} />

          {solo ? (
            <ListRow icon="people" title="Work with a coach" note="Enter your coach's code, or browse trainers"
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
            // One slot, so it goes to whichever of the three this client
            // actually has: a session to book, a check-in to send, or — with
            // nobody to send it to — their own report.
            booksSessions
              ? { icon: 'calendar' as const, label: 'Book', onPress: () => router.push('/(client)/calendar') }
              : remoteCoached
                ? { icon: 'message' as const, label: 'Check-in', onPress: () => router.push('/(client)/checkin') }
                : { icon: 'chart' as const, label: 'Report', onPress: () => router.push('/(client)/report') },
            { icon: 'camera', label: 'Photo', onPress: () => router.push('/(client)/scans') },
          ]} />
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
