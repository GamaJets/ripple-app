// Client · Home — a dense daily briefing: today's plan, body stats, weight trend,
// nutrition, this week, next session, coach note, quick actions. Rebuilt on the
// palette theme + SVG icon set. Reads the live providers.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Icon, type IconName } from '../../src/ui/Icon';
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
import { currentStreak, weekStats, personalRecords, streakRisk } from '../../src/lib/streaks';
import { severeSummary } from '../../src/lib/injuries';
import { scheduleLocal, pushAvailable } from '../../src/ui/pushNotifications';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Ring({ t, frac, center, label, size = 78 }: { t: Theme; frac: number; center: string; label: string; size?: number }) {
  const r = 34, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, frac)));
  return (
    <Svg width={size} height={size} viewBox="0 0 90 90">
      <Circle cx="45" cy="45" r={r} fill="none" stroke={t.surface3} strokeWidth={9} />
      <Circle cx="45" cy="45" r={r} fill="none" stroke={t.brand} strokeWidth={9} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 45 45)" />
    </Svg>
  );
}

function Spark({ t, data, w = 250, h = 52 }: { t: Theme; data: number[]; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * (h - 8) - 4}`).join(' ');
  const lastX = w, lastY = h - ((data[data.length - 1] - min) / rng) * (h - 8) - 4;
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <Polyline points={pts} fill="none" stroke={t.brand} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={lastX} cy={lastY} r={3.5} fill={t.brand} />
    </Svg>
  );
}

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
  const _avgSleep = _recentSleep.length ? _recentSleep.reduce((a, x) => a + x.hours, 0) / _recentSleep.length : 7;
  const _since2d = Date.now() - 2 * 86400000;
  const _load2d = new Set(log.filter((e) => Date.parse(e.t) >= _since2d).map((e) => e.t.slice(0, 10))).size;
  const readiness = readinessScore({ avgSleepHours: _avgSleep, hydrationPct: waterGoal ? water / waterGoal : 0, workoutsLast2Days: _load2d });
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

  const streak = currentStreak(log);
  const risk = streakRisk(log);
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

  const macroBar = (label: string, val: number, tgt: number, col: string) => (
    <View style={{ marginTop: 9 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: t.ink3, fontSize: 11 }}>{label}</Text>
        <Text style={{ color: t.ink2, fontSize: 11, fontWeight: '700' }}>{val}/{tgt}g</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface3, marginTop: 4, overflow: 'hidden' }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: col, width: `${Math.min(100, Math.round((val / (tgt || 1)) * 100))}%` }} />
      </View>
    </View>
  );

  const stat = (label: string, val: string, delta: string, good: boolean, route?: string) => (
    <Pressable disabled={!route} onPress={() => route && router.push(route as any)} style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 13 }}>
      <Text style={{ color: t.ink3, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
      <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginTop: 3 }}>{val}</Text>
      {delta ? <Text style={{ color: good ? t.brand : t.ink3, fontSize: 11, fontWeight: '700' }}>{delta}</Text> : null}
    </Pressable>
  );

  const qa = (name: IconName, label: string, route: string) => (
    <Pressable onPress={() => router.push(route as any)} style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, paddingVertical: 14, alignItems: 'center', gap: 6 }}>
      <Icon name={name} size={20} color={t.brand} />
      <Text style={{ color: t.ink2, fontSize: 10, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 34 }} showsVerticalScrollIndicator={false}>

        {needsOnboard ? (
          <Pressable onPress={() => router.push('/(client)/onboarding')} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.brand, padding: 15, marginTop: 4, marginBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(45,212,191,0.15)', alignItems: 'center', justifyContent: 'center' }}><Icon name="sparkle" size={20} color={t.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Personalise your plan</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>1 minute — tailors your workouts &amp; meals to you.</Text>
            </View>
            <Text style={{ color: t.brand, fontWeight: '800', fontSize: 13 }}>Start ›</Text>
          </Pressable>
        ) : null}

        {/* header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 16 }}>
          <View>
            <Text style={{ color: t.ink3, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{DAYS[d.getDay()]} {d.getDate()} {MONTHS[d.getMonth()]} · {hi}</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 2, textTransform: 'capitalize' }}>{c.name.split(' ')[0]}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => router.push('/(client)/explore')} accessibilityLabel="Search" style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}><Icon name="search" size={20} color={t.ink2} /></Pressable>
          <Pressable onPress={() => router.push('/(client)/messages')} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bell" size={20} color={t.ink2} />
            {(coachNotes.length > 0 || !!ann) ? <View style={{ position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: t.brand, borderWidth: 2, borderColor: t.surface }} /> : null}
          </Pressable>
          </View>
        </View>

        {/* Today — one adaptive card */}
        <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: today.tone, padding: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: today.tone }} />
            <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }}>Today</Text>
          </View>
          <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>{today.headline}</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginTop: 3, lineHeight: 18 }}>{today.tip}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 12 }}>
            {([['Train', (wk.workouts) + '/' + goalDays, '/(client)/workouts'], ['Kcal left', kcalLeft.toLocaleString(), '/(client)/nutrition'], ['Readiness', String(readiness.score), '/(client)/recovery']] as const).map(([l, v, r]) => (
              <Pressable key={l} onPress={() => router.push(r as any)} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: 11, borderWidth: 1, borderColor: t.ring, paddingVertical: 9, alignItems: 'center' }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{v}</Text>
                <Text style={{ color: t.ink3, fontSize: 10, marginTop: 1 }}>{l}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => router.push(today.route as any)} style={{ backgroundColor: today.tone, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 14 }}>{today.cta}</Text>
          </Pressable>
        </View>

        {sevInj ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.crit, padding: 15, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}><Icon name="chat" size={17} color={t.brandInk} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Your coach</Text>
                <Text style={{ color: t.ink3, fontSize: 11 }}>Plan adjusted for your injury</Text>
              </View>
            </View>
            <Text style={{ color: t.ink2, fontSize: 13.5, lineHeight: 20 }}>I've eased off {sevInj.groups.join(' & ').toLowerCase()} while your {sevInj.areas.join(' & ').toLowerCase()} {sevInj.areas.length > 1 ? 'are' : 'is'} severe — risky moves are swapped or paused in your plan. Let's train safely around it.</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable onPress={() => router.push('/(client)/coach?ask=injury')} style={{ flex: 1, backgroundColor: t.brand, borderRadius: 11, paddingVertical: 12, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13.5 }}>Get a safe plan</Text></Pressable>
              <Pressable onPress={() => router.push('/(client)/injuries')} style={{ backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 13.5 }}>Update</Text></Pressable>
            </View>
          </View>
        ) : null}

        {risk.atRisk ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.s3, padding: 15, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(201,133,0,0.16)', alignItems: 'center', justifyContent: 'center' }}><Icon name="flame" size={22} color={t.s3} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>Your {risk.streak}-day streak is on the line</Text>
                <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 1 }}>Log one session today to keep it alive.</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable onPress={() => router.push('/(client)/workouts')} style={{ flex: 1, backgroundColor: t.s3, borderRadius: 11, paddingVertical: 12, alignItems: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13.5 }}>Start now</Text></Pressable>
              {pushAvailable() ? <Pressable onPress={remindTonight} style={{ flex: 1, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 11, paddingVertical: 12, alignItems: 'center' }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 13.5 }}>Remind me tonight</Text></Pressable> : null}
            </View>
          </View>
        ) : null}

        {myInvites.length > 0 ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.brand, padding: 14, marginBottom: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Icon name="sparkle" size={15} color={t.brand} />
              <Text style={{ color: t.brand, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>Coaching invitation{myInvites[0].demo ? ' · sample' : ''}</Text>
            </View>
            <Text style={{ color: t.ink, fontSize: 15, fontWeight: '800' }}>{myInvites[0].coachName || 'A coach'} invited you</Text>
            <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 2, marginBottom: 11 }}>{myInvites[0].mode === 'inperson' ? 'In-person' : 'Online'} coaching. Accept to connect.</Text>
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <Pressable onPress={() => declineCoachInvite(myInvites[0].id)} style={{ flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: 'center', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }}><Text style={{ color: t.ink2, fontWeight: '800', fontSize: 13 }}>Decline</Text></Pressable>
              <Pressable onPress={async () => { const iv = myInvites[0]; const m = await acceptCoachInvite(iv.id); c.setCoachingMode(m); }} style={{ flex: 2, paddingVertical: 11, borderRadius: 11, alignItems: 'center', backgroundColor: t.brand }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Accept</Text></Pressable>
            </View>
          </View>
        ) : null}

        {/* today's plan hero */}
        <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 11, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <Ring t={t} frac={wk.workouts / goalDays} center={String(streak)} label="STREAK" />
            <View style={{ position: 'absolute', alignItems: 'center' }}>
              <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800' }}>{streak}</Text>
              <Text style={{ color: t.ink3, fontSize: 8, letterSpacing: 0.5 }}>STREAK</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.brand, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>Today · {workout.focus}</Text>
            <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800', marginTop: 2 }}>{workout.exercises.length} exercises · ~{Math.max(20, workout.exercises.length * 9)} min</Text>
            <Pressable onPress={() => router.push('/(client)/workouts')} style={{ backgroundColor: t.brand, borderRadius: 11, paddingVertical: 10, alignItems: 'center', marginTop: 9, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
              <Icon name="play" size={15} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Start workout</Text>
            </Pressable>
          </View>
        </View>

        {/* body stats */}
        <View style={{ flexDirection: 'row', gap: 9, marginBottom: 11 }}>
          {stat('Weight', `${c.weightKg}`, wDelta !== 0 ? `${wDelta < 0 ? '▼' : '▲'} ${Math.abs(wDelta)} kg` : '—', wDelta <= 0, '/(client)/scans')}
          {stat('Body fat', `${c.bodyFatPct}%`, bfD !== 0 ? `${bfD < 0 ? '▼' : '▲'} ${Math.abs(bfD)}` : '—', bfD <= 0, '/(client)/scans')}
          {stat('Muscle', `${c.muscleKg}`, muD !== 0 ? `${muD < 0 ? '▼' : '▲'} ${Math.abs(muD)}` : '—', muD >= 0, '/(client)/scans')}
        </View>

        {/* weight trend */}
        {ws.length > 1 ? (
          <Pressable onPress={() => router.push('/(client)/scans')} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 11 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: t.ink3, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>Weight · {ws.length} check-ins</Text>
              <Text style={{ color: t.brand, fontSize: 11, fontWeight: '700' }}>{wDelta > 0 ? '+' : ''}{wDelta} kg</Text>
            </View>
            <Spark t={t} data={ws} />
          </Pressable>
        ) : null}

        {/* nutrition */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 11 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Pressable onPress={() => router.push('/(client)/nutrition')} hitSlop={6}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Today's nutrition ›</Text></Pressable>
            <Text style={{ color: t.ink3, fontSize: 12 }}><Text style={{ color: t.ink, fontWeight: '700' }}>{consumed.kcal.toLocaleString()}</Text> / {macros.kcal.toLocaleString()} kcal</Text>
          </View>
          {macroBar('Protein', consumed.p, macros.protein, t.brand)}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>{macroBar('Carbs', consumed.cbs, macros.carbs, t.s1)}</View>
            <View style={{ flex: 1 }}>{macroBar('Fat', consumed.f, macros.fat, t.s3)}</View>
          </View>
        </View>

        {/* readiness */}
        <Pressable onPress={() => router.push('/(client)/recovery')} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 11, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: readinessColor, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 17 }}>{readiness.score}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Readiness · {readiness.label}</Text>
            <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2, lineHeight: 16 }}>{readiness.tip}</Text>
          </View>
          <Icon name="chevron" size={18} color={t.ink3} />
        </Pressable>

        {/* water */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
            <Icon name="water" size={20} color={t.brand} />
            <View><Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Water</Text><Text style={{ color: t.ink3, fontSize: 12 }}>{water} / {waterGoal} glasses</Text></View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable accessibilityLabel="Remove a glass of water" accessibilityRole="button" onPress={removeWater} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}><Icon name="minus" size={16} color={t.ink2} /></Pressable>
            <Pressable accessibilityLabel="Add a glass of water" accessibilityRole="button" onPress={addWater} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={16} color={t.brandInk} /></Pressable>
          </View>
        </View>

        {/* this week */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 11 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>This week</Text>
            <Text style={{ color: t.ink3, fontSize: 12 }}>{wk.workouts} of {goalDays} done</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {[['Workouts', String(wk.workouts)], ['Volume', `${(wk.volumeKg / 1000).toFixed(1)}t`], ['Burned', `${wk.kcal}`], ['PRs', String(prs.length)]].map(([l, v], i) => (
              <View key={l} style={{ alignItems: 'center' }}>
                <Text style={{ color: i === 3 ? t.brand : t.ink, fontSize: 18, fontWeight: '800' }}>{v}</Text>
                <Text style={{ color: t.ink3, fontSize: 9, marginTop: 1 }}>{l}</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 5, marginTop: 12 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i < wk.days ? t.brand : t.surface3 }} />
            ))}
          </View>
        </View>

        {/* next session — online (video) or in-person */}
        {(online || inperson) ? <Pressable onPress={() => router.push('/(client)/calendar')} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 11, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="calendar" size={20} color={t.brand} />
          </View>
          <View style={{ flex: 1 }}>
            {nextSession ? (
              <>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Next session · {new Date(nextSession.startsAt).toLocaleDateString(undefined, { weekday: 'short' })} {(() => { let h = new Date(nextSession.startsAt).getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${ap}`; })()}</Text>
                <Text style={{ color: t.ink3, fontSize: 11, marginTop: 1 }}>{inperson ? 'In-person' : 'Online'} · {nextSession.durationMin} min with your coach</Text>
              </>
            ) : (
              <>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>No sessions booked</Text>
                <Text style={{ color: t.ink3, fontSize: 11, marginTop: 1 }}>Tap to book {inperson ? 'an in-person session' : 'with your coach'}</Text>
              </>
            )}
          </View>
          <Icon name="chevron" size={18} color={t.ink3} />
        </Pressable> : null}

        {/* challenges */}
        <Pressable onPress={() => router.push('/(client)/challenges')} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 11, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="trophy" size={20} color={t.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Challenges &amp; leaderboards</Text>
            <Text style={{ color: t.ink3, fontSize: 11, marginTop: 1 }}>Join a challenge and climb the board</Text>
          </View>
          <Icon name="chevron" size={18} color={t.ink3} />
        </Pressable>

        {/* coach note */}
        {(!solo && (coachNotes.length > 0 || !!ann)) ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.brand, padding: 14, marginBottom: 11 }}>
            <Text style={{ color: t.brand, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>From your coach</Text>
            {coachNotes.length > 0 ? <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }} numberOfLines={4}>{coachNotes[0].body}</Text> : null}
            {ann ? <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 19, marginTop: coachNotes.length > 0 ? 10 : 0 }}>{ann.body}</Text> : null}
          </View>
        ) : null}

        {/* find a coach (solo) */}
        {solo ? (
          <Pressable onPress={() => router.push('/(client)/trainers')} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.brand, padding: 14, marginBottom: 11, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="people" size={20} color={t.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Work with a coach</Text>
              <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 1 }}>Browse trainers · online or in-person</Text>
            </View>
            <Icon name="chevron" size={18} color={t.ink3} />
          </Pressable>
        ) : null}

        {/* quick actions */}
        <View style={{ flexDirection: 'row', gap: 9 }}>
          {qa('plus', 'Log workout', '/(client)/workouts')}
          {qa('meals', 'Log food', '/(client)/foodlog')}
          {(online || inperson) ? qa('calendar', 'Book', '/(client)/calendar') : qa('chart', 'Report', '/(client)/report')}
          {qa('camera', 'Photo', '/(client)/scans')}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
