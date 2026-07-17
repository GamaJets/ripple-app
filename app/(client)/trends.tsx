// Client · Trends. Graphs the workout log so members can SEE progress over time:
// weekly training volume (tonnage) for the last 10 weeks, and a per-exercise
// estimated-1RM trend. Pure View-based bars (no SVG sizing headaches), read-only.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { est1RM } from '../../src/lib/streaks';
import type { WorkoutEntry } from '../../src/lib/mockData';

const WEEKS = 10;

function mondayOf(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); const back = (x.getDay() + 6) % 7; x.setDate(x.getDate() - back); return x; }
function volumeOf(e: WorkoutEntry): number { return (e.sets || []).reduce((a, s) => a + (s[0] || 0) * (s[1] || 0), 0); }
function bestOf(e: WorkoutEntry): number { return (e.sets || []).reduce((m, s) => Math.max(m, est1RM(s[1] || 0, s[0] || 0)), 0); }

export default function Trends() {
  const t = useTheme();
  const router = useRouter();
  const { log } = useWorkoutLog();

  // Weekly training volume (last 10 weeks, oldest → newest).
  const weeks = useMemo(() => {
    const thisMon = mondayOf(new Date());
    const out: { label: string; vol: number; sessions: number }[] = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const start = new Date(thisMon); start.setDate(thisMon.getDate() - w * 7);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      const inWk = log.filter((e) => { const d = new Date(e.t); return d >= start && d < end; });
      const days = new Set(inWk.map((e) => new Date(e.t).toDateString()));
      out.push({ label: `${start.getDate()}/${start.getMonth() + 1}`, vol: inWk.reduce((a, e) => a + volumeOf(e), 0), sessions: days.size });
    }
    return out;
  }, [log]);
  const maxVol = Math.max(1, ...weeks.map((w) => w.vol));

  // Exercises that have logged sets (skip pure cardio) → trend of best est-1RM.
  const exercises = useMemo(() => {
    const names: string[] = [];
    for (const e of log) { if (e.sets && e.sets.length && !names.includes(e.exercise)) names.push(e.exercise); }
    return names.slice(0, 24);
  }, [log]);
  const [sel, setSel] = useState<string | null>(null);
  const selName = sel || exercises[0] || null;

  const series = useMemo(() => {
    if (!selName) return [] as { t: string; v: number }[];
    return log.filter((e) => e.exercise === selName && e.sets && e.sets.length)
      .map((e) => ({ t: e.t, v: bestOf(e) }))
      .sort((a, b) => +new Date(a.t) - +new Date(b.t))
      .slice(-12);
  }, [log, selName]);
  const maxE = Math.max(1, ...series.map((s) => s.v));
  const first = series.length ? series[0].v : 0;
  const last = series.length ? series[series.length - 1].v : 0;
  const delta = last - first;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Trends</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18, fontSize: 14 }}>See your training move over time.</Text>

        {/* Weekly volume */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>Weekly training volume</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 14 }}>Total kg lifted per week · last {WEEKS} weeks</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 6 }}>
            {weeks.map((w, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: t.ink3, fontSize: 8.5, marginBottom: 3 }}>{w.sessions || ''}</Text>
                <View style={{ width: '78%', height: Math.max(2, (w.vol / maxVol) * 100), backgroundColor: w.vol ? t.brand : t.surface2, borderRadius: 4, opacity: w.vol ? 1 : 0.5 }} />
                <Text style={{ color: t.ink3, fontSize: 8.5, marginTop: 4 }}>{w.label}</Text>
              </View>
            ))}
          </View>
          <Text style={{ color: t.ink3, fontSize: 11, marginTop: 10 }}>Small number above each bar = training days that week.</Text>
        </View>

        {/* Per-exercise est-1RM */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>Strength trend</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12 }}>Estimated 1-rep max per session</Text>
          {exercises.length === 0 ? (
            <Text style={{ color: t.ink3, fontSize: 13 }}>Log a few sets and your strength trend shows up here.</Text>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
                {exercises.map((n) => {
                  const on = n === selName;
                  return (
                    <Pressable key={n} onPress={() => setSel(n)} style={{ backgroundColor: on ? t.brand : t.surface2, borderColor: on ? t.brand : t.ring, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7 }}>
                      <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12.5 }} numberOfLines={1}>{n}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {series.length >= 1 ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                    <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800' }}>{last}<Text style={{ fontSize: 13, color: t.ink3 }}> kg est. 1RM</Text></Text>
                    {series.length >= 2 ? <Text style={{ color: delta >= 0 ? (t.good ?? t.brand) : t.crit, fontWeight: '800', fontSize: 13 }}>{delta >= 0 ? '▲ +' : '▼ '}{Math.abs(delta)}kg</Text> : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 6 }}>
                    {series.map((s, i) => (
                      <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={{ color: t.ink3, fontSize: 8.5, marginBottom: 3 }}>{s.v}</Text>
                        <View style={{ width: '70%', height: Math.max(3, (s.v / maxE) * 92), backgroundColor: t.brand, borderRadius: 4 }} />
                        <Text style={{ color: t.ink3, fontSize: 8.5, marginTop: 4 }}>{new Date(s.t).getDate()}/{new Date(s.t).getMonth() + 1}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={{ color: t.ink3, fontSize: 13 }}>No sets logged for this exercise yet.</Text>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
