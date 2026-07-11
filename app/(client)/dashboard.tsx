// Client dashboard — polished dark UI on demo data (via the repo layer later).
import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { macrosFor } from '../../src/lib/nutrition';
import { ageFromDob } from '../../src/lib/age';
import { seriesDelta } from '../../src/lib/format';
import { useClientData } from '../../src/ui/clientData';
import { useCoachFeedback } from '../../src/ui/feedback';
import { TrendChart } from '../../src/ui/Chart';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { currentStreak, longestStreak, personalRecords, weekStats, streakMilestone } from '../../src/lib/streaks';
import { Confetti } from '../../src/ui/Confetti';

function Ripple({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: color, opacity: 0.35 }} />
      <View style={{ position: 'absolute', width: size * 0.6, height: size * 0.6, borderRadius: size, borderWidth: 2, borderColor: color, opacity: 0.65 }} />
      <View style={{ width: size * 0.24, height: size * 0.24, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

function Stat({ t, label, value, unit }: { t: Theme; label: string; value: string | number; unit: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}>
      <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }}>{label}</Text>
      <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 }}>{value}<Text style={{ fontSize: 12, color: t.ink3, fontWeight: '600' }}> {unit}</Text></Text>
    </View>
  );
}

function Action({ t, icon, label, onPress }: { t: Theme; icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: 16, borderWidth: 1, borderColor: t.ring, paddingVertical: 18, alignItems: 'center', gap: 6 }}>
      <Text style={{ fontSize: 24 }}>{icon}</Text>
      <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export default function Dashboard() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const coachNotes = useCoachFeedback().getFeedback(c.id);
  const w = c.weightKg;
  const bf = c.bodyFatPct;
  const mus = c.muscleKg;
  const macros = macrosFor({ weightKg: w, bodyFatPct: bf, activity: c.activity, goal: c.goal, diet: c.diet });
  const age = ageFromDob(c.dob);
  const dW = seriesDelta(c.weightSeries.map((x) => x.v));
  const goalLabel: Record<string, string> = { fatloss: 'Fat loss', tone: 'Tone', muscle: 'Build muscle' };

  // Gamification: streak, personal records, this-week totals (reactive log).
  const { log } = useWorkoutLog();
  const streak = currentStreak(log);
  const longest = longestStreak(log);
  const prs = personalRecords(log).slice(0, 3);
  const wk = weekStats(log);
  const milestone = streakMilestone(streak);
  const [confetti, setConfetti] = useState(false);
  const celebrated = useRef(false);
  useEffect(() => {
    if (milestone && !celebrated.current) { celebrated.current = true; setConfetti(true); }
  }, [milestone]);

  const macroRows = [
    { k: 'Protein', g: macros.protein, cal: macros.protein * 4, color: t.brand },
    { k: 'Carbs', g: macros.carbs, cal: macros.carbs * 4, color: t.s1 },
    { k: 'Fat', g: macros.fat, cal: macros.fat * 9, color: t.s3 },
  ];
  const totalCal = macroRows.reduce((a, m) => a + m.cal, 0) || 1;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <View>
            <Text style={{ color: t.ink3, fontSize: 14 }}>Welcome back</Text>
            <Text style={{ color: t.ink, fontSize: 26, fontWeight: '800', textTransform: 'capitalize', letterSpacing: -0.5 }}>{c.name.split(' ')[0]}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Pressable onPress={() => router.push('/(client)/messages')} style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 20 }}>💬</Text></Pressable>
            <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}><Ripple size={26} color={t.brandInk} /></View>
          </View>
        </View>

        {/* Streak & records */}
        {coachNotes.length ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.brand, padding: 16, marginBottom: 14 }}>
            <Text style={{ color: t.brand, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>💬 From your coach</Text>
            <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 20 }} numberOfLines={5}>{coachNotes[0].body}</Text>
            <Text style={{ color: t.ink3, fontSize: 11, marginTop: 8 }}>{new Date(coachNotes[0].at).toLocaleDateString()}</Text>
          </View>
        ) : null}
        <Pressable onPress={() => setConfetti(true)} style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: streak > 0 ? 'rgba(245,158,11,0.15)' : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 26 }}>🔥</Text>
              </View>
              <View>
                <Text style={{ color: t.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}>{streak}<Text style={{ fontSize: 14, color: t.ink3, fontWeight: '700' }}> day{streak === 1 ? '' : 's'}</Text></Text>
                <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}>{streak > 0 ? 'Current streak' : 'Train today to start a streak'} · best {longest}</Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: t.brand, fontSize: 20, fontWeight: '800' }}>{wk.workouts}</Text>
              <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}>this week</Text>
            </View>
          </View>
          {milestone ? (
            <View style={{ marginTop: 12, backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 }}>
              <Text style={{ color: t.s3, fontWeight: '700', fontSize: 13 }}>{milestone}</Text>
            </View>
          ) : null}
          {prs.length > 0 && (
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', marginBottom: 7, textTransform: 'uppercase', letterSpacing: 0.5 }}>Personal Records 🏆</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {prs.map((pr) => (
                  <View key={pr.exercise} style={{ backgroundColor: t.surface2, borderRadius: 10, borderWidth: 1, borderColor: t.ring, paddingHorizontal: 10, paddingVertical: 7 }}>
                    <Text style={{ color: t.ink2, fontSize: 11, fontWeight: '600' }}>{pr.exercise}</Text>
                    <Text style={{ color: t.ink, fontSize: 13, fontWeight: '800' }}>{pr.weight} kg × {pr.reps}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </Pressable>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={{ color: t.ink3, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' }}>Current weight</Text>
              <Text style={{ color: t.ink, fontSize: 40, fontWeight: '800', letterSpacing: -1 }}>{w}<Text style={{ fontSize: 18, color: t.ink3, fontWeight: '600' }}> kg</Text></Text>
            </View>
            <View style={{ backgroundColor: dW <= 0 ? 'rgba(45,212,191,0.15)' : 'rgba(224,103,103,0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, marginTop: 8 }}>
              <Text style={{ color: dW <= 0 ? t.brand : t.s6, fontWeight: '700', fontSize: 13 }}>{dW > 0 ? '+' : ''}{dW} kg</Text>
            </View>
          </View>
          <View style={{ marginTop: 12 }}>
            <TrendChart data={c.weightSeries} unit=" kg" goodDown={c.goal !== 'muscle'} height={130} />
          </View>
          <Text style={{ color: t.ink3, fontSize: 11, marginTop: 10 }}>Last {c.weightSeries.length} check-ins · Goal: {goalLabel[c.goal] ?? c.goal}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
          <Stat t={t} label="Body fat" value={bf} unit="%" />
          <Stat t={t} label="Muscle" value={mus} unit="kg" />
          <Stat t={t} label="Age" value={age ?? '—'} unit="yrs" />
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize' }}>Daily target</Text>
            <Text style={{ color: t.brand, fontWeight: '800', fontSize: 20 }}>{macros.kcal.toLocaleString()}<Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}> kcal</Text></Text>
          </View>
          {macroRows.map((m) => (
            <View key={m.k} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600' }}>{m.k}</Text>
                <Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>{m.g} g</Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surface3, overflow: 'hidden' }}>
                <View style={{ width: (Math.round((m.cal / totalCal) * 100)) + '%', height: 8, borderRadius: 4, backgroundColor: m.color }} />
              </View>
            </View>
          ))}
          <Text style={{ color: t.ink3, fontSize: 11, marginTop: 4 }}>Personalised from your InBody scan · LBM {macros.lbm} kg · TDEE {macros.tdee}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Action t={t} icon="🤖" label="Ask AI Coach" onPress={() => router.push('/(client)/coach')} />
          <Action t={t} icon="🏋️" label="Log workout" onPress={() => router.push('/(client)/workouts')} />
          <Action t={t} icon="📅" label="Book session" onPress={() => router.push('/(client)/calendar')} />
        </View>
      </ScrollView>
      <Confetti show={confetti} onDone={() => setConfetti(false)} />
    </SafeAreaView>
  );
}
