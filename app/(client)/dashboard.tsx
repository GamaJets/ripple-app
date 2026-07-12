// Client · Home — a dense daily briefing: today's plan, body stats, weight trend,
// nutrition, this week, next session, coach note, quick actions. Rebuilt on the
// palette theme + SVG icon set. Reads the live providers.
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
import { useSessions } from '../../src/ui/sessions';
import { currentStreak, weekStats, personalRecords } from '../../src/lib/streaks';

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
  const { sessions } = useSessions();

  const program = coachProgram ?? buildProgram(c.goal, c.bodyFatPct);
  const jsToMon = (new Date().getDay() + 6) % 7;
  const workout = program.days[jsToMon % program.days.length] || program.days[0] || { focus: 'Rest day', exercises: [] };

  const streak = currentStreak(log);
  const wk = weekStats(log);
  const prs = personalRecords(log);
  const goalDays = program.days.length || 4;

  const macros = applyCoachAdjust(macrosFor({ weightKg: c.weightKg, bodyFatPct: c.bodyFatPct, activity: c.activity, goal: c.goal, diet: c.diet }), nutriAdjust || undefined);
  const consumed = { kcal: Math.round(macros.kcal * 0.67), p: Math.round(macros.protein * 0.66), cbs: Math.round(macros.carbs * 0.6), f: Math.round(macros.fat * 0.7) };

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

  const stat = (label: string, val: string, delta: string, good: boolean) => (
    <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 13 }}>
      <Text style={{ color: t.ink3, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
      <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginTop: 3 }}>{val}</Text>
      {delta ? <Text style={{ color: good ? t.brand : t.ink3, fontSize: 11, fontWeight: '700' }}>{delta}</Text> : null}
    </View>
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

        {/* header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 16 }}>
          <View>
            <Text style={{ color: t.ink3, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{DAYS[d.getDay()]} {d.getDate()} {MONTHS[d.getMonth()]} · {hi}</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 2, textTransform: 'capitalize' }}>{c.name.split(' ')[0]}</Text>
          </View>
          <Pressable onPress={() => router.push('/(client)/messages')} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bell" size={20} color={t.ink2} />
            {(coachNotes.length > 0 || !!ann) ? <View style={{ position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: t.brand, borderWidth: 2, borderColor: t.surface }} /> : null}
          </Pressable>
        </View>

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
          {stat('Weight', `${c.weightKg}`, wDelta !== 0 ? `${wDelta < 0 ? '▼' : '▲'} ${Math.abs(wDelta)} kg` : '—', wDelta <= 0)}
          {stat('Body fat', `${c.bodyFatPct}%`, bfD !== 0 ? `${bfD < 0 ? '▼' : '▲'} ${Math.abs(bfD)}` : '—', bfD <= 0)}
          {stat('Muscle', `${c.muscleKg}`, muD !== 0 ? `${muD < 0 ? '▼' : '▲'} ${Math.abs(muD)}` : '—', muD >= 0)}
        </View>

        {/* weight trend */}
        {ws.length > 1 ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 11 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: t.ink3, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 }}>Weight · {ws.length} check-ins</Text>
              <Text style={{ color: t.brand, fontSize: 11, fontWeight: '700' }}>{wDelta > 0 ? '+' : ''}{wDelta} kg</Text>
            </View>
            <Spark t={t} data={ws} />
          </View>
        ) : null}

        {/* nutrition */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 11 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>Today's nutrition</Text>
            <Text style={{ color: t.ink3, fontSize: 12 }}><Text style={{ color: t.ink, fontWeight: '700' }}>{consumed.kcal.toLocaleString()}</Text> / {macros.kcal.toLocaleString()} kcal</Text>
          </View>
          {macroBar('Protein', consumed.p, macros.protein, t.brand)}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>{macroBar('Carbs', consumed.cbs, macros.carbs, t.s1)}</View>
            <View style={{ flex: 1 }}>{macroBar('Fat', consumed.f, macros.fat, t.s3)}</View>
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

        {/* next session */}
        <Pressable onPress={() => router.push('/(client)/calendar')} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 11, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="calendar" size={20} color={t.brand} />
          </View>
          <View style={{ flex: 1 }}>
            {nextSession ? (
              <>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>Next session · {new Date(nextSession.startsAt).toLocaleDateString(undefined, { weekday: 'short' })} {(() => { let h = new Date(nextSession.startsAt).getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${ap}`; })()}</Text>
                <Text style={{ color: t.ink3, fontSize: 11, marginTop: 1 }}>with your coach · {nextSession.durationMin} min</Text>
              </>
            ) : (
              <>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>No sessions booked</Text>
                <Text style={{ color: t.ink3, fontSize: 11, marginTop: 1 }}>Tap to book with your coach</Text>
              </>
            )}
          </View>
          <Icon name="chevron" size={18} color={t.ink3} />
        </Pressable>

        {/* coach note */}
        {(coachNotes.length > 0 || !!ann) ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.brand, padding: 14, marginBottom: 11 }}>
            <Text style={{ color: t.brand, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>From your coach</Text>
            {coachNotes.length > 0 ? <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }} numberOfLines={4}>{coachNotes[0].body}</Text> : null}
            {ann ? <Text style={{ color: t.ink2, fontSize: 13, lineHeight: 19, marginTop: coachNotes.length > 0 ? 10 : 0 }}>{ann.body}</Text> : null}
          </View>
        ) : null}

        {/* quick actions */}
        <View style={{ flexDirection: 'row', gap: 9 }}>
          {qa('plus', 'Log workout', '/(client)/workouts')}
          {qa('meals', 'Log food', '/(client)/foodlog')}
          {qa('calendar', 'Book', '/(client)/calendar')}
          {qa('camera', 'Photo', '/(client)/scans')}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
